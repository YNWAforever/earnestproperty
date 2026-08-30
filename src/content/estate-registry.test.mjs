import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  estateRegistry,
  estateSlugsForCorridorSegment,
  estatesWithPage,
  getEstateEntry,
} from "./estate-registry.ts";
import { coreEstates } from "./core-estates.ts";
import { estateSeo } from "./seo.ts";
import { estatePageContent } from "./estate-pages.ts";
import { castlePeakRoadSegments } from "./castle-peak-road.ts";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("registry has exactly the 10 current client-approved estates, in core-estates.ts's order", () => {
  assert.equal(estateRegistry.length, 10);
  assert.deepEqual(
    estateRegistry.map((entry) => entry.slug),
    coreEstates.map((estate) => estate.slug),
  );
  assert.deepEqual(
    estateRegistry.map((entry) => entry.nameZh),
    coreEstates.map((estate) => estate.name),
  );
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

test("the ting-kau segment's estateSlugs stays empty -- no estate has a real DB row yet", () => {
  // 海雲軒 / 縉皇居 (hoi-wan-hin / chun-wong-kui) already appear in ting-kau's
  // featuredEstates/textAliases as free text, but neither has a real `estates`
  // table row today, so neither belongs in estateSlugs (real, DB-joinable
  // inventory) -- this pins that as a deliberate registry decision, not an
  // oversight, and guards the corridor SQL scoping behaviour staying unchanged.
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

test("districts and English names are never guessed for estates without a detail page", () => {
  const noPageSlugs = estateRegistry.filter((entry) => !entry.hasPage).map((entry) => entry.slug);
  assert.deepEqual(
    noPageSlugs,
    ["hoi-wan-hin", "tai-wah-hin", "hoi-wan-toi", "chun-wong-kui", "lung-tang-kok"],
  );

  for (const entry of estateRegistry) {
    if (entry.hasPage) continue;
    assert.equal(entry.districtSlug, null, `${entry.slug}'s districtSlug must not be guessed`);
    assert.equal(entry.nameEn, null, `${entry.slug} has no supplied English name`);
    assert.equal(entry.corridorSegment, null, `${entry.slug} has no real DB row yet`);
  }

  // The two client-approved exceptions with real evidence elsewhere in the repo.
  assert.equal(getEstateEntry("hoi-wan-hin").homepageDistrict, "汀九");
  assert.equal(getEstateEntry("chun-wong-kui").homepageDistrict, "汀九");
  for (const slug of ["tai-wah-hin", "hoi-wan-toi", "lung-tang-kok"]) {
    assert.equal(getEstateEntry(slug).homepageDistrict, null, `${slug} district must not be guessed`);
  }
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
