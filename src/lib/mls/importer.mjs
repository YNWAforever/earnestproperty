import { parseListingDetail } from "./parse-old-site.mjs";
import { normalizeListingDetail } from "./normalize-old-site.mjs";
import { DEFAULT_OLD_SITE_SEED_URLS, discoverOldSitePages } from "./sources/old-site.mjs";

export const DEFAULT_SEED_URLS = DEFAULT_OLD_SITE_SEED_URLS.map(({ url }) => url);
export { DEFAULT_OLD_SITE_SEED_URLS };

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function legacyIdFromUrl(url) {
  return String(url ?? "").match(/property-detail\/(\d+)\.html/i)?.[1] ?? null;
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
    } = {}) {
      const nowIso = now().toISOString();
      const estateIdsBySlug = await db.listEstateIdsBySlug();
      const discoveredUrls = await this.discover(seedUrls, { maxPages });
      // Detail fetch is limited to maxDetails, but discovery sees every listing.
      const detailFetched = discoveredUrls.length <= maxDetails;
      const selectedUrls = discoveredUrls.slice(0, maxDetails);
      const rows = [];
      const errors = [];

      for (const url of selectedUrls) {
        try {
          const html = await fetchText(url);
          const detail = parseListingDetail(html, url);
          rows.push(...normalizeListingDetail(detail, { estateIdsBySlug, nowIso }));
        } catch (error) {
          errors.push({ url, message: error instanceof Error ? error.message : String(error) });
        }
      }

      // Deactivation must compare against the FULL set of discovered legacy ids,
      // never just the sliced/fetched subset — otherwise listings beyond
      // maxDetails would be wrongly marked inactive on every partial run.
      const discoveredLegacyIds = unique(discoveredUrls.map(legacyIdFromUrl));
      // Only sweep when we trust the discovered set covers every live listing:
      // an explicit fullSync, or a run small enough that we fetched every detail.
      const canDeactivate = fullSync || detailFetched;

      if (dryRun) {
        return {
          discovered: discoveredUrls.length,
          selected: selectedUrls.length,
          parsed: rows.length,
          upserted: 0,
          deactivated: 0,
          deactivationSkipped: !canDeactivate,
          deactivationBlocked: null,
          deactivationCoverage: null,
          errors,
          dryRunRows: rows,
        };
      }

      const upserted = rows.length ? await db.upsertProperties(rows) : { count: 0 };
      const deactivated = canDeactivate
        ? await db.deactivateMissing({
            sourceSite: "earnestproperty-old-site",
            seenLegacyIds: discoveredLegacyIds,
            nowIso,
          })
        : { count: 0 };

      return {
        discovered: discoveredUrls.length,
        selected: selectedUrls.length,
        parsed: rows.length,
        upserted: upserted.count,
        deactivated: deactivated.count,
        deactivationSkipped: !canDeactivate,
        // The DB layer refuses to sweep when the discovery pass covered too
        // little of the live inventory to be trusted. Surfaced rather than
        // swallowed: a silent "deactivated: 0" is how a degraded run used to
        // look identical to a healthy one.
        deactivationBlocked: deactivated.skipped ?? null,
        deactivationCoverage: deactivated.coverage ?? null,
        errors,
        dryRunRows: [],
      };
    },
  };
}

export async function defaultFetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "EarnestPropertyBot/1.0 (+https://earnestproperty.vercel.app)",
    },
  });

  if (!response.ok) throw new Error(`Fetch failed ${response.status} for ${url}`);
  return response.text();
}
