import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEstateSlug, inferDistrictSlug } from "./normalize-old-site.mjs";

const estateCases = [
  ["浪翠園5期 帝華軒", "tai-wah-hin"],
  ["浪翠園 第3期", "sea-crest-villa"],
  ["海韻台", "hoi-wan-toi"],
  ["海韻臺", "hoi-wan-toi"],
  ["RHINE TERRACE", "hoi-wan-toi"],
  ["海韻花園", "rhine-garden"],
  ["RHINE GARDEN", "rhine-garden"],
  ["黃金海灣 意嵐", "wong-gam-hoi-waan"],
  ["香港黃金海岸", "wong-gam-hoi-ngon"],
  ["帝御‧嵐天", "tai-yu"],
  ["帝濤灣 浪琴軒", "tai-tou-waan"],
];

for (const [buildingZh, expectedSlug] of estateCases) {
  test(`buildingZh "${buildingZh}" resolves to slug "${expectedSlug}"`, () => {
    assert.equal(resolveEstateSlug({ buildingZh }), expectedSlug);
  });
}

test("海雲軒 no longer falls through to tsuen-wan under the old district-inference rule", () => {
  assert.notEqual(inferDistrictSlug({ buildingZh: "海雲軒" }), "tsuen-wan");
  assert.equal(inferDistrictSlug({ buildingZh: "海雲軒" }), "sham-tseng");
});

test("縉皇居 no longer falls through to tsuen-wan under the old district-inference rule", () => {
  assert.notEqual(inferDistrictSlug({ buildingZh: "縉皇居" }), "tsuen-wan");
  assert.equal(inferDistrictSlug({ buildingZh: "縉皇居" }), "sham-tseng");
});
