import { load } from "cheerio";

import {
  buildPagedListingUrl,
  parseDetailTable,
  parseListingDetail,
  parseListingIndex,
  parseMaxListingPage,
} from "../parse-old-site.mjs";
import {
  inferDistrictSlug,
  normalizeListingDetail,
  resolveEstateSlug,
} from "../normalize-old-site.mjs";
import { SOURCE_OLD_SITE, createObservation } from "../source-contract.mjs";

export const DEFAULT_OLD_SITE_SEED_URLS = Object.freeze([
  { url: "https://www.earnestproperty.com/property/c1", dealType: "sale" },
  { url: "https://www.earnestproperty.com/property/c2", dealType: "sale" },
  { url: "https://www.earnestproperty.com/property/c5", dealType: "rent" },
]);

const RAW_FIELD_LABELS = Object.freeze([
  "更新日期",
  "物業用途",
  "地區",
  "街道 (英)",
  "街道 (中)",
  "大廈 (英)",
  "大廈 (中)",
  "層數",
  "單位",
  "建築面積",
  "實用面積",
  "售價",
  "出租價",
  "座向景觀",
  "座向",
  "裝修",
  "備註",
  "間格",
  "間隔",
]);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function seedUrl(seed) {
  return typeof seed === "string" ? seed : seed.url;
}

function dealTypeForSeed(seed) {
  if (typeof seed !== "string") return seed.dealType;
  return /\/c5\/?(?:\?|$)/i.test(seed) ? "rent" : "sale";
}

function legacyIdFromUrl(url) {
  return String(url ?? "").match(/property-detail\/(\d+)\.html/i)?.[1] ?? null;
}

function isoNow(now) {
  return now().toISOString();
}

function sourceRawFields(html) {
  const labels = parseDetailTable(load(html));
  return Object.fromEntries(
    RAW_FIELD_LABELS.filter((label) => labels[label]).map((label) => [label, labels[label]]),
  );
}

function fieldsFor(detail, row, dealType) {
  return {
    title_zh: row?.title_zh ?? detail.buildingZh ?? detail.title ?? null,
    title_en: row?.title_en ?? null,
    estate_slug: resolveEstateSlug(detail),
    district_slug: row?.district_slug ?? inferDistrictSlug(detail),
    address: row?.address || [detail.streetZh, detail.buildingZh].filter(Boolean).join(" ") || null,
    price: dealType === "sale" ? (row?.price ?? detail.salePriceHkd) : null,
    rent: dealType === "rent" ? (row?.rent ?? detail.rentHkd) : null,
    saleable_area: row?.saleable_area ?? detail.saleableArea ?? null,
    gross_area: row?.gross_area ?? detail.grossArea ?? null,
    bedrooms: row?.bedrooms ?? detail.bedrooms ?? null,
    bathrooms: row?.bathrooms ?? null,
    floor: row?.floor ?? detail.floor ?? null,
    orientation: row?.orientation ?? detail.orientation ?? null,
    features: row?.features ?? null,
    description: row?.description ?? detail.metaDescription ?? detail.title ?? null,
    status: row?.status ?? "active",
  };
}

function mediaCandidates(detail) {
  return (detail.images ?? []).map((url, index) => ({
    url,
    category: "listing_photo",
    isPrimary: index === 0,
  }));
}

function diagnostics(sourceUrl, responseStatus, failureCode = null) {
  return {
    sourceUrl,
    responseStatus,
    attempts: 1,
    templateFingerprint: null,
    selectorCounts: {},
    failureCode,
  };
}

function responseStatusFromError(error) {
  return Number.isInteger(error?.response?.status) ? error.response.status : null;
}

async function fetchResponse(fetchImpl, url, signal) {
  const response = await fetchImpl(url, { signal });
  const status = Number.isInteger(response?.status) ? response.status : null;
  if (!response || typeof response.text !== "function") {
    throw new TypeError(`Fetch returned an invalid response for ${url}`);
  }
  if (!response.ok) {
    const error = new Error(`Fetch failed ${status ?? "unknown"} for ${url}`);
    error.response = response;
    throw error;
  }
  return { response, status, text: await response.text() };
}

export async function discoverOldSitePages({
  fetchText,
  seedUrls = DEFAULT_OLD_SITE_SEED_URLS,
  maxPages = 50,
}) {
  const discovered = [];

  for (const seed of seedUrls) {
    const firstUrl = seedUrl(seed);
    const firstHtml = await fetchText(firstUrl);
    discovered.push(...parseListingIndex(firstHtml, firstUrl));

    const maxPage = Math.min(parseMaxListingPage(firstHtml), maxPages);
    for (let page = 2; page <= maxPage; page += 1) {
      const pageUrl = buildPagedListingUrl(firstUrl, page);
      const html = await fetchText(pageUrl);
      discovered.push(...parseListingIndex(html, pageUrl));
    }
  }

  return unique(discovered);
}

