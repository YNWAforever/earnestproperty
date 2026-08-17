import { createHash } from "node:crypto";
import { load } from "cheerio";

import {
  CRAWLER_USER_AGENT,
  MAX_HTML_BYTES,
  PAGE_TIMEOUT_MS,
  PolicyFetchError,
  abortableDelay,
  createPolicyFetch,
  loadRobotsPolicy,
} from "../access-policy.mjs";

import {
  buildPagedListingUrl,
  normalizeText,
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

const OLD_SITE_ORIGIN = "https://www.earnestproperty.com";
const OLD_SITE_ROBOTS_URL = `${OLD_SITE_ORIGIN}/robots.txt`;

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

function diagnostics(
  sourceUrl,
  fetched = {},
  failureCode = null,
  templateFingerprint = null,
  count = 0,
) {
  return {
    sourceUrl,
    responseStatus: Number.isInteger(fetched?.status) ? fetched.status : null,
    attempts: Number.isInteger(fetched?.attempts) ? fetched.attempts : 1,
    templateFingerprint,
    selectorCounts: count ? { listings: count } : {},
    failureCode,
  };
}

function safeOldSiteUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== OLD_SITE_ORIGIN) {
    throw new PolicyFetchError("URL leaves the approved old-site HTTPS origin", {
      code: "terminal_access",
      sourceUrl: url.toString(),
    });
  }
  return url;
}

function pageFingerprint(urls) {
  return createHash("sha256")
    .update([...urls].sort().join(","))
    .digest("hex");
}

function detectOldSiteChallenge(html) {
  const markup = String(html ?? "").toLowerCase();
  const text = normalizeText(load(markup).text()).toLowerCase();
  return (
    /captcha|cloudflare|verify you are human|access denied|just a moment/.test(text) ||
    /cf-chl-|challenge-platform|data-cf-challenge-platform/.test(markup)
  );
}

function failureDetail(code) {
  const details = {
    robots_prohibited: "Robots policy prohibits the requested source path",
    robots_unreachable: "Robots policy could not be reached safely",
    robots_terminal_access: "Robots request was denied by an access-control response",
    robots_malformed: "Robots policy requires operator review",
    crawl_delay_exceeds_run_budget: "Declared crawl delay exceeds the 30-second request budget",
    terminal_access: "Source request was denied by an access-control response",
    challenge_detected: "Source returned a challenge, CAPTCHA, or access-denied page",
    pagination_loop: "A listing page repeated before pagination completed",
    pagination_stalled: "A listing page added no new IDs before pagination completed",
    pagination_ceiling: "Pagination exceeded the configured page ceiling",
    duplicate_id_conflict: "A duplicate external ID resolved to conflicting listing metadata",
    index_fetch_failed: "An index request failed after the bounded retry policy",
    unexpected_template: "The response body exceeded the safe parsing limit",
    unexpected_index_template: "The index template could not be safely interpreted",
    detail_fetch_or_parse_failed: "The detail response could not be safely parsed",
    source_aborted: "Detail was not fetched because the source run aborted",
  };
  return details[code] ?? "Source request failed";
}

function pushFailure(failures, code, externalId) {
  failures.push({
    ...(externalId ? { externalId } : {}),
    code,
    detail: failureDetail(code),
  });
}

function robotsFailureCode(classification) {
  if (classification === "terminal_access") return "robots_terminal_access";
  if (classification === "malformed") return "robots_malformed";
  return "robots_unreachable";
}

function nonFatalWarnings(detail, row) {
  return unique(
    [detail?.parseWarnings, detail?.warnings, row?.parseWarnings, row?.warnings]
      .flatMap((warnings) => (Array.isArray(warnings) ? warnings : [warnings]))
      .map((warning) => String(warning ?? "").trim())
      .filter(Boolean),
  );
}

