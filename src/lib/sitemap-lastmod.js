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
 * Pure JS so `node --test` exercises it without a build step.
 */

/** @param {unknown} value */
function day(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
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
