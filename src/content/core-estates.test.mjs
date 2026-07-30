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
  "海韻台",
  "縉皇居",
  "龍騰閣",
];

const ADDED_BY_CLIENT = ["海雲軒", "帝華軒", "海韻台", "縉皇居", "龍騰閣"];

test("all ten client-approved estates ship in the client's order", () => {
  assert.deepEqual(
    coreEstates.map((estate) => estate.name),
    CLIENT_ORDER,
  );
  // Ten estates against an eight-card preview is what makes the expander load-bearing.
  assert.ok(coreEstates.length > CORE_ESTATES_PREVIEW_COUNT);
});

test("the five estates the client added carry no invented figures", () => {
  for (const name of ADDED_BY_CLIENT) {
    const estate = coreEstates.find((candidate) => candidate.name === name);
    assert.ok(estate, `${name} must be present`);
    // The client supplied no numbers for these. `0` is the failure mode that
    // matters: the card used to do `(units ?? 0).toLocaleString()` and printed a
    // confident "0 個單位" / "$0" for anything the DB had not filled in.
    for (const field of ["units", "avgPsf", "listingCount"]) {
      assert.equal(estate[field], null, `${name}.${field} must be null, not a figure`);
    }
    assert.equal(estate.photo, null, `${name} has no supplied photo`);
    // No detail page exists, so the card must not link — a link would ship a thin page.
    assert.equal(estate.hasPage, false, `${name} must not link to a detail page`);
  }
});

test("estates with a detail page keep their figures in the database", () => {
  const withPages = coreEstates.filter((estate) => estate.hasPage);
  assert.equal(withPages.length, 5);
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
  // 海雲軒 and 縉皇居 are listed among 油柑頭 / 汀九's featured estates in
  // castle-peak-road.ts, so placing them in 深井 would be a false location. The
  // other three have no evidence anywhere in the repo and stay null rather than
  // inheriting the section's 深井 heading.
  const byName = Object.fromEntries(coreEstates.map((estate) => [estate.name, estate]));
  assert.equal(byName["海雲軒"].district, "汀九");
  assert.equal(byName["縉皇居"].district, "汀九");
  for (const name of ["帝華軒", "海韻台", "龍騰閣"]) {
    assert.equal(byName[name].district, null, `${name} district must not be guessed`);
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
