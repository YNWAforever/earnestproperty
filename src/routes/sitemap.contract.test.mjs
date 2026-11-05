import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { registerHooks } from "node:module";

import { estateSeo } from "../content/seo.ts";
import { estateRegistry, estatesWithPage } from "../content/estate-registry.ts";

// P4 Task 8 (docs/superpowers/plans/2026-08-30-frontend-revamp-p4-areas-estates.md)
// originally pinned a regression guard here: at that point in the plan,
// estate-registry.ts's 17 net-new estates were all `hasPage: false`
// (fact-less placeholders), and this file asserted estateSeo must never grow
// beyond the 5 real-detail-page slugs, or sitemap[.]xml.ts's
// `Object.values(estateSeo).map(e => \`/estate/${e.slug}\`)` would leak
// unpublished estate URLs into the sitemap.
//
// The 2026-09-01 "Estate Expansion 17" data pack changed that design: all 22
// estate-registry.ts entries now ship `hasPage: true` (see that file's own
// comment above the hoi-wan-hin block) -- every one of them is meant to get
// a real `/estate/$slug` detail page, backed by a real (but currently
// `published = false`) DB row from
// neon/migrations/20260830130000_estate_expansion.sql. `estateSeo`
// (src/content/seo.ts's Task 3) now legitimately covers all 22 slugs, so it
// can no longer double as "the set of sitemap-worthy slugs" on its own --
// sitemap[.]xml.ts now additionally filters estateSeo's paths through
// fetchSitemapTimestamps()'s live `SELECT slug FROM estates WHERE published
// = true` result (already fetched there for lastmod dates) before mapping to
// URLs, so only estates the DB actually has published = true today reach the
// sitemap. Content-level leakage was never possible either way -- an
// unpublished estate's page 404s entirely at the DB query layer
// (fetchEstateBySlug) -- this filter is purely about not advertising a
// soft-404 URL.
//
// sitemap[.]xml.ts itself cannot be imported directly under `node --test`:
// it pulls in `src/lib/neon/public-data.server.ts`, which starts with
// `import "@tanstack/react-start/server-only"` and reaches for a live DB
// connection at call time. Every other route-level test in this repo
// (district.sham-tseng.test.mjs, property.listing-detail.contract.test.mjs)
// works around this the same way: source-scan the route file's text, and
// exercise its pure, DB-independent derivation logic (here, the
// `estateSeo` → path mapping) against the real content modules directly.
// The publish-state filter itself needs a live `estates` row to actually
// exercise -- this file cannot prove that filter *excludes* an unpublished
// slug at runtime, only that the filter exists in the route's source; a
// live-DB pass (manual, or a future `*.integration.test.mjs`) is the only
// way to prove the filter's runtime behavior against real rows.

function readSitemapSource() {
  return readFileSync(new URL("./sitemap[.]xml.ts", import.meta.url), "utf8");
}

test("sitemap[.]xml.ts derives estate paths from estateSeo, filtered by live published state, never from the full estate registry", () => {
  const source = readSitemapSource();

  // estateSeo is still the curated source of which slugs get real SEO
  // copy/URLs at all -- but must be filtered by fetchSitemapTimestamps()'s
  // live published-estates result before becoming a sitemap path, not mapped
  // unconditionally (that would list every hasPage:true estate regardless of
  // DB published state).
  assert.match(
    source,
    /Object\.values\(estateSeo\)\s*\n?\s*\.filter\(\(estate\) => estate\.slug in timestamps\.estates\)/,
    "sitemap must filter estateSeo's entries by whether the slug is a key in the live fetchSitemapTimestamps().estates result",
  );
  assert.match(
    source,
    /\.map\(\(estate\) => `\/estate\/\$\{estate\.slug\}`\)/,
    "sitemap must still map the filtered estates to /estate/{slug} paths",
  );

  // estateRegistry must never be imported into this route directly -- that
  // would let path derivation drift from estateSeo's curated set without
  // anyone noticing, since nothing else in this file would obviously look
  // wrong in review.
  assert.doesNotMatch(
    source,
    /estate-registry/,
    "sitemap[.]xml.ts must not import estate-registry.ts directly",
  );
});

test("estateSeo's entry count matches exactly estate-registry.ts's hasPage:true count", () => {
  const seoSlugs = Object.keys(estateSeo).sort();
  const registryPageSlugs = estatesWithPage.map((entry) => entry.slug).sort();

  assert.deepEqual(
    seoSlugs,
    registryPageSlugs,
    "estateSeo must cover exactly the registry's hasPage:true slugs -- no more, no fewer",
  );

  // Pin the exact number too, not just set-equality -- if the registry grew
  // a new hasPage:true entry without a matching estateSeo record (or vice
  // versa), the set-equality assertion above already catches the mismatch,
  // but pinning the literal count makes an accidental registry-only or
  // estateSeo-only addition impossible to miss in review. All 22
  // estate-registry.ts entries have shipped `hasPage: true` since the
  // 2026-09-01 Estate Expansion 17 data pack (see that file's own comment);
  // Task 3 (src/content/seo.ts) brought estateSeo's count up to match.
  assert.equal(
    seoSlugs.length,
    62,
    "62 estates have content; live published state still gates the sitemap",
  );
});

