import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeListing } from "../normalize.mjs";

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
