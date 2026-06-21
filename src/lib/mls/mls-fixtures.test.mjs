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
import {
  inferDistrictSlug,
  normalizeListingDetail,
  resolveEstateSlug,
} from "./normalize-old-site.mjs";
import { createMlsImporter } from "./importer.mjs";

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

test("resolveEstateSlug maps corrected estate aliases", () => {
  assert.equal(
    resolveEstateSlug({ buildingZh: "麗都花園 第03座", buildingEn: "LIDO GDN BLK 03" }),
    "lido-garden",
  );
  assert.equal(
    resolveEstateSlug({ buildingZh: "海韻花園", buildingEn: "RHINE GARDEN" }),
    "rhine-garden",
  );
  assert.equal(resolveEstateSlug({ buildingZh: "碧堤半島", buildingEn: "BELLAGIO" }), "bellagio");
});

test("inferDistrictSlug separates Sham Tseng, Ting Kau, and Tsuen Wan", () => {
  assert.equal(
    inferDistrictSlug({ streetZh: "青山公路41-63號深井段", buildingZh: "麗都花園 第03座" }),
    "sham-tseng",
  );
  assert.equal(
    inferDistrictSlug({ streetZh: "青山公路汀九段386號", buildingZh: "觀海別墅" }),
    "ting-kau",
  );
  assert.equal(inferDistrictSlug({ streetZh: "荃灣西", buildingZh: "海雲軒" }), "tsuen-wan");
});

test("normalizeListingDetail creates a sale property row", () => {
  const parsed = parseListingDetail(
    fixture("property-detail-6709182.html"),
    "https://www.earnestproperty.com/property-detail/6709182.html",
  );
  const rows = normalizeListingDetail(parsed, {
    estateIdsBySlug: new Map([["lido-garden", "estate-lido"]]),
    nowIso: "2026-06-22T00:00:00.000Z",
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].legacy_detail_id, "6709182");
  assert.equal(rows[0].legacy_property_no, "B054805");
  assert.equal(rows[0].listing_no, "B054805-6709182-S");
  assert.equal(rows[0].deal_type, "sale");
  assert.equal(rows[0].estate_id, "estate-lido");
  assert.equal(rows[0].district_slug, "sham-tseng");
  assert.equal(rows[0].price, 5_900_000);
  assert.equal(rows[0].rent, null);
  assert.equal(rows[0].saleable_area, 570);
  assert.equal(rows[0].gross_area, 683);
  assert.equal(rows[0].bedrooms, 2);
  assert.equal(rows[0].source_site, "earnestproperty-old-site");
  assert.equal(rows[0].source_url, "https://www.earnestproperty.com/property-detail/6709182.html");
  assert.equal(rows[0].last_seen_at, "2026-06-22T00:00:00.000Z");
  assert.equal(rows[0].status, "active");
});

test("createMlsImporter dry run reports discovered, parsed, and upsertable rows", async () => {
  const indexHtml = fixture("property-index-c1.html");
  const detailHtml = fixture("property-detail-6709182.html");
  const fetched = new Map([
    ["https://www.earnestproperty.com/property/c1", indexHtml],
    ["https://www.earnestproperty.com/property-detail/6709182.html", detailHtml],
  ]);
  const importer = createMlsImporter({
    fetchText: async (url) => fetched.get(url) ?? "",
    db: {
      listEstateIdsBySlug: async () => new Map([["lido-garden", "estate-lido"]]),
      upsertProperties: async (rows) => ({ count: rows.length }),
      deactivateMissing: async () => ({ count: 0 }),
    },
    now: () => new Date("2026-06-22T00:00:00.000Z"),
  });

  const result = await importer.sync({
    seedUrls: ["https://www.earnestproperty.com/property/c1"],
    maxDetails: 1,
    dryRun: true,
  });

  assert.equal(result.discovered, 10);
  assert.equal(result.parsed, 1);
  assert.equal(result.upserted, 0);
  assert.equal(result.dryRunRows.length, 1);
  assert.equal(result.dryRunRows[0].listing_no, "B054805-6709182-S");
});
