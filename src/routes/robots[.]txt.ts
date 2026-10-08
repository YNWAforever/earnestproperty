import { createFileRoute } from "@tanstack/react-router";

import { SITE_URL } from "@/content/seo";

// Served by the app rather than public/robots.txt so the Sitemap line follows
// SITE_URL (VITE_SITE_URL) instead of a hardcoded host. Staff surfaces and the
// JSON API are not for crawling.
export const ROBOTS_TXT = [
  "User-agent: *",
  "Allow: /",
  "Disallow: /admin",
  "Disallow: /auth",
  "Disallow: /account",
  "Disallow: /api",
  "Disallow: /w/",
  "",
  `Sitemap: ${SITE_URL}/sitemap.xml`,
  "",
].join("\n");

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(ROBOTS_TXT, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        }),
    },
  },
});
