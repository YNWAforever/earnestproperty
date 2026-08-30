import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  estateRegistry,
  estateSlugsForCorridorSegment,
  estatesWithPage,
  findComparableEstates,
  getEstateEntry,
} from "./estate-registry.ts";
import { coreEstates } from "./core-estates.ts";
import { estateSeo } from "./seo.ts";
import { estatePageContent } from "./estate-pages.ts";
import { castlePeakRoadSegments } from "./castle-peak-road.ts";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("the registry's first 10 entries are exactly the client-approved homepage estates, in core-estates.ts's order", () => {
  // core-estates.ts's CLIENT_ORDER_SLUGS is untouched by P4 Task 2 -- still
  // exactly 10 slugs -- so this checks the registry's leading slice, not its
  // full length (which grew to 22 once Task 2's 12 net-new estates landed:
  // the original 10 plus 12 new 青山公路 entries, since 5 of the 17 P4
  // estates already existed here from Task 1 and were updated in place).
  const firstTen = estateRegistry.slice(0, 10);
  assert.deepEqual(
    firstTen.map((entry) => entry.slug),
    coreEstates.map((estate) => estate.slug),
  );
  assert.deepEqual(
    firstTen.map((entry) => entry.nameZh),
    coreEstates.map((estate) => estate.name),
  );
});

test("P4 Task 2 added exactly 12 net-new entries on top of the original 10 (17 named, 5 already present)", () => {
  assert.equal(estateRegistry.length, 22);
  const slugs = estateRegistry.map((entry) => entry.slug);
  assert.equal(new Set(slugs).size, slugs.length, "no duplicate slugs in the registry");
});

test("core-estates.ts's photo/district/hasPage fields are exactly the registry's", () => {
  for (const estate of coreEstates) {
    const entry = getEstateEntry(estate.slug);
    assert.equal(estate.photo, entry.photo, `${estate.slug} photo must match the registry`);
    assert.equal(estate.hasPage, entry.hasPage, `${estate.slug} hasPage must match the registry`);
    assert.equal(
      estate.district,
      entry.homepageDistrict,
      `${estate.slug} district must match the registry`,
    );
  }
});

test("every hasPage:true entry has a matching estateSeo and estatePageContent entry, and no orphans exist on either side", () => {
  const registryPageSlugs = estatesWithPage.map((entry) => entry.slug).sort();
  const seoSlugs = Object.keys(estateSeo).sort();
  const pageContentSlugs = Object.keys(estatePageContent).sort();

  assert.deepEqual(registryPageSlugs, seoSlugs, "estateSeo must cover exactly the hasPage:true slugs");
  assert.deepEqual(
    registryPageSlugs,
    pageContentSlugs,
    "estatePageContent must cover exactly the hasPage:true slugs",
  );

  for (const entry of estateRegistry) {
    assert.equal(
      entry.hasPage,
      Object.hasOwn(estateSeo, entry.slug),
      `${entry.slug}'s hasPage must agree with estateSeo membership`,
    );
    assert.equal(
      entry.hasPage,
      Object.hasOwn(estatePageContent, entry.slug),
      `${entry.slug}'s hasPage must agree with estatePageContent membership`,
    );
  }
});

test("estateSeo and estatePageContent source their slug/name fields from the registry, not a second copy", () => {
  for (const entry of estatesWithPage) {
    const seo = estateSeo[entry.slug];
    const page = estatePageContent[entry.slug];
    assert.equal(seo.slug, entry.slug);
    assert.equal(seo.nameZh, entry.nameZh);
    assert.equal(seo.nameEn, entry.nameEn);
    assert.equal(page.slug, entry.slug);
    assert.equal(page.nameZh, entry.nameZh);
    assert.equal(page.nameEn, entry.nameEn);
  }
});

test("estateSeo's oldSlugs agrees with the registry's legacySlug field", () => {
  for (const entry of estatesWithPage) {
    const expected = entry.legacySlug ? [entry.legacySlug] : [];
    assert.deepEqual(estateSeo[entry.slug].oldSlugs, expected);
  }
});

test("corridorSegment matches exactly what castle-peak-road.ts's segments' estateSlugs actually contain", () => {
  for (const segment of castlePeakRoadSegments) {
    const expected = estateSlugsForCorridorSegment(segment.slug).slice().sort();
    assert.deepEqual([...segment.estateSlugs].sort(), expected);
  }

  const segmentSlugs = new Set(castlePeakRoadSegments.map((segment) => segment.slug));
  for (const entry of estateRegistry) {
    if (entry.corridorSegment !== null) {
      assert.ok(
        segmentSlugs.has(entry.corridorSegment),
        `${entry.slug}'s corridorSegment must name a real corridor segment`,
      );
    }
  }
});

