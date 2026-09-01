import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

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
  assert.equal(seoSlugs.length, 22, "all 22 registry estates should have a live detail page today");
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
  assert.equal(allPaths.length, 22);
  assert.equal(new Set(allPaths).size, 22, "no duplicate estate paths");
});

test("a hasPage:false registry estate (none exist today) would never get an estateSeo entry to begin with", () => {
  // estateSeoIdentity() (seo.ts) is only ever called for the 22 hasPage:true
  // slugs -- a hasPage:false estate has no estateSeo entry at all, so it's
  // structurally impossible for it to reach the sitemap regardless of the
  // publish-state filter tested above. This is a live canary, not a stale
  // pin: today estateRegistry has zero hasPage:false entries, but if a
  // future estate is added as a placeholder again, this proves it still
  // can't leak into estateSeo (and therefore the sitemap) by construction.
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

// P7a: estate and article URLs get a real per-page lastmod (their tables'
// own updated_at) instead of sharing the sitemap's one generation timestamp
// with every other page -- most other pages have no tracked per-page change
// signal at all, so they keep the shared timestamp (an honest "generated at"
// value, not a fabricated per-page one).
test("sitemap gives estate and article URLs a real lastmod, falling back to the generation timestamp only when no real date exists", () => {
  const source = readSitemapSource();

  assert.match(source, /fetchSitemapTimestamps/);
  assert.match(
    source,
    /path\.startsWith\("\/estate\/"\)/,
    "estate URLs should look up a real per-slug date",
  );
  assert.match(
    source,
    /path\.startsWith\("\/blog\/"\)/,
    "article URLs should look up a real per-slug date",
  );
  assert.match(
    source,
    /timestamps\.estates\[slug\]\?\.slice\(0, 10\) \?\? generatedAt/,
    "an estate with no real updated_at should fall back to the shared generation timestamp, not a fabricated date",
  );
  assert.match(
    source,
    /timestamps\.articles\[slug\]\?\.slice\(0, 10\) \?\? generatedAt/,
    "an article with no real updated_at should fall back to the shared generation timestamp, not a fabricated date",
  );
});
