import { createEstateResolver } from "./estate-resolver.mjs";
import { normalizeListingDetail } from "./normalize-old-site.mjs";
import { parseListingDetail } from "./parse-old-site.mjs";
import { DEFAULT_OLD_SITE_SEED_URLS, discoverOldSitePages } from "./sources/old-site.mjs";

const DEFAULT_OLD_SITE_ORIGIN = "https://www.earnestproperty.com.hk";

/**
 * Origin of the legacy public site. The `.com` domain now redirects to the new
 * site (and the `.com.hk` certificate is not yet valid), so sync targets
 * `.com.hk` by default; operators can override the origin without a code change.
 */
export const OLD_SITE_ORIGIN = (process.env.OLD_SITE_ORIGIN || DEFAULT_OLD_SITE_ORIGIN).replace(
  /\/+$/,
  "",
);

export const DEFAULT_SEED_URLS = [
  "/property/",
  "/property/c1/",
  "/property/c2/",
  "/property/c5/",
].map((path) => `${OLD_SITE_ORIGIN}${path}`);
export { DEFAULT_OLD_SITE_SEED_URLS };

/** Source-site key used in `properties.source_site` for the legacy inventory. */
export const SOURCE_SITE = "earnestproperty-old-site";

/**
 * Maximum share of detail fetches/parses allowed to fail before an apply run
 * refuses to touch the database. A healthy crawl of the legacy pages fails at
 * well under 1%.
 */
export const MAX_DETAIL_ERROR_RATE = 0.02;

/**
 * Minimum number of discovered listing ids before a sweep is allowed. The live
 * inventory is ~600 listings; fewer than 300 ids means the index pagination
 * collapsed and sweeping would deactivate live inventory silently.
 */
export const MIN_DISCOVERED_FOR_SWEEP = 300;

export const DEFAULT_USER_AGENT = "EarnestPropertySync/1.0 (+https://www.earnestproperty.com)";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const RETRY_DELAYS_MS = [1000, 4000, 10000];

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function legacyIdFromUrl(url) {
  return String(url ?? "").match(/property-detail\/(\d+)\.html/i)?.[1] ?? null;
}

export function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchFailedError(message, { status = null, retryable = false, cause = null } = {}) {
  const error = new Error(message);
  error.code = "fetch_failed";
  error.status = status;
  error.retryable = retryable;
  if (cause) error.cause = cause;
  return error;
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

function parseRetryAfterMs(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw) * 1000;
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, timestamp - Date.now());
}

/**
 * Build a hardened `fetchText(url)` for the legacy site: bounded timeout,
 * bounded response size, retries with backoff only on transient failures
 * (network errors, 408, 425, 429, 5xx) and strict TLS (no certificate bypass).
 */
