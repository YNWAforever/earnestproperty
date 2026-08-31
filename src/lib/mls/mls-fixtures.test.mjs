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

test("parseMoneyToHkd parses 億 amounts including combined forms", () => {
  assert.equal(parseMoneyToHkd("$1.28億"), 128_000_000);
  assert.equal(parseMoneyToHkd("1億"), 100_000_000);
  assert.equal(parseMoneyToHkd("2.5億"), 250_000_000);
  assert.equal(parseMoneyToHkd("1億2,800萬"), 128_000_000);
  assert.equal(parseMoneyToHkd("$3億50萬"), 300_500_000);
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
  assert.equal(inferDistrictSlug({ streetZh: "荃灣西", buildingZh: "海雲軒" }), "sham-tseng");
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

  // This fixture's 備註 (remarks) field is literally "C-018613" -- the company
  // licence number, not a genuine property feature -- and 座向 "西南" already
  // has its own dedicated `orientation` column. Neither belongs in 物業特點.
  assert.deepEqual(rows[0].features, ["2房2廳"]);
  assert.doesNotMatch(rows[0].description, /租\$/);
});

test("normalizeListingDetail keeps each deal-type row's own description and drops the licence number from features", () => {
  // A hand-built detail rather than a new HTML fixture: both committed
  // fixtures have 出租價 "--" (no rent price), so neither ever exercises the
  // dual-deal-type path (dealTypesFor emits ["sale", "rent"] only when both
  // salePriceHkd and rentHkd are set). This is the shape parseListingDetail
  // produces, just with both prices present.
  const detail = {
    sourceUrl: "https://www.earnestproperty.com/property-detail/9999999.html",
    legacyDetailId: "9999999",
    legacyPropertyNo: "B999999",
    title: "麗都花園 第03座, 荃灣, #B999999 - 晉誠地產",
    metaDescription:
      "麗都花園 第03座, 荃灣, #B999999,售$590萬,租$19,500, 實用570呎, 建築683呎, 西南,2房2廳, ",
    sourceUpdatedAt: "2026-06-21",
    streetZh: "青山公路41-63號深井段",
    buildingZh: "麗都花園 第03座",
    buildingEn: "LIDO GDN BLK 03",
    grossArea: 683,
    saleableArea: 570,
    salePriceHkd: 5_900_000,
    rentHkd: 19_500,
    orientation: "西南",
    decoration: "開放式廚房，environment-friendly",
    remarks: "C-018613",
    bedrooms: 2,
    livingRooms: 2,
    roomText: "2房2廳，主人套房",
    images: [],
  };

  const rows = normalizeListingDetail(detail, {
    estateIdsBySlug: new Map([["lido-garden", "estate-lido"]]),
    nowIso: "2026-06-22T00:00:00.000Z",
  });

  assert.equal(rows.length, 2, "a listing with both a sale and a rent price emits two rows");
  const sale = rows.find((row) => row.deal_type === "sale");
  const rent = rows.find((row) => row.deal_type === "rent");

  // Each row's own price is correct and the OTHER deal type's price is absent
  // from that row -- the original bug baked the sale price into the rental's
  // description regardless of which row was actually being rendered.
  assert.equal(sale.price, 5_900_000);
  assert.equal(rent.rent, 19_500);
  assert.doesNotMatch(
    rent.description,
    /售\$590萬/,
    "a rental's description must not carry the sale price",
  );
  assert.doesNotMatch(
    sale.description,
    /租\$19,500/,
    "a sale listing's description must not carry the rent price",
  );
  assert.match(rent.description, /實用570呎/, "the rest of the fact list must survive the strip");

  // Neither row's features contain the licence number or a duplicate of the
  // dedicated orientation column; the comma-joined blobs are split into tags.
  for (const row of rows) {
    assert.ok(!row.features.includes("C-018613"), "features must never include the licence number");
    assert.ok(!row.features.includes("西南"), "orientation must not be duplicated into features");
    assert.ok(row.features.includes("2房2廳"));
    assert.ok(row.features.includes("主人套房"), "roomText must be split, not pushed as one blob");
    assert.ok(row.features.includes("開放式廚房"));
    assert.ok(row.features.includes("environment-friendly"));
  }
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

test("normalizeListingDetail skips listings without a legacy detail id", () => {
  const rows = normalizeListingDetail(
    {
      legacyDetailId: null,
      sourceUrl: "https://www.earnestproperty.com/property-detail/oops",
      buildingZh: "麗都花園 第03座",
      title: "麗都花園 第03座",
      salePriceHkd: 5_900_000,
    },
    { nowIso: "2026-06-22T00:00:00.000Z" },
  );

  assert.deepEqual(rows, []);
});

test("partial sync does not deactivate listings beyond maxDetails", async () => {
  const indexHtml = fixture("property-index-c1.html");
  const detailHtml = fixture("property-detail-6709182.html");
  const fetched = new Map([
    ["https://www.earnestproperty.com/property/c1", indexHtml],
    ["https://www.earnestproperty.com/property-detail/6709182.html", detailHtml],
  ]);

  let deactivateCalled = false;
  const importer = createMlsImporter({
    fetchText: async (url) => fetched.get(url) ?? "",
    db: {
      listEstateIdsBySlug: async () => new Map([["lido-garden", "estate-lido"]]),
      upsertProperties: async (rows) => ({ count: rows.length }),
      deactivateMissing: async () => {
        deactivateCalled = true;
        return { count: 5 };
      },
    },
    now: () => new Date("2026-06-22T00:00:00.000Z"),
  });

  // 10 listings discovered, only 1 fetched, no fullSync -> never deactivate.
  const result = await importer.sync({
    seedUrls: ["https://www.earnestproperty.com/property/c1"],
    maxDetails: 1,
  });

  assert.equal(result.discovered, 10);
  assert.equal(result.deactivated, 0);
  assert.equal(result.deactivationSkipped, true);
  assert.equal(deactivateCalled, false);
});

test("fullSync deactivates against the full discovered legacy id set", async () => {
  const indexHtml = fixture("property-index-c1.html");
  const detailHtml = fixture("property-detail-6709182.html");
  const fetched = new Map([
    ["https://www.earnestproperty.com/property/c1", indexHtml],
    ["https://www.earnestproperty.com/property-detail/6709182.html", detailHtml],
  ]);

  let seenLegacyIds = null;
  const importer = createMlsImporter({
    fetchText: async (url) => fetched.get(url) ?? "",
    db: {
      listEstateIdsBySlug: async () => new Map([["lido-garden", "estate-lido"]]),
      upsertProperties: async (rows) => ({ count: rows.length }),
      deactivateMissing: async ({ seenLegacyIds: ids }) => {
        seenLegacyIds = ids;
        return { count: 0 };
      },
    },
    now: () => new Date("2026-06-22T00:00:00.000Z"),
  });

  // Only 1 detail fetched, but fullSync passes EVERY discovered legacy id
  // (all 10) to deactivateMissing so unscraped listings are not swept.
  const result = await importer.sync({
    seedUrls: ["https://www.earnestproperty.com/property/c1"],
    maxDetails: 1,
    fullSync: true,
  });

  assert.equal(result.deactivationSkipped, false);
  assert.equal(seenLegacyIds.length, 10);
  assert.ok(seenLegacyIds.includes("6709182"));
});
