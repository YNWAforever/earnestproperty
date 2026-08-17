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
  const url = new URL(pageUrl);
  if (url.hostname !== "www.28hse.com" || url.pathname !== `/agent/${AGENT_ID}`) {
    throw new TypeError("Unexpected 28Hse agent source URL");
  }
  if (url.searchParams.get("buyRent") !== (dealType === "sale" ? "buy" : "rent")) {
    throw new TypeError("Agent source URL deal type does not match context");
  }
  return url;
}

function requiredText(value, name) {
  const text = normalizeText(value);
  if (!text) throw new Error(`Missing required ${name}`);
  return text;
}

function propertyNumber(value) {
  return normalizeText(value).match(/([A-Z0-9-]+)\s*(?:\([^)]*\))?$/i)?.[1] ?? null;
}

function parseCount(text, dealType) {
  const normalized = normalizeText(text).replace(/,/g, "");
  const dealWord = dealType === "sale" ? "(?:出售|買|buy|sale)" : "(?:出租|租|rent)";
  const match = normalized.match(new RegExp(`${dealWord}[^0-9]*(\\d+(?:\\.\\d+)?)`, "i"));
  return match ? Number(match[1]) : null;
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
  const surrounding = [
    url,
    $(image).attr("alt"),
    $(image).attr("class"),
    $(image).closest("[class], [id]").attr("class"),
    $(image).closest("[class], [id]").attr("id"),
  ].join(" ");
  return /(?:map|floor[ _-]?plan|unit[ _-]?plan|qr|\bvr\b|logo|avatar|\bad\b|sponsor|28hse[ _-]?(?:logo|brand))/i.test(
    surrounding,
  );
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
  if (!Number.isInteger(page) || page < 1) throw new TypeError("page must be a positive integer");
  const buyRent = dealType === "sale" ? "buy" : "rent";
  return `https://www.28hse.com/agent/${AGENT_ID}?buyRent=${buyRent}&page=${page}&plan_id=${AGENT_ID}&propertyDoSearchVersion=2.0`;
}

export function detect28HseChallenge(html) {
  const text = normalizeText(load(String(html ?? ""))("body").text()).toLowerCase();
  return (
    !text ||
    /captcha|cloudflare|verify you are human|challenge|access denied|登入|login|sign in/.test(text)
  );
}

export function parse28HseAgentIndex(html, context) {
  requireDealType(context?.dealType);
  const pageUrl = requireAgentPageUrl(context?.pageUrl, context.dealType);
  if (detect28HseChallenge(html)) throw new Error("28Hse challenge detected");
  const $ = load(String(html));
  const profile = $("[data-agent-profile='540'] .agent-profile");
  const results = $(
    `[data-agent-profile='540'] [data-agent-results][data-deal-type='${context.dealType}']`,
  );
  if (profile.length !== 1 || results.length !== 1)
    throw new Error("Unexpected agent index template");

  const companyName = requiredText(profile.find("h1").first().text(), "company name");
  const licences = unique(
    profile
      .find(".licence")
      .map((_, node) =>
        normalizeText($(node).text())
          .match(/C-\d{6}/i)?.[0]
          ?.toUpperCase(),
      )
      .get(),
  );
  if (licences.length !== 1 || licences[0] !== AGENT_LICENCE)
    throw new Error("Unexpected agent licence template");
  const counts = unique(
    results
      .find(".result-count")
      .map((_, node) => parseCount($(node).text(), context.dealType))
      .get(),
  );
  if (counts.length !== 1 || !Number.isFinite(counts[0]) || counts[0] < 0)
    throw new Error("Unexpected advertised count template");

  const linksById = new Map();
  results.find("a[href]").each((_, anchor) => {
    const href = $(anchor).attr("href");
    const match = href?.match(/^\/(buy|rent)\/[^"?#]*\/property-(\d+)\/?$/i);
    if (
      !match ||
      (context.dealType === "sale"
        ? match[1].toLowerCase() !== "buy"
        : match[1].toLowerCase() !== "rent")
    )
      return;
    const externalId = match[2];
    const summaryTitle = requiredText($(anchor).text(), "listing title");
    const url = safeAbsoluteUrl(href, pageUrl);
    const previous = linksById.get(externalId);
    if (previous && (previous.url !== url || previous.summaryTitle !== summaryTitle)) {
      throw new Error("Unexpected agent index template: contradictory listing link");
    }
    linksById.set(externalId, { externalId, url, summaryTitle });
  });
  const links = [...linksById.values()].sort((a, b) => a.externalId.localeCompare(b.externalId));
  return {
    companyName,
    companyLicence: AGENT_LICENCE,
    advertisedCount: counts[0],
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
  const sourceUrl = new URL(context?.sourceUrl);
  const externalId = sourceUrl.pathname.match(/^\/(?:buy|rent)\/[^/]+\/property-(\d+)\/?$/i)?.[1];
  if (!externalId) throw new TypeError("Unexpected 28Hse listing source URL");
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
