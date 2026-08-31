import { createFileRoute } from "@tanstack/react-router";

import { castlePeakRoadSitemapPaths } from "@/content/castle-peak-road";
import { SITE_URL, blogArticles, estateSeo, pageSeo } from "@/content/seo";
import { fetchSitemapTimestamps, listPublicAgentProfiles } from "@/lib/neon/public-data.server";
import { fetchPublishedArticlesByCategory, fetchRecentTransactions } from "@/lib/queries";

const staticPaths = [
  pageSeo.home.path,
  pageSeo.listings.path,
  pageSeo.castlePeakRoad.path,
  pageSeo.shamTseng.path,
  // /district/tsuen-wan is intentionally absent: the client pruned 荃灣 from the
  // district navigation, so the page has no inbound internal link. Advertising
  // an orphan in the sitemap invites a soft-404; the URL still resolves for
  // anyone arriving from an external link.
  pageSeo.blog.path,
  pageSeo.about.path,
  pageSeo.contact.path,
  pageSeo.privacy.path,
  pageSeo.disclaimer.path,
  pageSeo.terms.path,
  "/mortgage",
  "/agents",
  "/videos",
  ...Object.values(estateSeo).map((estate) => `/estate/${estate.slug}`),
  ...blogArticles.map((article) => `/blog/${article.slug}`),
  ...castlePeakRoadSitemapPaths,
];

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

function urlXml(path: string, lastmod: string) {
  return [
    "  <url>",
    `    <loc>${escapeXml(`${SITE_URL}${path}`)}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    "    <changefreq>weekly</changefreq>",
    "    <priority>0.7</priority>",
    "  </url>",
  ].join("\n");
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const agentPaths = await listPublicAgentProfiles()
          .then((profiles) =>
            profiles.flatMap((profile) =>
              profile.public_slug ? [`/agents/${profile.public_slug}`] : [],
            ),
          )
          .catch((error: unknown) => {
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
        const [transactions, estateReviewArticles, timestamps] = await Promise.all([
          fetchRecentTransactions({ limit: 1 }).catch(() => []),
          fetchPublishedArticlesByCategory("屋苑開箱").catch(() => []),
          fetchSitemapTimestamps().catch(
            (): Awaited<ReturnType<typeof fetchSitemapTimestamps>> => ({
              estates: {},
              articles: {},
            }),
          ),
        ]);
        const conditionalPaths = [
          transactions.length > 0 ? "/transactions" : null,
          estateReviewArticles.length > 0 ? "/estate-reviews" : null,
        ].filter((path) => path !== null);

        // Most pages here (home, about, district hubs, corridor pages, ...)
        // have no tracked per-page revision history, so they share one
        // generation timestamp rather than a fabricated per-page value -- an
        // honest "this sitemap was generated at" signal. Estate and article
        // pages DO have a real updated_at (fetchSitemapTimestamps, both
        // columns already written by the admin CMS's archive/publish paths),
        // so those get their actual last-modified date instead.
        const generatedAt = new Date().toISOString().slice(0, 10);
        function lastmodFor(path: string): string {
          if (path.startsWith("/estate/")) {
            const slug = path.slice("/estate/".length);
            return timestamps.estates[slug]?.slice(0, 10) ?? generatedAt;
          }
          if (path.startsWith("/blog/")) {
            const slug = path.slice("/blog/".length);
            return timestamps.articles[slug]?.slice(0, 10) ?? generatedAt;
          }
          return generatedAt;
        }
        const body = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...uniquePaths([...staticPaths, ...conditionalPaths, ...agentPaths]).map((path) =>
            urlXml(path, lastmodFor(path)),
          ),
          "</urlset>",
        ].join("\n");

        return new Response(body, {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
