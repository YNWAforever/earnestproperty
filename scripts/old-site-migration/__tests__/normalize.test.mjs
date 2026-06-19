import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMigrationDataset, normalizeListing } from "../normalize.mjs";

test("normalizeListing maps parsed old detail to properties insert row", () => {
  const row = normalizeListing({
    legacyDetailId: "6470722",
    legacyUrl: "https://www.earnestproperty.com/property-detail/6470722.html",
    legacyPropertyNo: "B059390",
    titleZh: "THE CARMEL TWR 01",
    districtZh: "屯門",
    dealType: "sale",
    price: 4_500_000,
    rent: null,
    saleableArea: 461,
    grossArea: 588,
    orientation: "北",
    features: ["1房2廳", "開放廚"],
    description: "THE CARMEL TWR 01, 屯門, #B059390,售$450萬",
    images: ["https://imgs.property.hk/midPhotos/2026/example.jpeg"],
    legacySourceIndexes: ["https://www.earnestproperty.com/property/"],
  });

  assert.equal(row.listing_no, "B059390");
  assert.equal(row.title_zh, "THE CARMEL TWR 01");
  assert.equal(row.deal_type, "sale");
  assert.equal(row.district_slug, "tuen-mun");
  assert.equal(row.status, "active");
  assert.equal(row.legacy_detail_id, "6470722");
  assert.deepEqual(row.legacy_source_indexes, ["https://www.earnestproperty.com/property/"]);
});

test("buildMigrationDataset canonicalizes duplicate property numbers and sale-rent variants", () => {
  const dataset = buildMigrationDataset(
    [
      {
        legacyDetailId: "100",
        legacyUrl: "https://www.earnestproperty.com/property-detail/100.html",
        legacyPropertyNo: "P000001",
        titleZh: "海景大廈",
        districtZh: "深井",
        dealType: "sale",
        price: 5_000_000,
        rent: 18_000,
        saleableArea: 500,
        grossArea: 650,
        legacySourceIndexes: ["https://www.earnestproperty.com/property/"],
      },
      {
        legacyDetailId: "090",
        legacyUrl: "https://www.earnestproperty.com/property-detail/090.html",
        legacyPropertyNo: "P000001",
        titleZh: "海景大廈 低層",
        districtZh: "深井",
        dealType: "sale",
        price: 5_000_000,
        rent: null,
        saleableArea: 500,
        grossArea: 650,
        legacySourceIndexes: ["https://www.earnestproperty.com/property/c1/"],
      },
      {
        legacyDetailId: "080",
        legacyUrl: "https://www.earnestproperty.com/property-detail/080.html",
        legacyPropertyNo: "P000001",
        titleZh: "海景大廈 租盤",
        districtZh: "深井",
        dealType: "rent",
        price: null,
        rent: 18_000,
        saleableArea: 500,
        grossArea: 650,
        legacySourceIndexes: ["https://www.earnestproperty.com/property/c5/"],
      },
      {
        legacyDetailId: "200",
        legacyUrl: "https://www.earnestproperty.com/property-detail/200.html",
        legacyPropertyNo: "R000001",
        titleZh: "租務大廈",
        districtZh: "荃灣",
        dealType: "rent",
        price: null,
        rent: 12_000,
        saleableArea: 360,
        grossArea: 480,
        legacySourceIndexes: ["https://www.earnestproperty.com/property/c5/"],
      },
    ],
    { lastScrapedAt: "2026-06-19T00:00:00.000Z" },
  );

  assert.deepEqual(
    dataset.rows.map((row) => [row.listing_no, row.deal_type, row.price, row.rent]),
    [
      ["P000001", "sale", 5_000_000, null],
      ["P000001-R", "rent", null, 18_000],
      ["R000001", "rent", null, 12_000],
    ],
  );
  assert.equal(new Set(dataset.rows.map((row) => row.listing_no)).size, dataset.rows.length);
  assert.deepEqual(
    dataset.aliases.map((alias) => [alias.legacyDetailId, alias.listingNo]),
    [
      ["100", "P000001"],
      ["090", "P000001"],
      ["080", "P000001-R"],
      ["200", "R000001"],
    ],
  );
  assert.deepEqual(dataset.summary.duplicatePropertyNumbers, [
    { legacyPropertyNo: "P000001", parsedListings: 3, importedRows: 2 },
  ]);
});
