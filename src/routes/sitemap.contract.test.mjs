import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { estateSeo } from "../content/seo.ts";
import { estateRegistry, estatesWithPage } from "../content/estate-registry.ts";

// P4 Task 8 (docs/superpowers/plans/2026-08-30-frontend-revamp-p4-areas-estates.md):
// dedicated regression guard for the sitemap leak risk the plan called out by
// name -- Task 1 made estateSeo (src/content/seo.ts) *derive* its identity
// fields from estate-registry.ts, which grew from 10 to 22 entries in Task 2
// (17 new, fact-less, `published = false` estates). If that derivation had
// accidentally widened from "the hasPage:true subset" to "every registry
// entry", sitemap[.]xml.ts's `Object.values(estateSeo).map(e => \`/estate/${e.slug}\`)`
// would silently start publishing 17 unpublished, photo-less, fact-less
// estate URLs into the sitemap. This file pins the current, correct
// behaviour so a future edit that re-widens estateSeo fails loudly here
// instead of shipping a silent SEO regression.
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
  // over estateSeo's *values*, not estateRegistry's -- estateRegistry is 22
  // entries wide (10 client-approved + 12 net-new 青山公路 estates) and
  // includes 17 hasPage:false rows that must never resolve to a public URL.
  assert.match(
    source,
    /Object\.values\(estateSeo\)\.map\(\(estate\) => `\/estate\/\$\{estate\.slug\}`\)/,
    "sitemap must derive estate URLs from Object.values(estateSeo), the hasPage:true-only export",
  );

  // estateRegistry (the 22-entry superset) must never be imported into this
  // route at all -- importing it "just for a lookup" is exactly the kind of
  // change that could reintroduce the leak without anyone noticing, since
  // nothing else in this file would obviously look wrong in review.
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

  // Pin the exact number too, not just set-equality -- if both estateSeo and
  // the registry's hasPage:true count drifted upward together (e.g. someone
  // flips hasPage to true for one of the 17 fact-less estates *and* adds an
  // estateSeo entry for it), the set-equality assertion above would still
  // pass even though that estate has no verified facts or photo yet.
  assert.equal(seoSlugs.length, 5, "exactly 5 estates should have a live detail page today");
});

test("the sitemap's computed estate paths contain none of the 17 unpublished P4 expansion estates", () => {
  // Reproduce sitemap[.]xml.ts's actual derivation logic (Object.values(estateSeo)
  // .map(estate => `/estate/${estate.slug}`)) against the real content module,
  // rather than trusting the source-scan regex alone to prove the *data*, not
  // just the *code shape*, is correct.
  const sitemapEstatePaths = Object.values(estateSeo).map((estate) => `/estate/${estate.slug}`);

  assert.equal(sitemapEstatePaths.length, 5);
  assert.equal(
    new Set(sitemapEstatePaths).size,
    5,
    "no duplicate estate paths in the sitemap's estate URL list",
  );

  const unpublishedSlugs = estateRegistry
    .filter((entry) => !entry.hasPage)
    .map((entry) => entry.slug);
  assert.equal(
    unpublishedSlugs.length,
    17,
    "sanity check: still exactly 17 hasPage:false estates in the registry",
  );

  for (const slug of unpublishedSlugs) {
    assert.equal(
      sitemapEstatePaths.includes(`/estate/${slug}`),
      false,
      `unpublished estate "${slug}" must never appear in the sitemap's estate URLs`,
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