test("simulating fetchSitemapTimestamps' publish filter against estateSeo never includes a slug the simulated published set excludes", () => {
  // A DB-independent stand-in for fetchSitemapTimestamps().estates -- proves
  // the *shape* of the filter (an object whose keys gate inclusion) behaves
  // correctly against real estateSeo data, without needing a live DB. This
  // cannot prove which estates are published in a real database today (that
  // answer only exists in Neon) -- only that IF the DB reports zero
  // estates published (true for all 22 as of this commit -- see
  // neon/migrations/20260830130000_estate_expansion.sql), the sitemap
  // computes zero estate paths, and IF the DB reports some estates
  // published, only those slugs' paths appear.
  function simulateSitemapEstatePaths(publishedTimestamps) {
    return Object.values(estateSeo)
      .filter((estate) => estate.slug in publishedTimestamps)
      .map((estate) => `/estate/${estate.slug}`);
  }

  assert.deepEqual(
    simulateSitemapEstatePaths({}),
    [],
    "zero published estates (today's real state) must produce zero sitemap estate paths",
  );

  const onePublished = { bellagio: "2026-01-01" };
  assert.deepEqual(
    simulateSitemapEstatePaths(onePublished),
    ["/estate/bellagio"],
    "only the slug present in the published-timestamps map should appear",
  );

  const allEstatesPublished = Object.fromEntries(
    Object.keys(estateSeo).map((slug) => [slug, "2026-01-01"]),
  );
  const allPaths = simulateSitemapEstatePaths(allEstatesPublished);
  assert.equal(allPaths.length, 62);
  assert.equal(new Set(allPaths).size, 62, "no duplicate estate paths");
});

test("a hasPage:false registry estate never gets an estateSeo entry", () => {
  // estateSeoIdentity() (seo.ts) is only called for the 22 hasPage:true
  // slugs. The 2026-10-26 unpublished production rows are hasPage:false and
  // must not reach the sitemap. This is a live canary: a placeholder estate
  // cannot leak into estateSeo (and therefore the sitemap) by construction.
  const unpublishedRegistrySlugs = estateRegistry
    .filter((entry) => !entry.hasPage)
    .map((entry) => entry.slug);

  for (const slug of unpublishedRegistrySlugs) {
    assert.equal(
      slug in estateSeo,
      false,
      `hasPage:false estate "${slug}" must have no estateSeo entry`,
    );
  }
});

// F-13 (FX-16 Task 3): lastmod is a real per-page date or it is absent. The old
// route fell back to the generation date for every page with no source, so 95
// of 466 URLs claimed to change on every crawl. lastmodFor is pure JS so the
// rule is exercised here directly; the route only gathers its sources.
const { articlePublishedAt, blogArticles } = await import("../content/blog-articles.ts");

async function lastmodModule() {
  return import("../lib/sitemap-lastmod.js");
}

function sources(overrides = {}) {
  return {
    listings: new Map(),
    estates: {},
    articles: {},
    staticArticles: Object.fromEntries(
      blogArticles.map((article) => [article.slug, articlePublishedAt(article)]),
    ),
    ...overrides,
  };
}

test("registry-only article has no public lastmod", async () => {
  const { lastmodFor } = await lastmodModule();
  assert.equal(lastmodFor("/blog/sham-tseng-buying-guide-2026", sources()), null);
});

test("only a live CMS row supplies an article lastmod", async () => {
  const { lastmodFor } = await lastmodModule();
  const withCms = sources({
    articles: { "sham-tseng-buying-guide-2026": "2026-09-30T08:15:00.000Z" },
  });
  assert.equal(lastmodFor("/blog/sham-tseng-buying-guide-2026", withCms), "2026-09-30");
  // No date is invented from a retained import/reference registry.
  const nullCms = sources({ articles: { "sham-tseng-buying-guide-2026": null } });
  assert.equal(lastmodFor("/blog/sham-tseng-buying-guide-2026", nullCms), null);
  assert.equal(
    lastmodFor("/estate/bellagio", sources({ estates: { bellagio: "2026-08-01T00:00:00.000Z" } })),
    "2026-08-01",
  );
  assert.equal(
    lastmodFor(
      "/property/T027001",
      sources({ listings: new Map([["/property/T027001", "2026-10-01T04:00:00.000Z"]]) }),
    ),
    "2026-10-01",
  );
});

