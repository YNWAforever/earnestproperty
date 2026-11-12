import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createEstateResolver,
  normalizeEstateText,
  resolveDistrictFromText,
  stripBlockSuffix,
} from "./estate-resolver.mjs";

const ESTATES = [
  {
    id: "estate-ocean-pointe",
    slug: "chun-wong-kui",
    name_zh: "縉皇居",
    name_en: "OCEAN POINTE",
    aliases: null,
    district_slug: "sham-tseng",
  },
  {
    id: "estate-sea-crest",
    slug: "sea-crest-villa",
    name_zh: "浪翠園",
    name_en: "SEA CREST VILLA",
    aliases: ["SEA CREST VILLA"],
    district_slug: "sham-tseng",
  },
  {
    id: "estate-tai-wah-hin",
    slug: "tai-wah-hin",
    name_zh: "帝華軒",
    name_en: "ROYAL SEA CREST",
    aliases: ["浪翠園5期"],
    district_slug: "sham-tseng",
  },
  {
    id: "estate-gold-coast-bay",
    slug: "wong-gam-hoi-waan",
    name_zh: "黃金海灣",
    name_en: "GOLD COAST BAY",
    aliases: ["意嵐", "THE UPPLAND", "珀岸"],
    district_slug: "castle-peak-road",
  },
  {
    id: "estate-hk-gold-coast",
    slug: "wong-gam-hoi-ngon",
    name_zh: "香港黃金海岸",
    name_en: "HONG KONG GOLD COAST",
    aliases: [],
    district_slug: "castle-peak-road",
  },
  {
    id: "estate-lido",
    slug: "lido-garden",
    name_zh: "麗都花園",
    name_en: "LIDO GDN",
    aliases: ["LIDO GARDEN"],
    district_slug: "sham-tseng",
  },
];

function resolver(estates = ESTATES) {
  return createEstateResolver(estates);
}

test("normalizeEstateText folds width, 臺/台, separators and latin case", () => {
  assert.equal(normalizeEstateText("  ＯＣＥＡＮ　ＰＯＩＮＴＥ "), "oceanpointe");
  assert.equal(normalizeEstateText("海韻臺"), "海韻台");
  assert.equal(normalizeEstateText("帝御‧金灣"), "帝御金灣");
  assert.equal(normalizeEstateText("THE-CARMEL TWR 01"), "thecarmeltwr01");
  assert.equal(normalizeEstateText("麗都花園 第03座"), "麗都花園第03座");
  assert.equal(normalizeEstateText(null), "");
});

