import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  parseAreaFeet,
  parseListingDetail,
  parseListingIndex,
  parseMoneyToHkd,
  parseRoomCounts,
} from "./parse-old-site.mjs";

function fixture(name) {
  return readFileSync(
    new URL(`../../../scripts/old-site-migration/__fixtures__/${name}`, import.meta.url),
    "utf8",
  );
}

test("parseListingIndex discovers unique property-detail URLs", () => {
  const links = parseListingIndex(
    fixture("property-index-c1.html"),
    "https://www.earnestproperty.com/property/c1",
  );

  assert.ok(links.length >= 10);
  assert.ok(links.includes("https://www.earnestproperty.com/property-detail/6709182.html"));
  assert.equal(new Set(links).size, links.length);
});

test("parseListingDetail extracts old MLS fields", () => {
  const detail = parseListingDetail(
    fixture("property-detail-6709182.html"),
    "https://www.earnestproperty.com/property-detail/6709182.html",
  );

  assert.equal(detail.legacyDetailId, "6709182");
  assert.equal(detail.legacyPropertyNo, "B054805");
  assert.equal(detail.title, "麗都花園 第03座, 荃灣, #B054805 - 晉誠地產");
  assert.equal(detail.districtName, "荃灣");
  assert.equal(detail.streetZh, "青山公路41-63號深井段");
  assert.equal(detail.buildingZh, "麗都花園 第03座");
  assert.equal(detail.buildingEn, "LIDO GDN BLK 03");
  assert.equal(detail.salePriceHkd, 5_900_000);
  assert.equal(detail.rentHkd, null);
  assert.equal(detail.grossArea, 683);
  assert.equal(detail.saleableArea, 570);
  assert.equal(detail.bedrooms, 2);
  assert.equal(detail.livingRooms, 2);
  assert.equal(detail.orientation, "西南");
  assert.equal(detail.sourceUpdatedAt, "2026-06-21");
  assert.ok(detail.images.length >= 10);
  assert.ok(detail.images[0].startsWith("https://imgs.property.hk/largePhotos/"));
});

test("primitive parsers handle Hong Kong listing text", () => {
  assert.equal(parseMoneyToHkd("590萬"), 5_900_000);
  assert.equal(parseMoneyToHkd("$1,280萬"), 12_800_000);
  assert.equal(parseMoneyToHkd("--"), null);
  assert.equal(parseAreaFeet("570 呎"), 570);
  assert.deepEqual(parseRoomCounts("2房2廳"), { bedrooms: 2, livingRooms: 2 });
  assert.deepEqual(parseRoomCounts("開放式"), { bedrooms: 0, livingRooms: null });
});
