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

test("every estateSeo/estatePageContent entry has a matching hasPage:true registry entry (no orphans on the content side)", () => {
  // Estate Expansion 17 (2026-09-01 data pack, this plan's Task 1) flips
  // `hasPage: true` for all 22 registry entries up front, but the matching
  // estateSeo (Task 3) and estatePageContent (Task 4) entries for the 17
  // newly-true slugs land in later tasks of the same plan -- so the reverse
  // direction ("every hasPage:true entry already has content") does not hold
  // yet and is intentionally not asserted here. This direction (content
  // implies hasPage) has no such lag and must always hold.
  for (const slug of Object.keys(estateSeo)) {
    assert.ok(
      getEstateEntry(slug).hasPage,
      `${slug} has an estateSeo entry but the registry doesn't mark hasPage:true`,
    );
  }
  for (const slug of Object.keys(estatePageContent)) {
    assert.ok(
      getEstateEntry(slug).hasPage,
      `${slug} has an estatePageContent entry but the registry doesn't mark hasPage:true`,
    );
  }
});

test("estateSeo and estatePageContent source their slug/name fields from the registry, not a second copy", () => {
  // Scoped to slugs that currently have real estateSeo/estatePageContent
  // entries -- not the full `estatesWithPage` list (22 entries as of this
  // task; Estate Expansion 17's Task 3/4 add the other 17's entries later).
  for (const slug of Object.keys(estateSeo)) {
    const entry = getEstateEntry(slug);
    const seo = estateSeo[slug];
    const page = estatePageContent[slug];
    assert.equal(seo.slug, entry.slug);
    assert.equal(seo.nameZh, entry.nameZh);
    assert.equal(seo.nameEn, entry.nameEn);
    assert.equal(page.slug, entry.slug);
    assert.equal(page.nameZh, entry.nameZh);
    assert.equal(page.nameEn, entry.nameEn);
  }
});