export function createOldSiteSourceAdapter({
  fetchImpl,
  sleep,
  random,
  now = () => new Date(),
  signal,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");

  return {
    async collect({ seedUrls = DEFAULT_OLD_SITE_SEED_URLS, maxPages = 50 } = {}) {
      const failures = [];
      const diagnosticsByUrl = new Map();
      const discoveredByIdentity = new Map();
      const pageCounts = { sale: 0, rent: 0 };
      let paginationComplete = true;

      for (const seed of seedUrls) {
        const indexUrl = seedUrl(seed);
        const dealType = dealTypeForSeed(seed);
        try {
          const first = await fetchResponse(fetchImpl, indexUrl, signal);
          diagnosticsByUrl.set(indexUrl, diagnostics(indexUrl, first.status));
          const pageUrls = [indexUrl];
          const maxPage = Math.min(parseMaxListingPage(first.text), maxPages);
          for (let page = 2; page <= maxPage; page += 1) {
            pageUrls.push(buildPagedListingUrl(indexUrl, page));
          }

          for (const pageUrl of pageUrls) {
            const page =
              pageUrl === indexUrl ? first : await fetchResponse(fetchImpl, pageUrl, signal);
            diagnosticsByUrl.set(pageUrl, diagnostics(pageUrl, page.status));
            pageCounts[dealType] += 1;
            const discoveredAt = isoNow(now);
            for (const sourceUrl of parseListingIndex(page.text, pageUrl)) {
              const externalId = legacyIdFromUrl(sourceUrl);
              const identity = `${dealType}:${externalId ?? sourceUrl}`;
              if (!discoveredByIdentity.has(identity)) {
                discoveredByIdentity.set(identity, {
                  sourceUrl,
                  externalId,
                  dealType,
                  discoveredAt,
                });
              }
            }
          }
        } catch (error) {
          paginationComplete = false;
          const message = error instanceof Error ? error.message : String(error);
          failures.push({ code: "index_fetch_failed", detail: message });
          const prior = diagnosticsByUrl.get(indexUrl);
          diagnosticsByUrl.set(
            indexUrl,
            diagnostics(
              indexUrl,
              prior?.responseStatus ?? responseStatusFromError(error),
              "index_fetch_failed",
            ),
          );
        }
      }

      const observations = [];
      const detailPayloads = new Map();
      for (const record of discoveredByIdentity.values()) {
        const fetchedAt = isoNow(now);
        let payload = detailPayloads.get(record.sourceUrl);
        try {
          if (!payload) {
            const fetched = await fetchResponse(fetchImpl, record.sourceUrl, signal);
            diagnosticsByUrl.set(record.sourceUrl, diagnostics(record.sourceUrl, fetched.status));
            payload = { html: fetched.text, fetchedAt };
            detailPayloads.set(record.sourceUrl, payload);
          }
          const detail = parseListingDetail(payload.html, record.sourceUrl);
          const rows = normalizeListingDetail(detail, { nowIso: payload.fetchedAt });
          const row = rows.find((candidate) => candidate.deal_type === record.dealType) ?? null;
          observations.push(
            createObservation({
              source: SOURCE_OLD_SITE,
              externalId: record.externalId ?? record.sourceUrl,
              dealType: record.dealType,
              sourceUrl: record.sourceUrl,
              propertyNoRaw: detail.legacyPropertyNo,
              fields: fieldsFor(detail, row, record.dealType),
              rawFields: sourceRawFields(payload.html),
              mediaCandidates: mediaCandidates(detail),
              sourceUpdatedAt: detail.sourceUpdatedAt,
              discoveredAt: record.discoveredAt,
              fetchedAt: payload.fetchedAt,
              parseWarnings: [],
            }),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push({
            externalId: record.externalId ?? undefined,
            code: "detail_fetch_or_parse_failed",
            detail: message,
          });
          const prior = diagnosticsByUrl.get(record.sourceUrl);
          diagnosticsByUrl.set(
            record.sourceUrl,
            diagnostics(
              record.sourceUrl,
              prior?.responseStatus ?? responseStatusFromError(error),
              "detail_fetch_or_parse_failed",
            ),
          );
          observations.push(
            createObservation({
              source: SOURCE_OLD_SITE,
              externalId: record.externalId ?? record.sourceUrl,
              dealType: record.dealType,
              sourceUrl: record.sourceUrl,
              propertyNoRaw: null,
              fields: {},
              rawFields: {},
              mediaCandidates: [],
              discoveredAt: record.discoveredAt,
              fetchedAt,
              quarantineReasons: ["detail_fetch_or_parse_failed"],
              parseWarnings: [message],
            }),
          );
        }
      }

      return {
        source: SOURCE_OLD_SITE,
        identityValid: true,
        robotsAllowed: true,
        paginationComplete,
        challengeDetected: false,
        advertisedCounts: { sale: 0, rent: 0 },
        pageCounts,
        discovered: discoveredByIdentity.size,
        observations,
        failures,
        diagnostics: [...diagnosticsByUrl.values()],
        conflictingDuplicateIds: [],
      };
    },
  };
}
