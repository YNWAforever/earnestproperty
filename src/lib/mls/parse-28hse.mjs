import { createHash } from "node:crypto";
import { load } from "cheerio";

import {
  parseAreaFeet,
  parseMoneyToHkd,
  parseRoomCounts,
  normalizeText,
} from "./parse-old-site.mjs";
import { SOURCE_28HSE, createObservation } from "./source-contract.mjs";

const AGENT_ID = "540";
const AGENT_LICENCE = "C-018613";
const ALLOWED_28HSE_FIELDS = new Set([
  "title_zh",
  "title_en",
  "estate_slug",
  "district_slug",
  "address",
  "price",
  "rent",
  "saleable_area",
  "gross_area",
  "bedrooms",
  "bathrooms",
  "floor",
  "orientation",
  "features",
  "status",
]);

const DETAIL_LABELS = new Map([
  ["物業編號", "property_no"],
  ["property number", "property_no"],
  ["售價", "price"],
  ["price", "price"],
  ["租金", "rent"],
  ["出租價", "rent"],
  ["rent", "rent"],
  ["實用面積", "saleable_area"],
  ["usable area", "saleable_area"],
  ["建築面積", "gross_area"],
  ["gross area", "gross_area"],
  ["間隔", "rooms"],
  ["間格", "rooms"],
  ["rooms", "rooms"],
  ["浴室", "bathrooms"],
  ["bathrooms", "bathrooms"],
  ["地址", "address"],
  ["地區", "address"],
  ["address", "address"],
  ["樓層", "floor"],
  ["層數", "floor"],
  ["floor", "floor"],
  ["座向", "orientation"],
  ["座向景觀", "orientation"],
  ["orientation", "orientation"],
  ["特色", "features"],
  ["features", "features"],
  ["標籤", "features"],
]);

const BLOCKING_HEADING =
  /^(?:just a moment|access denied|attention required|verify you are human|captcha challenge)(?:[.?!…]+)?(?:\s*[|–—-]\s*(?:cloudflare|28hse))?$/i;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function requireDealType(dealType) {
  if (dealType !== "sale" && dealType !== "rent")
    throw new TypeError("dealType must be sale or rent");
}