function stubObservation(record, fetchedAt, reason = "detail_fetch_or_parse_failed") {
  return createObservation({
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
    quarantineReasons: [reason],
    parseWarnings: [failureDetail(reason)],
  });
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
  parseDetail = parseListingDetail,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");

  return {
    async collect({ seedUrls = DEFAULT_OLD_SITE_SEED_URLS, maxPages = 50 } = {}) {
      if (!Number.isInteger(maxPages) || maxPages < 1) {
        throw new TypeError("maxPages must be a positive integer");
      }
      const failures = [];
      const diagnosticsByUrl = new Map();
      const discoveredByIdentity = new Map();
      const pageCounts = { sale: 0, rent: 0 };
      const conflictingDuplicateIds = new Set();
      let identityValid = true;
      let robotsAllowed = true;
      let paginationComplete = true;
      let challengeDetected = false;
      let aborted = false;

      const policyFetch = createPolicyFetch({ fetchImpl, sleep, random, signal, maxAttempts: 3 });
      const robots = await loadRobotsPolicy({
        policyFetch,
        robotsUrl: OLD_SITE_ROBOTS_URL,
        userAgent: CRAWLER_USER_AGENT,
      });
      diagnosticsByUrl.set(
        OLD_SITE_ROBOTS_URL,
        diagnostics(
          OLD_SITE_ROBOTS_URL,
          robots,
          robots.allowed ? null : robotsFailureCode(robots.classification),
        ),
      );
      if (!robots.allowed) {
        robotsAllowed = false;
        paginationComplete = false;
        pushFailure(failures, robotsFailureCode(robots.classification));
        return {
          source: SOURCE_OLD_SITE,
          identityValid,
          robotsAllowed,
          paginationComplete,
          challengeDetected,
          advertisedCounts: { sale: 0, rent: 0 },
          pageCounts,
          discovered: 0,
          observations: [],
          failures,
          diagnostics: [...diagnosticsByUrl.values()],
          conflictingDuplicateIds: [],
        };
      }

      const crawlDelayMs = Number.isFinite(robots.policy?.crawlDelaySeconds)
        ? Math.ceil(robots.policy.crawlDelaySeconds * 1000)
        : 0;
      if (crawlDelayMs > PAGE_TIMEOUT_MS) {
        paginationComplete = false;
        pushFailure(failures, "crawl_delay_exceeds_run_budget");
        return {
          source: SOURCE_OLD_SITE,
          identityValid,
          robotsAllowed,
          paginationComplete,
          challengeDetected,
          advertisedCounts: { sale: 0, rent: 0 },
          pageCounts,
          discovered: 0,
          observations: [],
          failures,
          diagnostics: [...diagnosticsByUrl.values()],
          conflictingDuplicateIds: [],
        };
      }

      async function fetchPage(sourceUrl) {
        const url = safeOldSiteUrl(sourceUrl);
        if (!robots.policy.isAllowed(`${url.pathname}${url.search}`)) {
          throw new PolicyFetchError("Robots policy prohibits this path", {
            code: "robots_prohibited",
            sourceUrl: url.toString(),
          });
        }
        await abortableDelay(sleep, crawlDelayMs, signal);
        return policyFetch(url.toString(), {
          timeoutMs: PAGE_TIMEOUT_MS,
          maxBytes: MAX_HTML_BYTES,
          allowedOrigin: OLD_SITE_ORIGIN,
          maxRedirects: 5,
        });
      }

      seeds: for (const seed of seedUrls) {
        const indexUrl = safeOldSiteUrl(seedUrl(seed)).toString();
        const dealType = dealTypeForSeed(seed);
        const seenFingerprints = new Set();
        let advertisedMaxPage = 1;
        for (
          let pageNumber = 1;
          pageNumber <= Math.min(advertisedMaxPage, maxPages);
          pageNumber += 1
        ) {
          const pageUrl = pageNumber === 1 ? indexUrl : buildPagedListingUrl(indexUrl, pageNumber);
          let fetched;
          try {
            fetched = await fetchPage(pageUrl);
          } catch (error) {
            const code =
              error?.code === "terminal_access"
                ? "terminal_access"
                : error?.code === "robots_prohibited"
                  ? "robots_prohibited"
                  : error?.code === "unexpected_template"
                    ? "unexpected_template"
                    : "index_fetch_failed";
            paginationComplete = false;
            aborted = true;
            if (code === "terminal_access" || code === "robots_prohibited") {
              robotsAllowed = false;
            }
            pushFailure(failures, code);
            diagnosticsByUrl.set(pageUrl, diagnostics(pageUrl, error, code));
            break seeds;
          }

          if (detectOldSiteChallenge(fetched.text)) {
            challengeDetected = true;
            paginationComplete = false;
            aborted = true;
            pushFailure(failures, "challenge_detected");
            diagnosticsByUrl.set(pageUrl, diagnostics(pageUrl, fetched, "challenge_detected"));
            break seeds;
          }

          let links;
          try {
            links = parseListingIndex(fetched.text, pageUrl).map((url) =>
              safeOldSiteUrl(url).toString(),
            );
            if (pageNumber === 1)
              advertisedMaxPage = Math.max(1, parseMaxListingPage(fetched.text));
          } catch {
            paginationComplete = false;
            aborted = true;
            identityValid = false;
            pushFailure(failures, "unexpected_index_template");
            diagnosticsByUrl.set(
              pageUrl,
              diagnostics(pageUrl, fetched, "unexpected_index_template"),
            );
            break seeds;
          }

          pageCounts[dealType] += 1;
          const fingerprint = pageFingerprint(links);
          diagnosticsByUrl.set(
            pageUrl,
            diagnostics(pageUrl, fetched, null, fingerprint, links.length),
          );
          if (seenFingerprints.has(fingerprint)) {
            paginationComplete = false;
            aborted = true;
            pushFailure(failures, "pagination_loop");
            diagnosticsByUrl.set(
              pageUrl,
              diagnostics(pageUrl, fetched, "pagination_loop", fingerprint, links.length),
            );
            break seeds;
          }
          seenFingerprints.add(fingerprint);

          let newIds = 0;
          const discoveredAt = isoNow(now);
          for (const sourceUrl of links) {
            const externalId = legacyIdFromUrl(sourceUrl);
            const identity = `${dealType}:${externalId ?? sourceUrl}`;
            const prior = discoveredByIdentity.get(identity);
            if (prior) {
              if (prior.sourceUrl !== sourceUrl) {
                conflictingDuplicateIds.add(externalId ?? sourceUrl);
                paginationComplete = false;
                aborted = true;
                pushFailure(failures, "duplicate_id_conflict", externalId);
                break;
              }
              continue;
            }
            discoveredByIdentity.set(identity, {
              sourceUrl,
              externalId,
              dealType,
              discoveredAt,
            });
            newIds += 1;
          }
          if (aborted) break seeds;
          if (newIds === 0 && pageNumber < advertisedMaxPage) {
            paginationComplete = false;
            aborted = true;
            pushFailure(failures, "pagination_stalled");
            diagnosticsByUrl.set(
              pageUrl,
              diagnostics(pageUrl, fetched, "pagination_stalled", fingerprint, links.length),
            );
            break seeds;
          }
          if (pageNumber === maxPages && advertisedMaxPage > maxPages) {
            paginationComplete = false;
            aborted = true;
            pushFailure(failures, "pagination_ceiling");
            break seeds;
          }
        }
      }

      const observations = [];
      const detailPayloads = new Map();
      const records = [...discoveredByIdentity.values()];
      for (let detailIndex = 0; !aborted && detailIndex < records.length; detailIndex += 1) {
        const record = records[detailIndex];
        const fetchedAt = isoNow(now);
        let payload = detailPayloads.get(record.sourceUrl);
        try {
          if (!payload) {
            const fetched = await fetchPage(record.sourceUrl);
            if (detectOldSiteChallenge(fetched.text)) {
              const error = new PolicyFetchError("Source challenge detected", {
                code: "challenge_detected",
                status: fetched.status,
                attempts: fetched.attempts,
                sourceUrl: record.sourceUrl,
              });
              throw error;
            }
            diagnosticsByUrl.set(record.sourceUrl, diagnostics(record.sourceUrl, fetched));
            payload = { html: fetched.text, fetchedAt };
            detailPayloads.set(record.sourceUrl, payload);
          }
          const detail = parseDetail(payload.html, record.sourceUrl);
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
              parseWarnings: nonFatalWarnings(detail, row),
            }),
          );
        } catch (error) {
          const isAccess = error?.code === "terminal_access" || error?.code === "robots_prohibited";
          const isChallenge = error?.code === "challenge_detected";
          const code = isAccess
            ? error.code
            : isChallenge
              ? "challenge_detected"
              : error?.code === "unexpected_template"
                ? "unexpected_template"
                : "detail_fetch_or_parse_failed";
          if (isAccess) robotsAllowed = false;
          if (isChallenge) challengeDetected = true;
          pushFailure(failures, code, record.externalId ?? undefined);
          diagnosticsByUrl.set(record.sourceUrl, diagnostics(record.sourceUrl, error, code));
          observations.push(stubObservation(record, fetchedAt));
          if (isAccess || isChallenge) {
            for (const remaining of records.slice(detailIndex + 1)) {
              observations.push(stubObservation(remaining, isoNow(now), "source_aborted"));
            }
            break;
          }
        }
      }

      return {
        source: SOURCE_OLD_SITE,
        identityValid,
        robotsAllowed,
        paginationComplete,
        challengeDetected,
        advertisedCounts: { sale: 0, rent: 0 },
        pageCounts,
        discovered: discoveredByIdentity.size,
        observations,
        failures,
        diagnostics: [...diagnosticsByUrl.values()],
        conflictingDuplicateIds: [...conflictingDuplicateIds].sort(),
      };
    },
  };
}