test("the ting-kau segment's estateSlugs stays empty -- no estate counts as strict inventory yet", () => {
  // 海雲軒 / 縉皇居 (hoi-wan-hin / chun-wong-kui) already appear in ting-kau's
  // featuredEstates/textAliases as free text. Since P4 Task 2 they DO have a
  // real `estates` table row (district_slug: "ting-kau"), but that row ships
  // `published = false` with no verified facts -- corridorSegment stays null
  // for all 17 P4 estates "for now" (the master plan's D2 note), so neither
  // belongs in estateSlugs (real, DB-joinable, published inventory) yet --
  // this pins that as a deliberate registry decision, not an oversight, and
  // guards the corridor SQL scoping behaviour staying unchanged.
  const tingKau = castlePeakRoadSegments.find((segment) => segment.slug === "ting-kau");
  assert.deepEqual(tingKau.estateSlugs, []);
});

test("registry slugs agree with estate.$slug.tsx's real slug-resolution surface", () => {
  const route = read("src/routes/estate.$slug.tsx");
  const queries = read("src/lib/queries.ts");

  // Ground truth (P4 plan): estate.$slug.tsx only ever reads estateSeo[slug] /
  // estatePageContent[slug] directly -- confirm that wiring is still true and
  // that every hasPage:true registry slug actually resolves through it.
  assert.match(route, /estateSeo\[/);
  assert.match(route, /getEstatePageContent/);
  for (const entry of estatesWithPage) {
    assert.ok(Object.hasOwn(estateSeo, entry.slug), `${entry.slug} must resolve via estateSeo`);
  }

  // queries.ts's ESTATE_DB_SLUG_FALLBACKS must be derived from the registry's
  // legacySlug field rather than a second hand-maintained copy.
  assert.match(queries, /from "@\/content\/estate-registry"/);
  assert.match(queries, /estateRegistry/);
  const legacyEntries = estateRegistry.filter((entry) => entry.legacySlug);
  assert.ok(legacyEntries.length > 0, "at least one estate should carry a legacySlug fixture");
});

test("getEstateEntry throws for an unknown slug and returns the real entry for a known one", () => {
  assert.throws(() => getEstateEntry("not-a-real-slug"));
  assert.equal(getEstateEntry("bellagio").nameZh, "碧堤半島");
});

const P4_EXPANSION_SLUGS = [
  "hoi-wan-hin",
  "tai-wah-hin",
  "hoi-wan-toi",
  "chun-wong-kui",
  "lung-tang-kok",
  "mun-ming-shan",
  "wong-gam-hoi-ngon",
  "oi-kam-hoi-ngon",
  "tai-yu",
  "wong-gam-hoi-waan",
  "sing-tai",
  "seong-yuen",
  "the-carmel",
  "oma-oma",
  "lin-shan",
  "long-tou-waan",
  "tai-tou-waan",
];

// The 3 estates with a genuinely unknown district (must not be guessed).
const UNKNOWN_DISTRICT_SLUGS = ["tai-wah-hin", "hoi-wan-toi", "lung-tang-kok"];

test("districts and English names are never guessed for estates without a detail page", () => {
  const noPageSlugs = estateRegistry.filter((entry) => !entry.hasPage).map((entry) => entry.slug);
  assert.equal(noPageSlugs.length, 17, "all 17 P4 estates plus none of the original hasPage:true 5");
  assert.deepEqual(noPageSlugs.slice().sort(), P4_EXPANSION_SLUGS.slice().sort());

  for (const entry of estateRegistry) {
    if (entry.hasPage) continue;
    // nameEn is never guessed for a no-page estate -- "The Carmel"/"Oma Oma"
    // are exceptions in *name*, not this rule: their nameZh IS their only
    // given name (already Latin-script), and nameEn stays null too.
    assert.equal(entry.nameEn, null, `${entry.slug} has no supplied English name`);
    assert.equal(entry.corridorSegment, null, `${entry.slug} has no strict corridor inventory yet`);
    if (UNKNOWN_DISTRICT_SLUGS.includes(entry.slug)) {
      assert.equal(entry.districtSlug, null, `${entry.slug}'s districtSlug must not be guessed`);
    }
  }

  // The two client-approved exceptions with real evidence elsewhere in the repo.
  assert.equal(getEstateEntry("hoi-wan-hin").homepageDistrict, "汀九");
  assert.equal(getEstateEntry("chun-wong-kui").homepageDistrict, "汀九");
  for (const slug of UNKNOWN_DISTRICT_SLUGS) {
    assert.equal(getEstateEntry(slug).homepageDistrict, null, `${slug} district must not be guessed`);
  }
});

test("P4 Task 2: all 17 new/reconciled estates have hasPage:false and corridorSegment:null", () => {
  for (const slug of P4_EXPANSION_SLUGS) {
    const entry = getEstateEntry(slug);
    assert.equal(entry.hasPage, false, `${slug} must not link to a detail page yet`);
    assert.equal(entry.corridorSegment, null, `${slug} must not claim strict corridor inventory yet`);
    assert.equal(entry.photo, null, `${slug} has no supplied photo`);
  }
});

test("P4 Task 2: exactly 3 of the 17 estates carry a genuinely unknown (null) districtSlug", () => {
  const withNullDistrict = P4_EXPANSION_SLUGS.filter(
    (slug) => getEstateEntry(slug).districtSlug === null,
  );
  assert.deepEqual(withNullDistrict.slice().sort(), UNKNOWN_DISTRICT_SLUGS.slice().sort());

  const withKnownDistrict = P4_EXPANSION_SLUGS.filter(
    (slug) => !UNKNOWN_DISTRICT_SLUGS.includes(slug),
  );
  assert.equal(withKnownDistrict.length, 14);
  for (const slug of withKnownDistrict) {
    const districtSlug = getEstateEntry(slug).districtSlug;
    assert.ok(
      districtSlug === "ting-kau" || districtSlug === "castle-peak-road",
      `${slug}'s districtSlug (${districtSlug}) must be a real, grounded district`,
    );
  }

  // The two 汀九 estates specifically -- real evidence in castle-peak-road.ts.
  assert.equal(getEstateEntry("hoi-wan-hin").districtSlug, "ting-kau");
  assert.equal(getEstateEntry("chun-wong-kui").districtSlug, "ting-kau");

  // The 12 青山公路 estates all share "castle-peak-road".
  const castlePeakRoadSlugs = [
    "mun-ming-shan",
    "wong-gam-hoi-ngon",
    "oi-kam-hoi-ngon",
    "tai-yu",
    "wong-gam-hoi-waan",
    "sing-tai",
    "seong-yuen",
    "the-carmel",
    "oma-oma",
    "lin-shan",
    "long-tou-waan",
    "tai-tou-waan",
  ];
  assert.equal(castlePeakRoadSlugs.length, 12);
  for (const slug of castlePeakRoadSlugs) {
    assert.equal(getEstateEntry(slug).districtSlug, "castle-peak-road");
  }
});

test("P4 Task 2: The Carmel / Oma Oma carry their only given name in nameZh, never a guessed nameEn", () => {
  for (const slug of ["the-carmel", "oma-oma"]) {
    const entry = getEstateEntry(slug);
    assert.equal(entry.nameEn, null);
    assert.ok(entry.nameZh.length > 0);
  }
  assert.equal(getEstateEntry("the-carmel").nameZh, "The Carmel");
  assert.equal(getEstateEntry("oma-oma").nameZh, "Oma Oma");
});

test("every alias is a non-empty string and every hasPage:true entry's aliases cover its own name", () => {
  for (const entry of estateRegistry) {
    assert.ok(entry.aliases.length > 0, `${entry.slug} needs at least one alias`);
    for (const alias of entry.aliases) {
      assert.ok(alias.trim().length > 0, `${entry.slug} must not carry a blank alias`);
    }
    assert.ok(
      entry.aliases.includes(entry.nameZh),
      `${entry.slug}'s aliases should include its own Chinese name`,
    );
  }
});

// Regression guard for neon/migrations/20260830130000_estate_expansion.sql:
// `estates.published` defaults to `true` (20260711090000_cms_content_revisions.sql),
// so an accidental column-list slip in that migration's INSERT would silently
// publish 17 fact-less, photo-less estates. This is a source scan, not a live
// DB read (this session must not touch the live sandbox database) -- it
// parses the migration file's own INSERT statement text.
test("estate_expansion migration: every one of the 17 inserted rows sets published = false explicitly", () => {
  const migration = read(
    "neon/migrations/20260830130000_estate_expansion.sql",
  );

  const insertMatch = migration.match(
    /INSERT INTO estates \(slug, name_zh, name_en, district_slug, published\) VALUES\s*([\s\S]*?)\nON CONFLICT \(slug\) DO NOTHING;/,
  );
  assert.ok(insertMatch, "migration must contain the expected 17-estate INSERT statement");

  const valuesBlock = insertMatch[1];
  // Each VALUES row is `(...)`, one per line (ignoring comment-only lines).
  const rowLines = valuesBlock
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("("));

  assert.equal(rowLines.length, 17, "migration must insert exactly 17 estate rows");

  for (const line of rowLines) {
    assert.match(
      line,
      /,\s*false\)\s*,?$/,
      `every inserted row must end with an explicit "false" for published, got: ${line}`,
    );
  }

  // Slug-for-slug cross-check against the registry so the DB and registry
  // identities cannot silently diverge (P4's own "registry and DB agree"
  // acceptance criterion).
  const insertedSlugs = rowLines.map((line) => line.match(/^\('([a-z0-9-]+)'/)?.[1]);
  assert.deepEqual(insertedSlugs.slice().sort(), P4_EXPANSION_SLUGS.slice().sort());
});

