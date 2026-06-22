import { createFileRoute } from "@tanstack/react-router";

import { castlePeakRoadSitemapPaths } from "@/content/castle-peak-road";
import { SITE_URL, blogArticles, estateSeo, pageSeo } from "@/content/seo";

const staticPaths = [
  pageSeo.home.path,
  pageSeo.listings.path,
  pageSeo.castlePeakRoad.path,
  pageSeo.shamTseng.path,
  pageSeo.tsuenWan.path,
  pageSeo.blog.path,
  pageSeo.about.path,
  pageSeo.contact.path,
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

function urlXml(path: string) {
  return [
    "  <url>",
    `    <loc>${escapeXml(`${SITE_URL}${path}`)}</loc>`,
    "    <changefreq>weekly</changefreq>",
    "    <priority>0.7</priority>",
    "  </url>",
  ].join("\n");
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const body = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...uniquePaths(staticPaths).map(urlXml),
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