test("stripBlockSuffix removes trailing block/phase descriptors repeatedly", () => {
  const cases = [
    ["縉皇居 第01座", "縉皇居"],
    ["浪翠園 第3期", "浪翠園"],
    ["海雲軒 第02座", "海雲軒"],
    ["海景花園 A座", "海景花園"],
    ["碧堤半島 B2座", "碧堤半島"],
    ["LIDO GARDEN BLK 03", "LIDO GARDEN"],
    ["THE CARMEL TWR 01", "THE CARMEL"],
    ["黃金海灣 PHASE 5", "黃金海灣"],
    ["海韻花園 洋房", "海韻花園"],
    ["某某大廈", "某某"],
    ["香港黃金海岸", "黃金海岸"],
    ["黃金海灣 意嵐", "黃金海灣 意嵐"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(stripBlockSuffix(input), expected, input);
  }
});

test("resolveDistrictFromText maps legacy districts and never returns tsuen-wan", () => {
  const cases = [
    ["深井", "sham-tseng"],
    ["SHAM TSENG", "sham-tseng"],
    ["青山公路41-63號深井段", "sham-tseng"],
    ["汀九", "ting-kau"],
    ["TING KAU", "ting-kau"],
    ["青龍頭", "tsing-lung-tau"],
    ["TSING LUNG TAU", "tsing-lung-tau"],
    ["青山公路", "castle-peak-road"],
    ["掃管笏", "castle-peak-road"],
    ["大欖", "castle-peak-road"],
    ["黃金海岸", "castle-peak-road"],
    ["加多利灣", "castle-peak-road"],
    ["CASTLE PEAK", "castle-peak-road"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(resolveDistrictFromText(input), expected, input);
    assert.notEqual(resolveDistrictFromText(input), "tsuen-wan");
  }

  assert.equal(resolveDistrictFromText("荃灣"), null);
  assert.equal(resolveDistrictFromText("TSUEN WAN"), null);
  assert.equal(resolveDistrictFromText("荃灣西"), null);
  assert.equal(resolveDistrictFromText(""), null);
  assert.equal(resolveDistrictFromText(null), null);
});

test("resolves 縉皇居 第01座 to the estate and its sham-tseng district", () => {
  const location = resolver().resolveLocation({
    buildingZh: "縉皇居 第01座",
    streetZh: "深慈街8號",
    title: "縉皇居 第01座, 荃灣, #B064273 - 晉誠地產",
  });

  assert.deepEqual(location, {
    estateId: "estate-ocean-pointe",
    estateSlug: "chun-wong-kui",
    districtSlug: "sham-tseng",
    matchedBy: "name_zh",
    ambiguous: false,
  });
});

test("matches an English-only candidate by name_en", () => {
  const location = resolver().resolveLocation({ buildingEn: "OCEAN POINTE TWR 01" });

  assert.equal(location.estateId, "estate-ocean-pointe");
  assert.equal(location.matchedBy, "name_en");
});

test("浪翠園 第3期 resolves to 浪翠園, not the 浪翠園5期 alias estate", () => {
  const location = resolver().resolveLocation({ buildingZh: "浪翠園 第3期" });

  assert.equal(location.estateId, "estate-sea-crest");
  assert.equal(location.matchedBy, "name_zh");
});

test("alias-driven matches resolve 帝華軒 and 浪翠園5期 to the same estate", () => {
  assert.deepEqual(resolver().resolveLocation({ buildingZh: "帝華軒" }), {
    estateId: "estate-tai-wah-hin",
    estateSlug: "tai-wah-hin",
    districtSlug: "sham-tseng",
    matchedBy: "name_zh",
    ambiguous: false,
  });

  const aliasLocation = resolver().resolveLocation({ buildingZh: "浪翠園5期" });
  assert.equal(aliasLocation.estateId, "estate-tai-wah-hin");
  assert.equal(aliasLocation.matchedBy, "alias");
});

test("黃金海灣 意嵐 resolves via the primary name and keeps castle-peak-road", () => {
  const location = resolver().resolveLocation({
    buildingZh: "黃金海灣 意嵐",
    streetZh: "青山公路青山灣段",
  });

  assert.equal(location.estateId, "estate-gold-coast-bay");
  assert.equal(location.estateSlug, "wong-gam-hoi-waan");
  assert.equal(location.districtSlug, "castle-peak-road");
  assert.equal(location.matchedBy, "name_zh");
});

test("香港黃金海岸 matches after stripping the leading 香港", () => {
  const location = resolver().resolveLocation({ buildingZh: "香港黃金海岸 第1座" });

  assert.equal(location.estateId, "estate-hk-gold-coast");
  assert.equal(location.districtSlug, "castle-peak-road");
});

test("a title-only candidate still matches the estate name", () => {
  const location = resolver().resolveLocation({
    title: "麗都花園 第03座, 荃灣, #B054805 - 晉誠地產",
  });

  assert.equal(location.estateId, "estate-lido");
  assert.equal(location.matchedBy, "name_zh");
});

test("unknown building yields null estate but a district from the street", () => {
  const location = resolver().resolveLocation({
    buildingZh: "某某大廈",
    streetZh: "青山公路青龍頭段12號",
  });

  assert.deepEqual(location, {
    estateId: null,
    estateSlug: null,
    districtSlug: "tsing-lung-tau",
    matchedBy: null,
    ambiguous: false,
  });
});

test("荃灣西 does not fall back to a fabricated tsuen-wan district", () => {
  const location = resolver().resolveLocation({ buildingZh: "荃灣西", streetZh: "荃灣西" });

  assert.equal(location.estateId, null);
  assert.equal(location.districtSlug, null);
  assert.notEqual(location.districtSlug, "tsuen-wan");
});

test("two estates tied on the same longest name are reported as ambiguous", () => {
  const ambiguousResolver = resolver([
    {
      id: "estate-ocean-view-a",
      slug: "ocean-view-a",
      name_zh: "海景花園",
      name_en: "OCEAN VIEW GARDEN",
      aliases: null,
      district_slug: "sham-tseng",
    },
    {
      id: "estate-ocean-view-b",
      slug: "ocean-view-b",
      name_zh: "海景花園",
      name_en: "OCEAN VIEW GARDEN",
      aliases: null,
      district_slug: "castle-peak-road",
    },
  ]);

  const location = ambiguousResolver.resolveLocation({ buildingZh: "海景花園 第2座" });
  assert.deepEqual(location, {
    estateId: null,
    estateSlug: null,
    districtSlug: null,
    matchedBy: null,
    ambiguous: true,
  });
});

test("a longer alias wins over a shorter estate-name prefix", () => {
  const location = resolver([
    {
      id: "estate-sea-crest",
      slug: "sea-crest-villa",
      name_zh: "浪翠園",
      name_en: "SEA CREST VILLA",
      aliases: null,
      district_slug: "sham-tseng",
    },
    {
      id: "estate-tai-wah-hin",
      slug: "tai-wah-hin",
      name_zh: "帝華軒",
      name_en: "ROYAL SEA CREST",
      aliases: ["浪翠園5期"],
      district_slug: "sham-tseng",
    },
  ]).resolveLocation({ buildingZh: "浪翠園5期" });

  assert.equal(location.estateId, "estate-tai-wah-hin");
  assert.equal(location.matchedBy, "alias");
});

test("an empty estate table resolves nothing and still maps a known district", () => {
  const emptyResolver = resolver([]);
  const location = emptyResolver.resolveLocation({
    buildingZh: "縉皇居 第01座",
    streetZh: "深井青山公路",
  });

  assert.equal(location.estateId, null);
  assert.equal(location.ambiguous, false);
  assert.equal(location.districtSlug, "sham-tseng");
});