test("lastmod is the Hong Kong calendar date, not the UTC one", async () => {
  const { lastmodFor } = await lastmodModule();
  const at = (updatedAt) =>
    lastmodFor(
      "/property/T027001",
      sources({ listings: new Map([["/property/T027001", updatedAt]]) }),
    );
  // An edit at 00:30 HKT on 9 October is 16:30 UTC on 8 October.
  assert.equal(at("2026-10-08T16:30:00.000Z"), "2026-10-09");
  assert.equal(at("2026-10-08 16:30:00.123+00"), "2026-10-09");
  assert.equal(at("2026-10-09T00:30:00+08:00"), "2026-10-09");
  // 23:59 HKT stays on its own day.
  assert.equal(at("2026-10-09T15:59:00.000Z"), "2026-10-09");
  assert.equal(
    lastmodFor("/estate/bellagio", sources({ estates: { bellagio: "2026-10-08T16:30:00Z" } })),
    "2026-10-09",
  );
  // The route hands lastmodFor the full timestamp, not a UTC date it sliced itself.
  assert.doesNotMatch(readSitemapSource(), /updated_at\?\.slice\(0, 10\)/);
  // Registry-only article dates do not become public lastmods.
  assert.equal(lastmodFor("/blog/sham-tseng-buying-guide-2026", sources()), null);
});

test("a page with no tracked date has no lastmod element", async () => {
  const { lastmodFor } = await lastmodModule();
  const withNullListing = sources({ listings: new Map([["/property/R000001", null]]) });
  for (const path of ["/", "/about", "/agents/x", "/property/R000001", "/estate/unknown"]) {
    assert.equal(lastmodFor(path, withNullListing), null, path);
  }
  // Inherited object keys are not dates.
  assert.equal(lastmodFor("/blog/constructor", sources()), null);
  assert.equal(lastmodFor("/estate/toString", sources()), null);

  const source = readSitemapSource();
  assert.match(source, /function urlXml\(path: string, lastmod: string \| null\)/);
  assert.match(source, /lastmod \? \[`    <lastmod>\$\{lastmod\}<\/lastmod>`\] : \[\]/);
});

test("the route no longer reads the clock for lastmod", () => {
  const source = readSitemapSource();
  assert.doesNotMatch(source, /generatedAt/);
  assert.doesNotMatch(source, /new Date\(/);
  assert.match(source, /from "@\/lib\/sitemap-lastmod\.js"/);
  assert.doesNotMatch(source, /articlePublishedAt|publishedBlogArticles/);
  assert.match(source, /fetchSitemapTimestamps/);
});

test("actual sitemap handler refreshes DB article set, preserves policy route and fails unavailable", async () => {
  let articles = { "saved-article": "2026-01-01T00:00:00Z", "escaped&slug": null };
  let fail = false;
  const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
  globalThis.__task7SitemapReads = {
    timestamps: async () => {
      if (fail) throw new Error("offline");
      return { estates: {}, articles };
    },
  };
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      const replacements = {
        "@tanstack/react-router": moduleUrl(
          "export const createFileRoute = id => options => ({id,...options});",
        ),
        "@/lib/blog/public": moduleUrl(
          'export const blogNoStoreHeaders = () => ({"Cache-Control":"no-store","CDN-Cache-Control":"no-store","Vercel-CDN-Cache-Control":"no-store"});',
        ),
        "@/content/castle-peak-road": new URL("../content/castle-peak-road.ts", import.meta.url)
          .href,
        "@/content/seo": new URL("../content/seo.ts", import.meta.url).href,
        "@/lib/sitemap-lastmod.js": new URL("../lib/sitemap-lastmod.js", import.meta.url).href,
        "@/lib/neon/public-data.server": moduleUrl(
          "export const fetchSitemapTimestamps = () => globalThis.__task7SitemapReads.timestamps(); export const fetchSitemapListings = async () => []; export const listPublicAgentProfiles = async () => [];",
        ),
        "@/lib/queries": moduleUrl(
          "export const fetchPublishedArticlesByCategory = async () => []; export const fetchRecentTransactions = async () => [];",
        ),
      };
      return replacements[specifier]
        ? { url: replacements[specifier], shortCircuit: true }
        : next(specifier, context);
    },
  });
  try {
    const { Route } = await import(new URL("./sitemap[.]xml.ts?task7", import.meta.url).href);
    const first = await Route.server.handlers.GET();
    assert.equal(first.status, 200);
    for (const key of ["Cache-Control", "CDN-Cache-Control", "Vercel-CDN-Cache-Control"])
      assert.equal(first.headers.get(key), "no-store");
    const xml = await first.text();
    assert.match(xml, /\/blog\/saved-article/);
    assert.match(xml, /escaped&amp;slug/);
    assert.match(xml, /\/blog\/editorial-standards/);
    articles = {};
    const withdrawn = await (await Route.server.handlers.GET()).text();
    assert.doesNotMatch(withdrawn, /saved-article|sham-tseng-buying-guide-2026/);
    assert.match(withdrawn, /\/blog\/editorial-standards/);
    fail = true;
    const failed = await Route.server.handlers.GET();
    assert.equal(failed.status, 503);
    assert.equal(failed.headers.get("cache-control"), "no-store");
    assert.equal(await failed.text(), "BLOG_UNAVAILABLE");
  } finally {
    hooks.deregister();
    delete globalThis.__task7SitemapReads;
  }
});