export function createHardenedFetchText({
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  userAgent = DEFAULT_USER_AGENT,
  retries = 3,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  const maxRetries = Number.isInteger(retries) && retries > 0 ? retries : 0;

  return async function fetchText(url) {
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const fallbackDelay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
      let retryAfterMs = null;

      try {
        const response = await fetchImpl(url, {
          headers: { "user-agent": userAgent },
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (response.ok) {
          const declaredLength = Number(response.headers?.get?.("content-length"));
          if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
            throw fetchFailedError(`response_too_large for ${url}`, {
              status: response.status,
              retryable: false,
            });
          }
          const text = await response.text();
          if (text.length > maxBytes) {
            throw fetchFailedError(`response_too_large for ${url}`, {
              status: response.status,
              retryable: false,
            });
          }
          return text;
        }

        const error = fetchFailedError(`Fetch failed ${response.status} for ${url}`, {
          status: response.status,
          retryable: isRetryableStatus(response.status),
        });
        if (!error.retryable) throw error;
        lastError = error;
        retryAfterMs = parseRetryAfterMs(response.headers?.get?.("retry-after"));
      } catch (thrown) {
        if (thrown?.retryable === false) throw thrown;
        // Network errors, including AbortSignal.timeout(), are transient.
        lastError =
          thrown instanceof Error
            ? thrown
            : fetchFailedError(String(thrown), { retryable: true, cause: thrown });
        if (lastError.code !== "fetch_failed") {
          lastError = fetchFailedError(`Fetch failed for ${url}: ${lastError.message}`, {
            retryable: true,
            cause: lastError,
          });
        }
      }

      if (attempt === maxRetries) break;
      await sleep(retryAfterMs ?? fallbackDelay);
    }

    throw fetchFailedError(`Fetch failed for ${url} after ${maxRetries + 1} attempts`, {
      status: lastError?.status ?? null,
      retryable: false,
      cause: lastError,
    });
  };
}

let defaultHardenedFetchText = null;

export function defaultFetchText(url) {
  defaultHardenedFetchText ??= createHardenedFetchText();
  return defaultHardenedFetchText(url);
}

function detailValidationError(detail, rows) {
  if (!detail.legacyDetailId) return "invalid_detail:missing_legacy_detail_id";
  if (!rows.length) return "invalid_detail:no_deal_rows";
  if (rows.some((row) => row.saleable_area == null && row.gross_area == null)) {
    return "invalid_detail:missing_area";
  }
  return null;
}

function seenPairsFor(rows) {
  const seen = [];
  const keys = new Set();
  for (const row of rows) {
    const id = row.legacy_detail_id;
    const dealType = row.deal_type;
    if (!id || !dealType) continue;
    const key = `${id}\0${dealType}`;
    if (keys.has(key)) continue;
    keys.add(key);
    seen.push([id, dealType]);
  }
  return seen;
}

export function createMlsImporter({ fetchText, db, now = () => new Date() }) {
  return {
    async discover(seedUrls = DEFAULT_SEED_URLS, { maxPages = 50 } = {}) {
      return discoverOldSitePages({ fetchText, seedUrls, maxPages });
    },

    async sync({
      seedUrls = DEFAULT_SEED_URLS,
      maxDetails = 200,
      maxPages = 50,
      dryRun = false,
      fullSync = false,
      allowLowCoverage = false,
    } = {}) {
      const nowIso = now().toISOString();

      let resolveLocation = null;
      if (typeof db.listEstates === "function") {
        const estates = await db.listEstates();
        resolveLocation = createEstateResolver(estates).resolveLocation;
      }
      const estateIdsBySlug =
        typeof db.listEstateIdsBySlug === "function" ? await db.listEstateIdsBySlug() : new Map();

      const discoveredUrls = await this.discover(seedUrls, { maxPages });
      // Detail fetch is limited to maxDetails, but discovery sees every listing.
      const detailFetched = discoveredUrls.length <= maxDetails;
      const selectedUrls = discoveredUrls.slice(0, maxDetails);
      const rows = [];
      const errors = [];
      let fetched = 0;

      for (const url of selectedUrls) {
        try {
          const html = await fetchText(url);
          fetched += 1;
          const detail = parseListingDetail(html, url);
          const detailRows = normalizeListingDetail(detail, {
            estateIdsBySlug,
            nowIso,
            resolveLocation,
          });
          const validationError = detailValidationError(detail, detailRows);
          if (validationError) {
            errors.push({ url, message: validationError });
            continue;
          }
          rows.push(...detailRows);
        } catch (error) {
          errors.push({ url, message: error instanceof Error ? error.message : String(error) });
        }
      }

      // Deactivation must compare against the FULL set of discovered legacy ids,
      // never just the sliced/fetched subset — otherwise listings beyond
      // maxDetails would be wrongly marked inactive on every partial run.
      const discoveredLegacyIds = unique(discoveredUrls.map(legacyIdFromUrl));
      const seenPairs = seenPairsFor(rows);
      const seenPairIds = new Set(seenPairs.map(([id]) => id));
      const protectedLegacyIds = discoveredLegacyIds.filter((id) => !seenPairIds.has(id));

      const errorRate = errors.length / Math.max(1, selectedUrls.length);
      const errorBudgetExceeded = errorRate > MAX_DETAIL_ERROR_RATE;
      const discoveryTooSmall = discoveredUrls.length < MIN_DISCOVERED_FOR_SWEEP;
      // Only sweep when we trust the discovered set covers every live listing:
      // an explicit fullSync or a run small enough that we fetched every detail,
      // enough discovered ids to rule out a collapsed pagination pass, and a
      // healthy detail parse rate.
      const canDeactivate =
        (fullSync || detailFetched) && !discoveryTooSmall && !errorBudgetExceeded;
      const deactivationBlocked =
        !canDeactivate && discoveryTooSmall ? "DISCOVERY_TOO_SMALL" : null;

      const estateResolved = rows.filter((row) => Boolean(row.estate_id)).length;
      const canonicalMissing = rows.filter((row) => !row.legacy_property_no).length;

      const baseReport = {
        discovered: discoveredUrls.length,
        selected: selectedUrls.length,
        parsed: rows.length,
        fetched,
        errorRate,
        errorBudgetExceeded,
        discoveredLegacyIds,
        canDeactivate,
        canonicalMissing,
        estateResolved,
        estateUnresolved: rows.length - estateResolved,
        protectedLegacyIds,
        pairsSeen: seenPairs,
        errors,
        coverageOverride: false,
        // Cross-source listing_no collisions (another feed already serves the
        // same listing under the unique listing_no). Skipped, not overwritten;
        // only known after an apply write pass.
        conflicts: [],
        skippedConflicts: 0,
      };

      if (dryRun) {
        return {
          ...baseReport,
          upserted: 0,
          deactivated: 0,
          deactivationSkipped: !canDeactivate,
          deactivationBlocked,
          deactivationCoverage: null,
          dryRunRows: rows,
        };
      }

      // Never let a degraded crawl reach the database: a 2%+ detail failure
      // rate means the parsed rows cannot be trusted to represent the inventory.
      if (errorBudgetExceeded) {
        const error = new Error("detail_error_budget_exceeded");
        error.code = "detail_error_budget_exceeded";
        error.errorRate = errorRate;
        throw error;
      }

      const upserted = rows.length ? await db.upsertProperties(rows) : { count: 0 };
      const conflicts = Array.isArray(upserted.conflicts) ? upserted.conflicts : [];
      const deactivated = canDeactivate
        ? await db.deactivateMissing({
            sourceSite: SOURCE_SITE,
            seenLegacyIds: discoveredLegacyIds,
            seenPairs,
            protectedLegacyIds,
            nowIso,
            allowLowCoverage: allowLowCoverage === true,
          })
        : { count: 0 };

      return {
        ...baseReport,
        upserted: upserted.count,
        deactivated: deactivated.count,
        deactivationSkipped: !canDeactivate,
        // The DB layer refuses to sweep when the discovery pass covered too
        // little of the live inventory to be trusted. Surfaced rather than
        // swallowed: a silent "deactivated: 0" is how a degraded run used to
        // look identical to a healthy one.
        deactivationBlocked: deactivated.skipped ?? deactivationBlocked,
        deactivationCoverage: deactivated.coverage ?? null,
        // A deliberate one-off reconciliation of the stale 2026-08 inventory
        // may need to withdraw more than the 30% delta the coverage guard
        // tolerates. The override is opt-in (CLI flag, never the daily
        // workflow) and always reported so the sweep is auditable.
        coverageOverride: deactivated.coverageOverride ?? false,
        conflicts,
        skippedConflicts: conflicts.length,
        dryRunRows: [],
      };
    },
  };
}
