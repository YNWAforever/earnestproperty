import { createFileRoute } from "@tanstack/react-router";

import { articlePublishedAt, publishedBlogArticles } from "@/content/blog-articles";
import { castlePeakRoadSitemapPaths } from "@/content/castle-peak-road";
import { SITE_URL, estateSeo, pageSeo } from "@/content/seo";
import {
  fetchSitemapListings,
  fetchSitemapTimestamps,
  listPublicAgentProfiles,
} from "@/lib/neon/public-data.server";
import { fetchPublishedArticlesByCategory, fetchRecentTransactions } from "@/lib/queries";
import { lastmodFor } from "@/lib/sitemap-lastmod.js";

const staticPaths = [
  pageSeo.home.path,
  pageSeo.listings.path,
  // /castle-peak-road arrives via castlePeakRoadSitemapPaths below.
  pageSeo.shamTseng.path,
  // /district/tsuen-wan is intentionally absent: the client pruned 荃灣 from the
  // district navigation, so the page has no inbound internal link. Advertising
  // an orphan in the sitemap invites a soft-404; the URL still resolves for
  // anyone arriving from an external link.
  pageSeo.blog.path,
  pageSeo.blogEditorialStandards.path,
  pageSeo.about.path,
  pageSeo.contact.path,
  pageSeo.privacy.path,
  pageSeo.disclaimer.path,
  pageSeo.terms.path,
  "/mortgage",
  "/agents",
  "/videos",
  // Article URLs are NOT here: 28 屋苑開箱 articles are scheduled for future
  // dates, and a module-level list would freeze the set at server boot and
  // advertise a URL that still 404s. They are appended per request below.
  ...castlePeakRoadSitemapPaths,
];

/** How many 屋苑開箱 articles are public right now, independent of the CMS.
 * Evaluated per request because the set grows on a schedule. */
function staticEstateReviewCount(): number {
  return publishedBlogArticles().filter((article) => article.category === "屋苑開箱").length;
}

function uniquePaths(paths: string[]) {
  return Array.from(new Set(paths)).filter((path) => path !== "/district/ting-kau");
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// No changefreq/priority: Google ignores both, and a uniform weekly/0.7 on
// every URL carried no information anyway. lastmod is the signal that matters,
// so it is omitted when the page has no real date (see sitemap-lastmod.js).
function urlXml(path: string, lastmod: string | null) {
  return [
    "  <url>",
    `    <loc>${escapeXml(`${SITE_URL}${path}`)}</loc>`,
    ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
    "  </url>",
  ].join("\n");
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        let degraded = false;
        const agentPaths = await listPublicAgentProfiles()
          .then((profiles) =>
            profiles.flatMap((profile) =>
              profile.public_slug ? [`/agents/${profile.public_slug}`] : [],
            ),
          )
          .catch((error: unknown) => {
            degraded = true;
            // Silently swallowing this meant a DB blip shipped a sitemap with
            // zero agent URLs and nobody found out. Still degrade gracefully
            // (a missing sitemap entirely is worse for SEO than one missing
            // 23 agent URLs), but make the failure loud in server logs.
            console.error(
              "[sitemap] listPublicAgentProfiles failed; shipping sitemap without agent URLs",
              error,
            );
            return [];
          });

        // /transactions and /estate-reviews render a graceful "暫未有資料" empty
        // state rather than 404ing, which is the right UX -- but advertising an
        // empty page in the sitemap is a soft-404 risk. Only list them once they
        // have real rows; both routes also stamp their own noindex meta in the
        // same empty case (see their head()), so this self-heals the moment
        // data lands with no further deploy needed.
        const [transactions, estateReviewArticles, timestamps, listings] = await Promise.all([
          fetchRecentTransactions({ limit: 1 }).catch(() => {
            degraded = true;
            return [];
          }),
          fetchPublishedArticlesByCategory("屋苑開箱").catch(() => {
            degraded = true;
            return [];
          }),
          fetchSitemapTimestamps().catch((): Awaited<ReturnType<typeof fetchSitemapTimestamps>> => {
            degraded = true;
            return { estates: {}, articles: {} };
          }),
          // The listing detail pages are the site's money pages and the only
          // ones carrying RealEstateListing JSON-LD; they were absent here.
          fetchSitemapListings().catch((error: unknown) => {
            degraded = true;
            console.error(
              "[sitemap] fetchSitemapListings failed; shipping without listings",
              error,
            );
            return [] as Awaited<ReturnType<typeof fetchSitemapListings>>;
          }),
        ]);
        const conditionalPaths = [
          transactions.length > 0 ? "/transactions" : null,
          // /estate-reviews now has a static 屋苑開箱 floor (see that route's
          // own fallbackArticles), so the page is only empty if BOTH the CMS
          // and the static set are, and gating solely on the CMS query kept a
          // populated page out of the sitemap.
          estateReviewArticles.length > 0 || staticEstateReviewCount() > 0
            ? "/estate-reviews"
            : null,
        ].filter((path) => path !== null);

        // Only estates the DB actually has published = true today belong in
        // the sitemap. estateSeo (src/content/seo.ts) curates real SEO copy
        // for all 22 registry estates as of the 2026-09-01 Estate Expansion
        // 17 data pack, so each has a real title/description the moment it
        // publishes -- but listing an unpublished estate's URL here would
        // still be a soft-404 risk (the page itself already 404s at the DB
        // query layer, see fetchEstateBySlug, so no unverified content ever
        // leaks -- this filter is purely about sitemap hygiene). timestamps.
        // estates's keys are exactly `SELECT slug FROM estates WHERE
        // published = true` (fetchSitemapTimestamps, already awaited above
        // for lastmod dates) -- reused here as the live publish-state
        // filter rather than issuing a second query for the same fact.
        const publishedEstatePaths = Object.values(estateSeo)
          .filter((estate) => estate.slug in timestamps.estates)
          .map((estate) => `/estate/${estate.slug}`);
        // CMS-authored articles (published = true) that have no static entry in
        // blog-articles.ts -- timestamps.articles's keys are exactly that set,
        // so no second query.
        const publishedArticlePaths = Object.keys(timestamps.articles).map(
          (slug) => `/blog/${slug}`,
        );

        // Listing, estate and article pages have a real updated_at, and static
        // articles an authored date. Every other page (home, about, district
        // hubs, corridor pages, agents ...) has no tracked revision date, so its
        // <url> carries no <lastmod> at all rather than the generation date.
        const listingLastmod = new Map(
          listings.map((listing) => [
            `/property/${listing.public_listing_no}`,
            // The full timestamp: lastmodFor takes the HKT calendar date from it.
            listing.updated_at ?? null,
          ]),
        );
        const listingPaths = Array.from(listingLastmod.keys());
        const staticArticles = publishedBlogArticles();
        const lastmodSources = {
          listings: listingLastmod,
          estates: timestamps.estates,
          articles: timestamps.articles,
          staticArticles: Object.fromEntries(
            staticArticles.map((article) => [article.slug, articlePublishedAt(article)]),
          ),
        };
        const body = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...uniquePaths([
            ...staticPaths,
            ...staticArticles.map((article) => `/blog/${article.slug}`),
            ...publishedEstatePaths,
            ...publishedArticlePaths,
            ...conditionalPaths,
            ...agentPaths,
            ...listingPaths,
          ]).map((path) => urlXml(path, lastmodFor(path, lastmodSources))),
          "</urlset>",
        ].join("\n");

        return new Response(body, {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": degraded ? "no-store" : "public, max-age=3600, s-maxage=3600",
          },
        });
      },
    },
  },
});
