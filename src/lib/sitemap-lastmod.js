/**
 * F-13: a sitemap `<lastmod>` is the page's real last-modified date, or it is
 * absent. It is never the date the sitemap was generated: a URL whose lastmod
 * moves on every crawl tells search engines nothing, and teaches them to
 * ignore the field for the whole site.
 *
 * Sources, most specific first:
 * - `/property/*`: the listing row's `updated_at`.
 * - `/estate/*`: the estate row's `updated_at`.
 * - `/blog/*`: the CMS article's `updated_at`, else the static article's
 *   authored date (`articlePublishedAt`).
 * - everything else (home, hubs, agents ...): no tracked date, so null.
 *
 * Dates are Hong Kong calendar dates: a timestamp that carries a zone (`Z`,
 * `+00`, `+08:00` ...) is converted to HKT (UTC+8, no DST) before the date is
 * taken, so an edit at 00:30 HKT is dated that day, not the previous UTC day.
 * A bare `YYYY-MM-DD` (an authored date) is already a calendar date.
 *
 * Pure JS so `node --test` exercises it without a build step.
 */

const HKT_OFFSET_MS = 8 * 60 * 60 * 1000;
const ZONED_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}(?::?\d{2})?)$/i;

/** @param {unknown} value */
function day(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const zoned = value.trim().match(ZONED_TIMESTAMP);
  if (zoned) {
    // Postgres text output writes `+00`; Date.parse wants `+00:00`.
    const zone = /^[+-]\d{2}$/.test(zoned[3]) ? `${zoned[3]}:00` : zoned[3];
    const ms = Date.parse(`${zoned[1]}T${zoned[2]}${zone}`);
    if (!Number.isNaN(ms)) return new Date(ms + HKT_OFFSET_MS).toISOString().slice(0, 10);
  }
  return value.slice(0, 10);
}

/**
 * Own-property lookup, so a slug such as `constructor` never reads
 * `Object.prototype`.
 * @param {Record<string, string | null>} record
 * @param {string} key
 */
function own(record, key) {
  return Object.hasOwn(record, key) ? record[key] : null;
}

/**
 * @param {string} path
 * @param {{ listings: Map<string, string|null>, estates: Record<string, string|null>,
 *           articles: Record<string, string|null>, staticArticles: Record<string, string> }} sources
 * @returns {string | null}  YYYY-MM-DD, or null to omit <lastmod>
 */
export function lastmodFor(path, sources) {
  if (sources.listings.has(path)) return day(sources.listings.get(path));
  if (path.startsWith("/estate/")) {
    return day(own(sources.estates, path.slice("/estate/".length)));
  }
  if (path.startsWith("/blog/")) {
    const slug = path.slice("/blog/".length);
    return day(own(sources.articles, slug)) ?? day(own(sources.staticArticles, slug));
  }
  return null;
}
