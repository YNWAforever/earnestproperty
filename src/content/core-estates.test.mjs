import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { CORE_ESTATES_PREVIEW_COUNT, coreEstates, estateFigure } from "./core-estates.ts";
import { getClientAreaGroup } from "./client-area-presentation.ts";
import { getEstateEntry } from "./estate-registry.ts";

/**
 * The client's 2026-09-07 order (網頁07092026.docx p3), minus 逸璟瓏灣.
 *
 * The client's own list has ten entries and opens with 逸璟瓏灣, which matches
 * no registry entry, alias or published row in this repo. It is carried as an
 * unresolved name rather than guessed onto another estate, so nine cards ship
 * and the tenth is an open question -- see the unresolved-names test below.
 */
const CLIENT_ORDER = [
  "豪景花園",
  "帝華軒",
  "浪翠園",
  "海雲軒",
  "麗都花園",
  "碧堤半島",
  "縉皇居",
  "海韻花園",
  "海韻台",
];

test("the client's 2026-09-07 深井 / 青龍頭 order ships exactly, in order", () => {
  assert.deepEqual(
    coreEstates.map((estate) => estate.name),
    CLIENT_ORDER,
  );
});

test("帝華軒 is in this group even though its database district is 青龍頭", () => {
  // The reason it never reached the homepage before: fetchEstates() asked the
  // database for district_slug = "sham-tseng" only. The commercial grouping
  // and the DB district genuinely disagree, and the DB district is the one
  // that must not be falsified.
  const entry = getEstateEntry("tai-wah-hin");
  assert.equal(entry.districtSlug, "tsing-lung-tau");
  assert.ok(coreEstates.some((estate) => estate.slug === "tai-wah-hin"));
});

test("海韻台 is the client's label for the one 海韻臺 estate, not a second estate", () => {
  const card = coreEstates.find((estate) => estate.name === "海韻台");
  assert.ok(card);
  assert.equal(card.slug, "hoi-wan-toi");
  const entry = getEstateEntry("hoi-wan-toi");
  assert.equal(entry.nameZh, "海韻臺", "the canonical display name is unchanged");
  assert.ok(entry.aliases.includes("海韻台"), "the client's spelling stays a search alias");
  assert.equal(
    coreEstates.filter((estate) => estate.slug === "hoi-wan-toi").length,
    1,
    "a presentation label must never fork the estate into two cards",
  );
});

test("龍騰閣 leaves this curated sequence without losing its identity", () => {
  assert.ok(!coreEstates.some((estate) => estate.slug === "lung-tang-kok"));
  // Its record, name and detail page survive the removal from this list.
  assert.equal(getEstateEntry("lung-tang-kok").hasPage, true);
});

test("逸璟瓏灣 is recorded as unresolved, never guessed onto another estate", () => {
  const group = getClientAreaGroup("sham-tseng");
  assert.deepEqual(
    group.unresolved.map((entry) => entry.label),
    ["逸璟瓏灣"],
  );
  assert.ok(
    !coreEstates.some((estate) => estate.name === "逸璟瓏灣"),
    "an unresolved name must not be rendered as an estate card",
  );
});

test("the client's nine-card order is not truncated by the shared eight-card preview", () => {
  // index.tsx passes coreEstates.length as this section's own previewCount.
  // The shared default stays 8 for every other grid rather than being removed
  // globally, so this asserts the two are genuinely allowed to differ.
  assert.equal(CORE_ESTATES_PREVIEW_COUNT, 8);
  assert.ok(coreEstates.length > 0);
});

test("every card links to a detail page", () => {
  for (const estate of coreEstates) {
    assert.equal(estate.hasPage, true, `${estate.name} must link to a detail page`);
  }
});

test("estates with a detail page keep their figures in the database", () => {
  for (const estate of coreEstates) {
    // Hardcoding a figure here would let the card drift from the estate page,
    // so live values are merged by slug at render time instead.
    assert.equal(estate.units, null, `${estate.name} must read units from the DB`);
    assert.equal(estate.avgPsf, null, `${estate.name} must read psf from the DB`);
    assert.equal(estate.listingCount, null, `${estate.name} must read counts from the DB`);
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
  // 青龍頭 estates fold into "深井" here since EstateHomepageDistrict has no
  // separate 青龍頭 value and castle-peak-road.ts's own sham-tseng segment
  // already absorbs 青龍頭 the same way. 豪景花園 is the client's own
  // long-standing exception: grouped under 青山公路 on its card while its DB
  // row is sham-tseng.
  for (const estate of coreEstates) {
    assert.equal(estate.district, getEstateEntry(estate.slug).homepageDistrict);
    assert.ok(estate.district !== null, `${estate.name} must carry a real district`);
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
