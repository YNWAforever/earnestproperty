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
// (src/content/seo.ts's Task 3) now legitimately covers all 22 slugs, and
// gating on whether a page is actually live moved to the DB `published`
// column -- checked at the SQL layer by `fetchEstateBySlug`, which 404s an
// unpublished row entirely -- rather than to registry-level `hasPage` or
// sitemap-level exclusion.
//
// This file still pins two real invariants: (1) sitemap[.]xml.ts must keep
// deriving estate paths from `estateSeo`, never `estateRegistry` directly,
// so estateSeo stays the one place that curates which slugs are
// sitemap-worthy; and (2) estateSeo must exactly match the registry's
// hasPage:true set (today, all 22) so the two can never silently diverge.
//
// sitemap[.]xml.ts itself cannot be imported directly under `node --test`:
// it pulls in `src/lib/neon/public-data.server.ts`, which starts with
// `import "@tanstack/react-start/server-only"` and reaches for a live DB
// connection at call time. Every other route-level test in this repo
// (district.sham-tseng.test.mjs, property.listing-detail.contract.test.mjs)
// works around this the same way: source-scan the route file's text, and
// exercise its pure, DB-independent derivation logic (here, the
// `estateSeo` → path mapping) against the real content modules directly.

function readSitemapSource() {
  return readFileSync(new URL("./sitemap[.]xml.ts", import.meta.url), "utf8");
}

test("sitemap[.]xml.ts enumerates estate paths from estateSeo, not the full estate registry", () => {
  const source = readSitemapSource();

  // The one line this whole test suite exists to guard: the sitemap must map
  // over estateSeo's *values*, not estateRegistry's directly -- even though
  // both are 22 entries wide today, estateSeo is the file that curates real
  // title/description SEO copy per estate, and is the intended single source
  // of truth for "does this slug get a sitemap URL".
  assert.match(
    source,
    /Object\.values\(estateSeo\)\.map\(\(estate\) => `\/estate\/\$\{estate\.slug\}`\)/,
    "sitemap must derive estate URLs from Object.values(estateSeo)",
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

test("the sitemap's computed estate paths match every hasPage:true registry slug, with no duplicates", () => {
  // Reproduce sitemap[.]xml.ts's actual derivation logic (Object.values(estateSeo)
  // .map(estate => `/estate/${estate.slug}`)) against the real content module,
  // rather than trusting the source-scan regex alone to prove the *data*, not
  // just the *code shape*, is correct.
  const sitemapEstatePaths = Object.values(estateSeo).map((estate) => `/estate/${estate.slug}`);

  assert.equal(sitemapEstatePaths.length, 22);
  assert.equal(
    new Set(sitemapEstatePaths).size,
    22,
    "no duplicate estate paths in the sitemap's estate URL list",
  );

  // All 22 estate-registry.ts entries ship hasPage:true today (2026-09-01
  // Estate Expansion 17 data pack), so this loop is a live canary rather
  // than a stale pin: if a future edit ever reintroduces a hasPage:false
  // entry, its slug must NOT appear in the sitemap's estate paths. Whether a
  // page is actually reachable today is gated at the DB `published` column
  // (fetchEstateBySlug's SQL filter 404s an unpublished row entirely), not
  // by sitemap exclusion -- but a hasPage:false estate has no estateSeo
  // entry at all (per the assertion above), so it can never reach the
  // sitemap regardless.
  const unpublishedSlugs = estateRegistry
    .filter((entry) => !entry.hasPage)
    .map((entry) => entry.slug);

  for (const slug of unpublishedSlugs) {
    assert.equal(
      sitemapEstatePaths.includes(`/estate/${slug}`),
      false,
      `hasPage:false estate "${slug}" must never appear in the sitemap's estate URLs`,
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
