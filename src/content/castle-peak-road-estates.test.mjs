import { test } from "node:test";
import assert from "node:assert/strict";
import { castlePeakRoadEstates } from "./castle-peak-road-estates.ts";
import { getEstateEntry } from "./estate-registry.ts";

const EXPECTED_ORDER = [
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

test("castlePeakRoadEstates has exactly the 12 青山公路 estates, in the master spec's canonical order", () => {
  assert.deepEqual(
    castlePeakRoadEstates.map((estate) => estate.slug),
    EXPECTED_ORDER,
  );
});

test("every entry sources slug/name/photo/district/hasPage from estate-registry.ts, not a second copy", () => {
  for (const estate of castlePeakRoadEstates) {
    const entry = getEstateEntry(estate.slug);
    assert.equal(estate.name, entry.nameZh);
    assert.equal(estate.photo, entry.photo);
    assert.equal(estate.district, entry.homepageDistrict);
    assert.equal(estate.hasPage, entry.hasPage);
    assert.equal(estate.district, "青山公路");
  }
});

test("every entry carries no invented figures -- units/avgPsf/listingCount are always null", () => {
  for (const estate of castlePeakRoadEstates) {
    assert.equal(estate.units, null, `${estate.name}.units must be null`);
    assert.equal(estate.avgPsf, null, `${estate.name}.avgPsf must be null`);
    assert.equal(estate.listingCount, null, `${estate.name}.listingCount must be null`);
  }
});