function requireAgentPageUrl(pageUrl, dealType) {
  if (typeof pageUrl !== "string" || /[\u0000-\u0020\u007f]/.test(pageUrl)) {
    throw new TypeError("Unexpected 28Hse agent source URL");
  }
  const rawPageUrl = pageUrl;
  const rawAuthority = rawPageUrl.match(/^https:\/\/([^/?#]*)/i)?.[1] ?? "";
  if (!rawAuthority || rawAuthority.includes("@") || rawAuthority.includes(":")) {
    throw new TypeError("Unexpected 28Hse agent source URL");
  }
  let url;
  try {
    url = new URL(rawPageUrl);
  } catch {
    throw new TypeError("Unexpected 28Hse agent source URL");
  }
  const expectedKeys = new Set(["buyRent", "page", "plan_id", "propertyDoSearchVersion"]);
  const keys = [...url.searchParams.keys()];
  const pageText = url.searchParams.get("page");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hostname !== "www.28hse.com" ||
    url.pathname !== `/agent/${AGENT_ID}` ||
    url.hash ||
    keys.length !== expectedKeys.size ||
    keys.some((key) => !expectedKeys.has(key)) ||
    url.searchParams.get("plan_id") !== AGENT_ID ||
    url.searchParams.get("propertyDoSearchVersion") !== "2.0" ||
    !/^(?:[1-9]\d?|100)$/.test(pageText ?? "")
  ) {
    throw new TypeError("Unexpected 28Hse agent source URL");
  }
  if (url.searchParams.get("buyRent") !== (dealType === "sale" ? "buy" : "rent")) {
    throw new TypeError("Agent source URL deal type does not match context");
  }
  return url;
}

function requireDetailUrl(sourceUrl, dealType) {
  let url;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new TypeError("Unexpected 28Hse detail source URL");
  }
  const pathDeal = dealType === "sale" ? "buy" : "rent";
  const externalId = url.pathname.match(
    new RegExp(`^/${pathDeal}/[^/]+/property-(\\d+)/?$`, "i"),
  )?.[1];
  if (url.protocol !== "https:" || url.hostname !== "www.28hse.com" || !externalId) {
    throw new TypeError("Unexpected 28Hse detail source URL");
  }
  return { url, externalId };
}

function requiredText(value, name) {
  const text = normalizeText(value);
  if (!text) throw new Error(`Missing required ${name}`);
  return text;
}

const APPROVED_AGENT_COMPANY_NAMES = new Set([
  "晉誠地產",
  "earnest property",
  "晉誠地產 earnest property",
  "earnest property 晉誠地產",
]);

export function is28HseAgentCompanyName(companyName) {
  const normalized = String(companyName ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return APPROVED_AGENT_COMPANY_NAMES.has(normalized);
}

function propertyNumber(value) {
  return normalizeText(value).match(/([A-Z0-9-]+)\s*(?:\([^)]*\))?$/i)?.[1] ?? null;
}

function parseCount(text, dealType) {
  const label = dealType === "sale" ? "放售樓盤" : "放租樓盤";
  const match = normalizeText(text)
    .replaceAll(",", "")
    .match(new RegExp(`共有\\s*(\\d+)\\s*個${label}`, "u"));
  if (!match) return Number.NaN;
  const count = Number(match[1]);
  return Number.isSafeInteger(count) && count >= 0 ? count : Number.NaN;
}

function safeAbsoluteUrl(value, baseUrl) {
  try {
    const url = new URL(value, baseUrl);
    return /^https?:$/.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizedLabel(value) {
  return normalizeText(value).replace(/[:：]/g, "").toLowerCase();
}

function putPair(pairs, rawLabel, rawValue) {
  const key = DETAIL_LABELS.get(normalizedLabel(rawLabel));
  const value = normalizeText(rawValue);
  if (!key || !value) return;
  if (pairs.has(key) && pairs.get(key) !== value) {
    throw new Error(`Unexpected template: contradictory ${key}`);
  }
  pairs.set(key, value);
}

function detailPairs($) {
  const pairs = new Map();
  const leftCells = $("[data-listing-detail] .table_left");
  leftCells.each((_, left) => {
    const row = $(left).closest("tr");
    putPair(pairs, $(left).text(), row.find(".table_right").first().text());
  });
  if (leftCells.length) return pairs;

  $("[data-listing-detail] .listing-facts tr").each((_, row) => {
    const cells = $(row).find("td, th");
    if (cells.length >= 2) putPair(pairs, $(cells[0]).text(), $(cells[1]).text());
  });
  return pairs;
}

function imageIsExcluded($, image, url) {
  const forbidden =
    /(?:map|floor[ _-]?plan|unit[ _-]?plan|qr|\bvr\b|logo|avatar|\bad\b|sponsor|28hse[ _-]?(?:logo|brand))/i;
  let node = $(image);
  const gallery = node.closest(".listing-gallery, [data-listing-gallery]");
  while (node.length) {
    const signals = [
      node.is("img") ? url : "",
      ...Object.entries(node.get(0)?.attribs ?? {}).flat(),
    ].join(" ");
    if (forbidden.test(signals)) return true;
    if (gallery.length && node.get(0) === gallery.get(0)) break;
    node = node.parent();
  }
  return false;
}

function extractGallery($, sourceUrl) {
  const images = [];
  $(
    "[data-listing-detail] .listing-gallery img[src], [data-listing-detail] [data-listing-gallery] img[src]",
  ).each((_, image) => {
    const url = safeAbsoluteUrl($(image).attr("src"), sourceUrl);
    if (!url || imageIsExcluded($, image, url)) return;
    images.push(url);
  });
  return unique(images).map((url, index) => ({
    url,
    category: "listing_photo",
    isPrimary: index === 0,
  }));
}

export function build28HseAgentUrl(dealType, page) {
  requireDealType(dealType);
  if (!Number.isInteger(page) || page < 1 || page > 100)
    throw new TypeError("page must be an integer from 1 to 100");
  const buyRent = dealType === "sale" ? "buy" : "rent";
  return `https://www.28hse.com/agent/${AGENT_ID}?buyRent=${buyRent}&page=${page}&plan_id=${AGENT_ID}&propertyDoSearchVersion=2.0`;
}

export function detect28HseChallenge(html) {
  const markup = String(html ?? "");
  const $ = load(markup);
  const text = normalizeText($.root().text());
  if (!text) return true;
  if (/cf-chl-|challenge-platform|\/cdn-cgi\/challenge-platform/i.test(markup)) return true;
  const hasAgentIdentity = /C-018613/i.test(text);
  const hasPropertyLink = $("a[href*='/property-']").length > 0;
  const hasValidAgentContent = hasAgentIdentity && hasPropertyLink;
  const captchaNodes = $("[data-sitekey], iframe[src], form[action]")
    .toArray()
    .filter((node) => {
      if ($(node).attr("data-sitekey") != null) return true;
      return /(?:captcha|recaptcha|hcaptcha|turnstile)/i.test(
        $(node).attr("src") ?? $(node).attr("action") ?? "",
      );
    });
  const hasBlockingCaptcha = captchaNodes.some((node) => {
    if (!hasValidAgentContent) return true;
    let container = $(node);
    while (container.length) {
      if (
        container.is("[role='dialog'], [aria-modal='true']") ||
        /(?:^|[\s_-])(?:captcha|challenge|verification|verify|overlay|modal|gate)(?:$|[\s_-])/i.test(
          [container.attr("id"), container.attr("class")].filter(Boolean).join(" "),
        ) ||
        (container.is("form") &&
          /(?:^|[^a-z0-9])(?:captcha|recaptcha|hcaptcha|turnstile|challenge|verification|verify|login|sign-?in|authenticate|auth)(?:$|[^a-z0-9])/i.test(
            container.attr("action") ?? "",
          ))
      ) {
        return true;
      }
      container = container.parent();
    }
    return false;
  });
  if (hasBlockingCaptcha) return true;
  const hasBlockingHeading = $("title, h1, [role='heading']")
    .toArray()
    .some((node) => BLOCKING_HEADING.test(normalizeText($(node).text())));
  if (hasBlockingHeading) return true;
  const hasPasswordForm = $("form input[type='password']").length > 0;
  return hasPasswordForm && !hasValidAgentContent;
}

export function parse28HseAgentIndex(html, context) {
  requireDealType(context?.dealType);
  const pageUrl = requireAgentPageUrl(context?.pageUrl, context.dealType);
  if (detect28HseChallenge(html)) throw new Error("28Hse challenge detected");
  const $ = load(String(html));
  const companyNames = $("h1")
    .toArray()
    .map((node) => normalizeText($(node).text()))
    .filter(Boolean);
  if (companyNames.length !== 1) throw new Error("Unexpected agent company template");
  const companyName = companyNames[0];
  if (!is28HseAgentCompanyName(companyName)) throw new Error("Unexpected agent company identity");

  const documentText = normalizeText($.root().text());
  const licences = unique(
    [...documentText.matchAll(/C-\d{6}/gi)].map(([licence]) => licence.toUpperCase()),
  );
  if (licences.length !== 1 || licences[0] !== AGENT_LICENCE)
    throw new Error("Unexpected agent licence template");

  const counts = new Set();
  $("body *").each((_, node) => {
    const ownText = $(node)
      .contents()
      .filter((__, child) => child.type === "text")
      .text();
    const count = parseCount(ownText, context.dealType);
    if (Number.isFinite(count)) counts.add(count);
  });
  if (counts.size !== 1) throw new Error("Unexpected advertised count template");
  const advertisedCount = [...counts][0];

  const linksById = new Map();
  $("a[href]").each((_, anchor) => {
    const href = $(anchor).attr("href");
    const match = href?.match(/^\/(buy|rent)\/[^/?#]+\/property-(\d+)\/?$/i);
    if (
      !match ||
      (context.dealType === "sale"
        ? match[1].toLowerCase() !== "buy"
        : match[1].toLowerCase() !== "rent")
    )
      return;
    const externalId = match[2];
    const summaryTitle = normalizeText($(anchor).text());
    const canonicalHref = href.endsWith("/") ? href.slice(0, -1) : href;
    const url = safeAbsoluteUrl(canonicalHref, pageUrl);
    const previous = linksById.get(externalId);
    if (previous && previous.url !== url) {
      throw new Error("Unexpected agent index template: contradictory listing link");
    }
    if (!previous || summaryTitle.length > previous.summaryTitle.length) {
      linksById.set(externalId, { externalId, url, summaryTitle });
    }
  });
  const links = [...linksById.values()].sort((a, b) => a.externalId.localeCompare(b.externalId));
  if (links.some((link) => !link.summaryTitle)) {
    throw new Error("Unexpected agent index template: missing listing title");
  }
  if (advertisedCount > 0 && links.length === 0) {
    throw new Error("Unexpected agent index count: positive count has no listing links");
  }
  if (advertisedCount < links.length) {
    throw new Error("Unexpected agent index count: advertised count is smaller than unique links");
  }
  return {
    companyName,
    companyLicence: AGENT_LICENCE,
    advertisedCount,
    dealType: context.dealType,
    links,
    pageFingerprint: sha256(
      links
        .map((link) => link.externalId)
        .sort()
        .join(","),
    ),
  };
}

export function parse28HseDetail(html, context) {
  requireDealType(context?.dealType);
  const { url: sourceUrl, externalId } = requireDetailUrl(context?.sourceUrl, context.dealType);
  if (detect28HseChallenge(html))
    throw new Error("Empty detail template or 28Hse challenge detected");
  if (!context?.fetchedAt) throw new TypeError("fetchedAt is required");
  const $ = load(String(html));
  if ($("[data-listing-detail]").length !== 1) throw new Error("Unexpected detail template");
  const pairs = detailPairs($);
  if (!pairs.size) throw new Error("Empty or malformed detail template");

  const propertyNoRaw = propertyNumber(pairs.get("property_no"));
  const price = parseMoneyToHkd(pairs.get("price"));
  const rent = parseMoneyToHkd(pairs.get("rent"));
  const address = normalizeText(pairs.get("address")) || null;
  const title = requiredText(context.summaryTitle, "listing title");
  if (!propertyNoRaw) throw new Error("Missing property number in detail template");
  if (!address) throw new Error("Missing district/address in detail template");
  if (
    (context.dealType === "sale" && !(price > 0)) ||
    (context.dealType === "rent" && !(rent > 0))
  ) {
    throw new Error("Missing active-deal price in detail template");
  }

  const rooms = parseRoomCounts(pairs.get("rooms"));
  const bathroomsMatch = normalizeText(pairs.get("bathrooms")).match(/(\d+)/);
  const features = unique(
    normalizeText(pairs.get("features"))
      .split(/[,，、]/)
      .map(normalizeText),
  );
  const fields = {
    title_zh: title,
    address,
    district_slug: address,
    price: context.dealType === "sale" ? price : null,
    rent: context.dealType === "rent" ? rent : null,
    saleable_area: parseAreaFeet(pairs.get("saleable_area")),
    gross_area: parseAreaFeet(pairs.get("gross_area")),
    bedrooms: rooms.bedrooms,
    bathrooms: bathroomsMatch ? Number(bathroomsMatch[1]) : null,
    floor: normalizeText(pairs.get("floor")) || null,
    orientation: normalizeText(pairs.get("orientation")) || null,
    features: features.length ? features : null,
    status: "active",
  };
  const rawFields = Object.fromEntries(
    [...pairs.entries()]
      .filter(([key]) => key !== "property_no" && ALLOWED_28HSE_FIELDS.has(key))
      .map(([key, value]) => [key, value]),
  );
  return createObservation({
    source: SOURCE_28HSE,
    externalId,
    dealType: context.dealType,
    sourceUrl: sourceUrl.toString(),
    propertyNoRaw,
    fields,
    rawFields,
    mediaCandidates: extractGallery($, sourceUrl),
    discoveredAt: context.discoveredAt,
    fetchedAt: context.fetchedAt,
  });
}
