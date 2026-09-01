import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { CORE_ESTATES_PREVIEW_COUNT, coreEstates, estateFigure } from "./core-estates.ts";

const CLIENT_ORDER = [
  "碧堤半島",
  "豪景花園",
  "浪翠園",
  "麗都花園",
  "海韻花園",
  "海雲軒",
  "帝華軒",
  "海韻臺",
  "縉皇居",
  "龍騰閣",
];

// All ten now link to a real /estate/$slug page (2026-09-01's 17-estate
// expansion gave each of these five a registry entry with hasPage: true,
// sourced facts, and content -- see estate-registry.ts and
// docs/superpowers/specs/assets/estate-expansion-17.data.json). Figures
// (units/avgPsf/listingCount) stay null regardless -- those are never
// hardcoded on the card, always merged live from the DB by slug at render
// time (see the next test).
const ADDED_BY_CLIENT = ["海雲軒", "帝華軒", "海韻臺", "縉皇居", "龍騰閣"];

test("all ten client-approved estates ship in the client's order", () => {
  assert.deepEqual(
    coreEstates.map((estate) => estate.name),
    CLIENT_ORDER,
  );
  // Ten estates against an eight-card preview is what makes the expander load-bearing.
  assert.ok(coreEstates.length > CORE_ESTATES_PREVIEW_COUNT);
});

test("all ten client-approved estates now link to a detail page", () => {
  for (const name of ADDED_BY_CLIENT) {
    const estate = coreEstates.find((candidate) => candidate.name === name);
    assert.ok(estate, `${name} must be present`);
    assert.equal(estate.hasPage, true, `${name} must link to a detail page`);
  }
});

test("estates with a detail page keep their figures in the database", () => {
  const withPages = coreEstates.filter((estate) => estate.hasPage);
  assert.equal(withPages.length, 10);
  for (const estate of withPages) {
    // Hardcoding a figure here would let the card drift from the estate page,
    // so live values are merged by slug at render time instead.
    assert.equal(estate.units, null, `${estate.name} must read units from the DB`);
    assert.equal(estate.avgPsf, null, `${estate.name} must read psf from the DB`);
  }
});

test("every declared photo exists on disk", () => {
  for (const estate of coreEstates) {
    if (!estate.photo) continue;
    assert.ok(
      existsSync(new URL(`../../public${estate.photo}`, import.meta.url)),
      `${estate.name} photo ${estate.photo} must exist — a missing file 404s silently`,
    );
  }
});

test("districts are never guessed", () => {
  // 2026-09-01's 17-estate expansion sourced real addresses for all five
  // (中原地產/28Hse listing pages, cited in the data pack) placing them in
  // 深井／青龍頭 -- superseding the earlier placement based only on
  // castle-peak-road.ts's ting-kau segment mentioning some of them as
  // "featured estates" (a looser, non-authoritative signal). 青龍頭 estates
  // (帝華軒/龍騰閣) fold into "深井" here since EstateHomepageDistrict has no
  // separate 青龍頭 value and castle-peak-road.ts's own sham-tseng segment
  // already absorbs 青龍頭 the same way.
  const byName = Object.fromEntries(coreEstates.map((estate) => [estate.name, estate]));
  for (const name of ADDED_BY_CLIENT) {
    assert.equal(byName[name].district, "深井", `${name} district must be 深井`);
  }
});

test("estateFigure renders missing values as an em dash, never zero", () => {
  assert.equal(estateFigure(null), "—");
  assert.equal(estateFigure(undefined), "—");
  assert.equal(estateFigure(Number.NaN), "—");
  assert.equal(estateFigure(Number.POSITIVE_INFINITY), "—");
  // A real zero is still a real figure and must not be masked.
  assert.equal(estateFigure(0), "0");
  assert.equal(estateFigure(3345), "3,345");
});