test("estateSeo's oldSlugs agrees with the registry's legacySlug field", () => {
  for (const slug of Object.keys(estateSeo)) {
    const entry = getEstateEntry(slug);
    const expected = entry.legacySlug ? [entry.legacySlug] : [];
    assert.deepEqual(estateSeo[slug].oldSlugs, expected);
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
  // featuredEstates/textAliases as free text. They DO have a real `estates`
  // table row (district_slug corrected to "sham-tseng" by Estate Expansion
  // 17's data pack -- see estate-registry.ts's own comment on why), but that
  // row ships `published = false` with no verified facts -- corridorSegment
  // stays null for all 17 P4 estates "for now" (the master plan's D2 note),
  // so neither belongs in estateSlugs (real, DB-joinable, published
  // inventory) yet -- this pins that as a deliberate registry decision, not
  // an oversight, and guards the corridor SQL scoping behaviour staying
  // unchanged.
  const tingKau = castlePeakRoadSegments.find((segment) => segment.slug === "ting-kau");
  assert.deepEqual(tingKau.estateSlugs, []);
});

test("registry slugs agree with estate.$slug.tsx's real slug-resolution surface", () => {
  const route = read("src/routes/estate.$slug.tsx");
  const queries = read("src/lib/queries.ts");

  // Ground truth (P4 plan): estate.$slug.tsx only ever reads estateSeo[slug] /
  // estatePageContent[slug] directly -- confirm that wiring is still true.
  // (Not asserted here: every hasPage:true registry slug resolving through
  // it -- Estate Expansion 17's Task 1 flips hasPage:true for 17 slugs
  // whose estateSeo/estatePageContent entries land in that plan's Task 3/4;
  // see the dedicated orphan-check test above for the direction that does
  // hold today.)
  assert.match(route, /estateSeo\[/);
  assert.match(route, /getEstatePageContent/);

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

// The 5 深井／青龍頭 estates from P4 Task 2, whose districtSlug the 2026-09-01
// Estate Expansion 17 data pack corrects (was "ting-kau"/null placeholders).
const CORRECTED_DISTRICT_SLUGS = {
  "hoi-wan-hin": "sham-tseng",
  "tai-wah-hin": "tsing-lung-tau",
  "hoi-wan-toi": "sham-tseng",
  "chun-wong-kui": "sham-tseng",
  "lung-tang-kok": "tsing-lung-tau",
};

// The 12 青山公路 estates -- districtSlug was already "castle-peak-road" as a
// placeholder and is unchanged by this task.
const CASTLE_PEAK_ROAD_SLUGS = [
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

// 2026-09-02: 11 of the 17 now have a real, license-verified Wikimedia Commons
// photo -- 7 from the first research pass (see estate-photo-credits research
// that session), plus hoi-wan-hin/tai-wah-hin/seong-yuen/the-carmel from this
// session's pass over the remaining 10 (of which 6 -- lung-tang-kok, tai-yu,
// wong-gam-hoi-waan, oma-oma, lin-shan, long-tou-waan -- still have no
// qualifying photo after a genuine search: no Commons coverage at all, or only
// under-construction/unverified-license/wrong-building candidates that didn't
// survive verification). This test now checks hasPage:true for all 17 and
// photo state matches exactly that 11/6 split, rather than asserting every one
// is still photo-less.
const P4_PHOTO_SLUGS = [
  "hoi-wan-toi",
  "chun-wong-kui",
  "mun-ming-shan",
  "wong-gam-hoi-ngon",
  "oi-kam-hoi-ngon",
  "sing-tai",
  "tai-tou-waan",
  "hoi-wan-hin",
  "tai-wah-hin",
  "seong-yuen",
  "the-carmel",
];

test("Estate Expansion 17 (2026-09-01 data pack): all 17 estates have hasPage:true; 11 now have a license-verified photo, 6 still don't", () => {
  assert.equal(P4_EXPANSION_SLUGS.length, 17);
  for (const slug of P4_EXPANSION_SLUGS) {
    const entry = getEstateEntry(slug);
    assert.equal(entry.hasPage, true, `${slug} must now link to a detail page`);
    if (P4_PHOTO_SLUGS.includes(slug)) {
      assert.notEqual(entry.photo, null, `${slug} must have its sourced photo`);
      assert.ok(entry.photoCredit, `${slug}'s photo must carry attribution`);
    } else {
      assert.equal(entry.photo, null, `${slug} has no supplied photo yet`);
    }
  }
  // Every registry entry (5 original + 17 new) is hasPage:true after this task.
  assert.equal(
    estateRegistry.every((entry) => entry.hasPage),
    true,
  );
  assert.equal(estatesWithPage.length, estateRegistry.length);
});

test("Estate Expansion 17: corridorSegment stays null for all 17 estates (regression guard -- this task must never silently pull any of them into corridor listing-search scope)", () => {
  for (const slug of P4_EXPANSION_SLUGS) {
    assert.equal(
      getEstateEntry(slug).corridorSegment,
      null,
      `${slug} must not claim strict corridor inventory yet`,
    );
  }
});

test("Estate Expansion 17: the 5 corrected districtSlug values match exactly, and the 12 青山公路 estates keep castle-peak-road", () => {
  for (const [slug, expected] of Object.entries(CORRECTED_DISTRICT_SLUGS)) {
    assert.equal(getEstateEntry(slug).districtSlug, expected, `${slug}'s corrected districtSlug`);
  }

  assert.equal(CASTLE_PEAK_ROAD_SLUGS.length, 12);
  for (const slug of CASTLE_PEAK_ROAD_SLUGS) {
    assert.equal(getEstateEntry(slug).districtSlug, "castle-peak-road");
  }

  // No entry -- among the 17, or the whole registry -- has a null districtSlug
  // anymore; the data pack grounds every one.
  assert.equal(
    estateRegistry.some((entry) => entry.districtSlug === null),
    false,
  );

  // The two 深井 homepageDistrict overrides for the 汀九-adjacent estates
  // (see each entry's own comment in estate-registry.ts for why).
  assert.equal(getEstateEntry("hoi-wan-hin").homepageDistrict, "深井");
  assert.equal(getEstateEntry("chun-wong-kui").homepageDistrict, "深井");
  assert.equal(getEstateEntry("tai-wah-hin").homepageDistrict, "深井");
  assert.equal(getEstateEntry("lung-tang-kok").homepageDistrict, "深井");
  assert.equal(getEstateEntry("hoi-wan-toi").homepageDistrict, "深井");
});

test("Estate Expansion 17: tai-wah-hin.parentEstateSlug is sea-crest-villa; every other entry (including all 5 originals) has parentEstateSlug:null", () => {
  assert.equal(getEstateEntry("tai-wah-hin").parentEstateSlug, "sea-crest-villa");
  for (const entry of estateRegistry) {
    if (entry.slug === "tai-wah-hin") continue;
    assert.equal(entry.parentEstateSlug, null, `${entry.slug} must not carry a parentEstateSlug`);
  }
});

test("Estate Expansion 17: every one of the 22 estates has non-null heroEyebrow/districtHref/locationLabelZh (regression guard for the original-5 backfill)", () => {
  for (const entry of estateRegistry) {
    assert.notEqual(entry.heroEyebrow, null, `${entry.slug} must have a heroEyebrow`);
    assert.notEqual(entry.districtHref, null, `${entry.slug} must have a districtHref`);
    assert.notEqual(entry.locationLabelZh, null, `${entry.slug} must have a locationLabelZh`);
  }
});

test("Estate Expansion 17: the data pack supplies a real nameEn for all 17 estates, including The Carmel / Oma Oma whose nameZh is already Latin-script", () => {
  for (const slug of P4_EXPANSION_SLUGS) {
    const entry = getEstateEntry(slug);
    assert.notEqual(entry.nameEn, null, `${slug} must have a supplied English name`);
    assert.ok(entry.nameZh.length > 0);
  }
  assert.equal(getEstateEntry("the-carmel").nameZh, "The Carmel");
  assert.equal(getEstateEntry("the-carmel").nameEn, "The Carmel");
  assert.equal(getEstateEntry("oma-oma").nameZh, "Oma Oma");
  assert.equal(getEstateEntry("oma-oma").nameEn, "OMA OMA");
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
  const migration = read("neon/migrations/20260830130000_estate_expansion.sql");

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
    assert.notEqual(entry.slug, "bellagio", "an estate must never compare against itself");
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

test("findComparableEstates matches tai-wah-hin to lung-tang-kok, the only other 青龍頭 (tsing-lung-tau) districtSlug entry", () => {
  // Estate Expansion 17 corrects tai-wah-hin's districtSlug from the old
  // placeholder `null` to "tsing-lung-tau" (grounded: it's 浪翠園 Phase 5,
  // sharing 青龍頭 with lung-tang-kok, its only district-mate). corridorSegment
  // stays null for both, so this exercises the districtSlug half of the OR.
  const entry = getEstateEntry("tai-wah-hin");
  assert.equal(entry.districtSlug, "tsing-lung-tau");
  assert.equal(entry.corridorSegment, null);
  assert.deepEqual(
    findComparableEstates("tai-wah-hin", 5).map((e) => e.slug),
    ["lung-tang-kok"],
  );
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

test("findComparableEstates matches hoi-wan-hin against the wider sham-tseng districtSlug group, respecting the limit", () => {
  // Estate Expansion 17 corrects hoi-wan-hin's districtSlug from the old
  // "ting-kau" placeholder to "sham-tseng" -- it now shares that districtSlug
  // with all 5 original hasPage:true estates plus hoi-wan-toi/chun-wong-kui,
  // 7 comparables total (registry array order: bellagio, hong-kong-garden,
  // sea-crest-villa, lido-garden, rhine-garden, hoi-wan-toi, chun-wong-kui).
  assert.equal(getEstateEntry("hoi-wan-hin").districtSlug, "sham-tseng");
  assert.deepEqual(
    findComparableEstates("hoi-wan-hin", 10).map((entry) => entry.slug),
    [
      "bellagio",
      "hong-kong-garden",
      "sea-crest-villa",
      "lido-garden",
      "rhine-garden",
      "hoi-wan-toi",
      "chun-wong-kui",
    ],
  );
  assert.deepEqual(
    findComparableEstates("hoi-wan-hin", 2).map((entry) => entry.slug),
    ["bellagio", "hong-kong-garden"],
  );
});