// --- P4 Task 5: findComparableEstates (nearby-estate comparison table) ---

test("findComparableEstates never returns the estate itself, and is deterministic across repeated calls", () => {
  const first = findComparableEstates("bellagio", 2);
  const second = findComparableEstates("bellagio", 2);
  assert.deepEqual(
    first.map((entry) => entry.slug),
    second.map((entry) => entry.slug),
    "the same input must yield the same output every time -- required for a stable table/test, not random",
  );
  for (const entry of first) {
    assert.notEqual(
      entry.slug,
      "bellagio",
      "an estate must never compare against itself",
    );
  }
});

test("findComparableEstates matches on districtSlug/corridorSegment and respects the limit", () => {
  // bellagio shares districtSlug "sham-tseng" and corridorSegment
  // "sham-tseng" with the other 4 hasPage:true estates -- registry array
  // order (not sorted, not random) is hong-kong-garden, sea-crest-villa,
  // lido-garden, rhine-garden, so limit=2 takes the first two of those.
  assert.deepEqual(
    findComparableEstates("bellagio", 2).map((entry) => entry.slug),
    ["hong-kong-garden", "sea-crest-villa"],
  );
  assert.deepEqual(
    findComparableEstates("bellagio", 1).map((entry) => entry.slug),
    ["hong-kong-garden"],
  );
  assert.deepEqual(findComparableEstates("bellagio", 0), []);
});

