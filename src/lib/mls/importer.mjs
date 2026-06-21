import {
  buildPagedListingUrl,
  parseListingDetail,
  parseListingIndex,
  parseMaxListingPage,
} from "./parse-old-site.mjs";
import { normalizeListingDetail } from "./normalize-old-site.mjs";

export const DEFAULT_SEED_URLS = [
  "https://www.earnestproperty.com/property/c1",
  "https://www.earnestproperty.com/property/c2",
  "https://www.earnestproperty.com/property/c5",
];

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function quotePostgrestText(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function createMlsImporter({ fetchText, db, now = () => new Date() }) {
  return {
    async discover(seedUrls = DEFAULT_SEED_URLS, { maxPages = 50 } = {}) {
      const discovered = [];

      for (const seedUrl of seedUrls) {
        const firstHtml = await fetchText(seedUrl);
        discovered.push(...parseListingIndex(firstHtml, seedUrl));

        const maxPage = Math.min(parseMaxListingPage(firstHtml), maxPages);
        for (let page = 2; page <= maxPage; page += 1) {
          const pageUrl = buildPagedListingUrl(seedUrl, page);
          const html = await fetchText(pageUrl);
          discovered.push(...parseListingIndex(html, pageUrl));
        }
      }

      return unique(discovered);
    },

    async sync({
      seedUrls = DEFAULT_SEED_URLS,
      maxDetails = 200,
      maxPages = 50,
      dryRun = false,
    } = {}) {
      const nowIso = now().toISOString();
      const estateIdsBySlug = await db.listEstateIdsBySlug();
      const discoveredUrls = await this.discover(seedUrls, { maxPages });
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

      if (dryRun) {
        return {
          discovered: discoveredUrls.length,
          selected: selectedUrls.length,
          parsed: rows.length,
          upserted: 0,
          deactivated: 0,
          errors,
          dryRunRows: rows,
        };
      }

      const upserted = rows.length ? await db.upsertProperties(rows) : { count: 0 };
      const seenLegacyIds = unique(rows.map((row) => row.legacy_detail_id));
      const deactivated = await db.deactivateMissing({
        sourceSite: "earnestproperty-old-site",
        seenLegacyIds,
        nowIso,
      });

      return {
        discovered: discoveredUrls.length,
        selected: selectedUrls.length,
        parsed: rows.length,
        upserted: upserted.count,
        deactivated: deactivated.count,
        errors,
        dryRunRows: [],
      };
    },
  };
}

export function createSupabaseMlsDb(supabase) {
  return {
    async listEstateIdsBySlug() {
      const { data, error } = await supabase.from("estates").select("id, slug");
      if (error) throw error;
      return new Map((data ?? []).map((row) => [row.slug, row.id]));
    },

    async upsertProperties(rows) {
      const { error } = await supabase
        .from("properties")
        .upsert(rows, { onConflict: "legacy_detail_id,deal_type" });
      if (error) throw error;
      return { count: rows.length };
    },

    async deactivateMissing({ sourceSite, seenLegacyIds, nowIso }) {
      if (!seenLegacyIds.length) return { count: 0 };

      const legacyIdList = `(${seenLegacyIds.map(quotePostgrestText).join(",")})`;
      const { data, error } = await supabase
        .from("properties")
        .update({ status: "inactive", updated_at: nowIso })
        .eq("source_site", sourceSite)
        .not("legacy_detail_id", "in", legacyIdList)
        .select("id");

      if (error) throw error;
      return { count: data?.length ?? 0 };
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
