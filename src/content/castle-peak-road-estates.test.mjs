import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CASTLE_PEAK_ROAD_OTHER_LABEL,
  castlePeakRoadEstates,
  castlePeakRoadOtherEstates,
} from "./castle-peak-road-estates.ts";
import { getClientAreaGroup } from "./client-area-presentation.ts";
import { estateRegistry, getEstateEntry } from "./estate-registry.ts";

/**
 * The client's 2026-09-07 primary order (網頁07092026.docx p2) restricted to
 * the names with a verified canonical identity in this repo. Their list is
 * 帝濤灣 / 愛琴海岸 / 黃金海岸 / 滿名山 / 黃金海灣 / 帝御系列 / 星堤 / NAPA /
 * 上源 / 凱和山 / 緹岸 / 飛揚, then the 其他 tile. NAPA, 凱和山, 緹岸 and 飛揚
 * resolve to nothing here and are carried as unresolved names.
 */
const PRIMARY_ORDER = [
  "帝濤灣",
  "愛琴海岸",
  "香港黃金海岸",
  "滿名山",
  "黃金海灣",
  "帝御系列",
  "星堤",
  "上源",
];

/** The client's 其他 order, minus 翠濤居 / 棕月灣 / 愛琴灣 (unresolved). */
const OTHER_ORDER = ["Oma Oma", "The Carmel", "漣山", "浪濤灣"];

test("the client's primary western order ships exactly, in order", () => {
  assert.deepEqual(
    castlePeakRoadEstates.map((estate) => estate.name),
    PRIMARY_ORDER,
  );
});

test("the 其他 group ships the client's secondary order, in order", () => {
  assert.deepEqual(
    castlePeakRoadOtherEstates.map((estate) => estate.name),
    OTHER_ORDER,
  );
  assert.equal(CASTLE_PEAK_ROAD_OTHER_LABEL, "其他");
});

test("其他 is a group control, never an estate", () => {
  const all = [...castlePeakRoadEstates, ...castlePeakRoadOtherEstates];
  assert.ok(!all.some((estate) => estate.name === "其他"));
  assert.ok(!all.some((estate) => estate.slug === "其他" || estate.slug === "other"));
  assert.ok(
    !estateRegistry.some((entry) => entry.nameZh === "其他"),
    "其他 must not exist as a canonical estate identity",
  );
});

test("no estate appears in both the primary and the 其他 tier", () => {
  const primary = new Set(castlePeakRoadEstates.map((estate) => estate.slug));
  for (const estate of castlePeakRoadOtherEstates) {
    assert.ok(!primary.has(estate.slug), `${estate.name} must appear in exactly one tier`);
  }
});

test("黃金海岸 and 黃金海灣 stay two separate estates", () => {
  const goldCoast = castlePeakRoadEstates.find((estate) => estate.slug === "wong-gam-hoi-ngon");
  const goldBay = castlePeakRoadEstates.find((estate) => estate.slug === "wong-gam-hoi-waan");
  assert.ok(goldCoast && goldBay);
  assert.notEqual(goldCoast.slug, goldBay.slug);
  assert.equal(goldCoast.name, "香港黃金海岸");
  assert.equal(goldBay.name, "黃金海灣");
  // The client wrote 黃金海岸; that stays a search alias of the canonical name.
  assert.ok(getEstateEntry("wong-gam-hoi-ngon").aliases.includes("黃金海岸"));
});

test("帝御系列 is a display label on the one 帝御 estate, not duplicated phase inventory", () => {
  const card = castlePeakRoadEstates.find((estate) => estate.name === "帝御系列");
  assert.ok(card);
  assert.equal(card.slug, "tai-yu");
  assert.equal(getEstateEntry("tai-yu").nameZh, "帝御");
  assert.equal(
    castlePeakRoadEstates.filter((estate) => estate.slug === "tai-yu").length,
    1,
    "the grouping label must not fork 帝御 into one card per phase",
  );
});

test("THE Carmel is one estate, not a THE entry plus a Carmel entry", () => {
  const carmels = [...castlePeakRoadEstates, ...castlePeakRoadOtherEstates].filter((estate) =>
    estate.name.toUpperCase().includes("CARMEL"),
  );
  assert.equal(carmels.length, 1);
  assert.equal(carmels[0].slug, "the-carmel");
  assert.ok(
    !castlePeakRoadOtherEstates.some((estate) => estate.name.trim().toUpperCase() === "THE"),
    "the document's line break must not create a separate THE entry",
  );
});

test("the client's spellings stay searchable as aliases", () => {
  for (const [slug, label] of [
    ["oma-oma", "OMA OMA"],
    ["the-carmel", "THE CARMEL"],
  ]) {
    const aliases = getEstateEntry(slug).aliases.map((alias) => alias.toUpperCase());
    assert.ok(aliases.includes(label), `${label} must resolve to ${slug}`);
  }
});

test("the seven unresolved client names are carried verbatim, never substituted", () => {
  const group = getClientAreaGroup("castle-peak-road-west");
  assert.deepEqual(
    group.unresolved.map((entry) => entry.label),
    ["NAPA", "凱和山", "緹岸", "飛揚", "翠濤居", "棕月灣", "愛琴灣"],
  );
  const rendered = [...castlePeakRoadEstates, ...castlePeakRoadOtherEstates].map(
    (estate) => estate.name,
  );
  for (const entry of group.unresolved) {
    assert.ok(
      !rendered.includes(entry.label),
      `${entry.label} has no verified identity and must not render as a card`,
    );
    assert.ok(
      !estateRegistry.some((registryEntry) => registryEntry.nameZh === entry.label),
      `${entry.label} must not have been invented as a registry entry`,
    );
  }
});

test("every entry sources identity from estate-registry.ts, not a second copy", () => {
  for (const estate of [...castlePeakRoadEstates, ...castlePeakRoadOtherEstates]) {
    const entry = getEstateEntry(estate.slug);
    assert.equal(estate.photo, entry.photo);
    assert.equal(estate.district, entry.homepageDistrict);
    assert.equal(estate.hasPage, entry.hasPage);
    assert.equal(estate.district, "青山公路");
  }
});

test("every entry carries no invented figures -- units/avgPsf/listingCount are always null", () => {
  for (const estate of [...castlePeakRoadEstates, ...castlePeakRoadOtherEstates]) {
    assert.equal(estate.units, null, `${estate.name}.units must be null`);
    assert.equal(estate.avgPsf, null, `${estate.name}.avgPsf must be null`);
    assert.equal(estate.listingCount, null, `${estate.name}.listingCount must be null`);
  }
});