test("findComparableEstates returns [] rather than throwing for an unknown slug", () => {
  assert.deepEqual(findComparableEstates("not-a-real-slug", 2), []);
});

test("findComparableEstates returns [] for an entry whose districtSlug and corridorSegment are both null, without crashing (P4 Task 2's 3 unknown-district estates)", () => {
  const entry = getEstateEntry("tai-wah-hin");
  assert.equal(entry.districtSlug, null);
  assert.equal(entry.corridorSegment, null);
  assert.deepEqual(findComparableEstates("tai-wah-hin", 2), []);
});

test("findComparableEstates matches purely on districtSlug when corridorSegment is null for the whole group (P4 Task 2's 12 青山公路 estates)", () => {
  // All 12 castle-peak-road estates share districtSlug "castle-peak-road"
  // and corridorSegment null (deliberately, per D2 -- see each entry's own
  // comment) -- this proves the sparse, corridorSegment-less majority of
  // the registry still produces a sensible, non-crashing match via the
  // districtSlug half of the OR.
  const result = findComparableEstates("mun-ming-shan", 2);
  assert.equal(result.length, 2);
  for (const entry of result) {
    assert.equal(entry.districtSlug, "castle-peak-road");
    assert.notEqual(entry.slug, "mun-ming-shan");
  }
});

test("findComparableEstates matches purely on districtSlug for a group of exactly 2 (ting-kau)", () => {
  // hoi-wan-hin and chun-wong-kui are the only two "ting-kau"-district
  // entries and both carry corridorSegment: null -- exactly one real
  // comparable exists, so the result is length 1, not padded to 2.
  const result = findComparableEstates("hoi-wan-hin", 2);
  assert.deepEqual(
    result.map((entry) => entry.slug),
    ["chun-wong-kui"],
  );
});
