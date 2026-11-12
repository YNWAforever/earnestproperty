import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  MAX_DETAIL_ERROR_RATE,
  MIN_DISCOVERED_FOR_SWEEP,
  createHardenedFetchText,
  createMlsImporter,
} from "./importer.mjs";
import { createNeonMlsDb } from "./neon-db.mjs";
import { normalizeListingDetail } from "./normalize-old-site.mjs";
import { parseListingDetail, parseListingRows } from "./parse-old-site.mjs";

const ORIGIN = "https://www.earnestproperty.com.hk";
const SEED_URL = `${ORIGIN}/property/`;
const SEED_PAGE_2_URL = `${ORIGIN}/property/?page=2`;

function fixture(name) {
  return readFileSync(
    new URL(`../../../scripts/old-site-migration/__fixtures__/${name}`, import.meta.url),
    "utf8",
  );
}

function syntheticIndexHtml(ids, { pager = false } = {}) {
  const anchors = ids
    .map((id) => `<a href="/property-detail/${id}.html" class="tnimage">Listing ${id}</a>`)
    .join("\n");
  const pagerMarkup = pager ? `<script>findForm_submit("page", 2)</script>` : "";
  return `<html><body>${anchors}${pagerMarkup}</body></html>`;
}

function syntheticDetailHtml({
  detailId,
  propertyNo = `B${String(detailId).slice(-6).padStart(6, "0")}`,
  buildingZh = "麗都花園 第03座",
  buildingEn = "LIDO GDN BLK 03",
  salePrice = "590萬",
  rentPrice = "--",
  leaseExpiry = "2050 (尚餘24年)",
} = {}) {
  const rows = [
    ["更新日期", "2026-11-11"],
    ["物業用途", "住宅"],
    ["地區", "荃灣"],
    ["街道 (英)", "CASTLE PEAK RD 41-63, SHAM TSENG"],
    ["街道 (中)", "青山公路41-63號深井段"],
    ["大廈 (英)", buildingEn],
    ["大廈 (中)", buildingZh],
    ["層數", "高"],
    ["單位", "A"],
    ["建築面積", "683 呎"],
    ["實用面積", "570 呎"],
    ["售價", salePrice],
    ["出租價", rentPrice],
    ["呎售(建築/實用)", "$8,638 / $10,351"],
    ["呎租(建築/實用)", "-- / --"],
    ["入伙年份", "1989"],
    ["地契年期", leaseExpiry],
    ["聯絡人", "VINCY 林詠斯, 海韻分行"],
    ["聯絡電話", "66815625, 2688 6996"],
    ["座向景觀", "西南"],
    ["間格", "2房2廳"],
    ["裝修", "靚裝"],
    ["備註", "有匙"],
  ];
  const table = rows
    .map(([label, value]) => `<tr><td bgcolor='#eef6de'>${label}</td><td>${value}</td></tr>`)
    .join("\n");

  return `<!doctype html>
<html>
  <head>
    <title>${buildingZh}, 荃灣, #${propertyNo} - 晉誠地產</title>
    <meta name="description" content="${buildingZh}, 荃灣, #${propertyNo},售$590萬, 實用570呎, 建築683呎, " />
  </head>
  <body>
    <span>物業編號: ${propertyNo}</span>
    <table>${table}</table>
  </body>
</html>`;
}

function detailUrl(id) {
  return `${ORIGIN}/property-detail/${id}.html`;
}

function createRecordingDb({
  estates = [],
  estateIdsBySlug = new Map(),
  deactivateResult = { count: 0 },
} = {}) {
  const calls = {
    upserted: null,
    deactivate: null,
    listEstateIdsBySlug: 0,
  };
  const db = {
    listEstates: async () => estates,
    listEstateIdsBySlug: async () => {
      calls.listEstateIdsBySlug += 1;
      return estateIdsBySlug;
    },
    upsertProperties: async (rows) => {
      calls.upserted = rows;
      return { count: rows.length };
    },
    deactivateMissing: async (input) => {
      calls.deactivate = input;
      return deactivateResult;
    },
  };
  return { db, calls };
}

const OLD_STYLE_DB = {
  listEstateIdsBySlug: async () => new Map([["lido-garden", "estate-lido"]]),
  upsertProperties: async (rows) => ({ count: rows.length }),
  deactivateMissing: async () => ({ count: 0 }),
};

test("parseListingRows parses every live listing card once", () => {
  const rows = parseListingRows(fixture("property-index-live-20261112.html"), SEED_URL);

  assert.equal(rows.length, 10);
  assert.equal(new Set(rows.map((row) => row.detailId)).size, 10);

  const first = rows[0];
  assert.equal(first.detailId, "6873216");
  assert.equal(first.detailUrl, detailUrl("6873216"));
  assert.equal(first.sourceUpdatedAt, "2026-11-11");
  assert.equal(first.propertyUse, "住宅");
  assert.equal(first.districtName, "荃灣");
  assert.equal(first.building, "荃灣 縉皇居 第01座");
  assert.equal(first.floor, "高");
  assert.equal(first.grossArea, 1088);
  assert.equal(first.saleableArea, 775);
  assert.equal(first.salePriceHkd, 10_200_000);
  assert.equal(first.rentHkd, null);
  assert.equal(first.canonicalPropertyNo, "B064273");
  assert.equal(first.hasVr, false);
  assert.deepEqual(first.dealTypes, ["sale"]);

  const dual = rows.find((row) => row.detailId === "6872040");
  assert.deepEqual(dual.dealTypes, ["sale", "rent"]);
  assert.equal(dual.salePriceHkd, 80_000_000);
  assert.equal(dual.rentHkd, 138_000);
  assert.equal(dual.grossArea, null);
  assert.equal(dual.saleableArea, 3227);
  assert.equal(dual.districtName, "屯門");

  const vrRow = rows.find((row) => row.detailId === "6870788");
  assert.equal(vrRow.hasVr, true);
});

test("parseListingDetail captures the new capture columns and contact arrays", () => {
  const detail = parseListingDetail(
    fixture("property-detail-live-20261112.html"),
    detailUrl("6873216"),
  );

  assert.equal(detail.unit, "A");
  assert.equal(detail.propertyUse, "住宅");
  assert.equal(detail.yearCompleted, 2000);
  assert.equal(detail.leaseExpiryYear, 2047);
  assert.equal(detail.salePsfGross, 9375);
  assert.equal(detail.salePsfSaleable, 13161);
  assert.equal(detail.rentPsfGross, null);
  assert.equal(detail.rentPsfSaleable, null);
  assert.equal(detail.remarks, "C-018613");
  assert.deepEqual(detail.contactNames, ["VINCY 林詠斯", "海韻分行 VINCY"]);
  assert.deepEqual(detail.contactPhones, ["66815625", "26886996"]);
  assert.equal(detail.rawFields["入伙年份"], "2000");
  assert.equal(detail.rawFields["地契年期"], "2047");
  assert.equal(detail.rawFields["呎售(建築/實用)"], "$9,375 / $13,161");
});

test("parseListingDetail parses lease-expiry text with a remaining-years suffix", () => {
  const detail = parseListingDetail(
    syntheticDetailHtml({ detailId: "7000001", leaseExpiry: "2050 (尚餘24年)" }),
    detailUrl("7000001"),
  );

  assert.equal(detail.leaseExpiryYear, 2050);
  assert.equal(detail.yearCompleted, 1989);
  assert.deepEqual(detail.contactPhones, ["66815625", "26886996"]);
});

test("normalizeListingDetail emits the new capture columns, title_en and source_payload", () => {
  const detail = parseListingDetail(
    fixture("property-detail-live-20261112.html"),
    detailUrl("6873216"),
  );
  const rows = normalizeListingDetail(detail, {
    nowIso: "2026-11-12T00:00:00.000Z",
    resolveLocation: () => ({
      estateId: "estate-ocean-pointe",
      estateSlug: "chun-wong-kui",
      districtSlug: "sham-tseng",
      matchedBy: "name_zh",
      ambiguous: false,
    }),
  });

  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.listing_no, "B064273-6873216-S");
  // The DB column must carry the canonical number: public identity grouping and
  // canonical-master dedupe read `properties.canonical_property_no`, not the
  // payload copy. Regression for the first apply writing NULL canonical.
  assert.equal(row.canonical_property_no, "B064273");
  assert.equal(row.title_en, "OCEAN POINTE TWR 01 售盤 #B064273");
  assert.equal(row.estate_id, "estate-ocean-pointe");
  assert.equal(row.district_slug, "sham-tseng");
  assert.equal(row.unit_no, "A");
  assert.equal(row.year_completed, 2000);
  assert.equal(row.lease_expiry_year, 2047);
  assert.equal(row.property_use, "住宅");
  assert.equal(row.remarks, "C-018613");

  assert.equal(row.source_payload.parser, "old-site-detail/v1");
  assert.equal(row.source_payload.capturedAt, "2026-11-12T00:00:00.000Z");
  assert.equal(row.source_payload.canonicalPropertyNo, "B064273");
  assert.equal(row.source_payload.yearCompleted, 2000);
  assert.equal(row.source_payload.leaseExpiryYear, 2047);
  assert.equal(row.source_payload.propertyUse, "住宅");
  assert.equal(row.source_payload.unitNo, "A");
  assert.equal(row.source_payload.rawFields["入伙年份"], "2000");
  assert.deepEqual(row.source_payload.contacts.names, ["VINCY 林詠斯", "海韻分行 VINCY"]);
  assert.deepEqual(row.source_payload.contacts.phones, ["66815625", "26886996"]);
  assert.deepEqual(row.source_payload.psf, {
    saleGross: 9375,
    saleSaleable: 13161,
    rentGross: null,
    rentSaleable: null,
  });
  assert.equal(row.source_payload.canonicalMissing, undefined);
  // The payload is JSON-safe and comfortably under the 8KB target.
  assert.ok(JSON.stringify(row.source_payload).length < 8192);
  // Remarks/contacts must not leak into the marketing fields.
  assert.doesNotMatch(row.description, /C-018613/);
  assert.ok(!JSON.stringify(row.features ?? []).includes("C-018613"));
});

test("normalizeListingDetail flags a missing canonical property number", () => {
  const rows = normalizeListingDetail(
    {
      legacyDetailId: "7000003",
      legacyPropertyNo: null,
      sourceUrl: detailUrl("7000003"),
      title: "某某大廈",
      buildingZh: "某某大廈",
      streetZh: "青山公路深井段1號",
      salePriceHkd: 5_000_000,
      saleableArea: 400,
      grossArea: 500,
    },
    { nowIso: "2026-11-12T00:00:00.000Z" },
  );

  assert.equal(rows.length, 1);
  assert.ok(rows[0].listing_no.startsWith("OLD-"));
  assert.equal(rows[0].canonical_property_no, null);
  assert.equal(rows[0].source_payload.canonicalMissing, true);
  assert.equal(rows[0].title_en, null);
});

test("pair-aware sync passes seenPairs/protectedLegacyIds and resolves estates from listEstates", async () => {
  const ids = Array.from({ length: 300 }, (_, index) => String(7_000_000 + index));
  const pageOne = syntheticIndexHtml(ids.slice(0, 150), { pager: true });
  const pageTwo = syntheticIndexHtml(ids.slice(150));
  const saleDetail = syntheticDetailHtml({ detailId: ids[0], salePrice: "590萬" });
  const rentDetail = syntheticDetailHtml({
    detailId: ids[1],
    salePrice: "--",
    rentPrice: "42000",
  });
  const documents = new Map([
    [SEED_URL, pageOne],
    [SEED_PAGE_2_URL, pageTwo],
    [detailUrl(ids[0]), saleDetail],
    [detailUrl(ids[1]), rentDetail],
  ]);
  const { db, calls } = createRecordingDb({
    estates: [
      {
        id: "estate-lido",
        slug: "lido-garden",
        name_zh: "麗都花園",
        name_en: "LIDO GDN",
        aliases: ["LIDO GARDEN"],
        district_slug: "sham-tseng",
      },
    ],
    // Deliberately wrong legacy map: the resolver must win when listEstates exists.
    estateIdsBySlug: new Map([["lido-garden", "estate-legacy-map"]]),
    deactivateResult: { count: 1, coverage: 0.6, coverageOverride: true },
  });
  const importer = createMlsImporter({
    fetchText: async (url) => {
      const document = documents.get(url);
      if (document === undefined) throw new Error(`unexpected URL ${url}`);
      return document;
    },
    db,
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  });

  const result = await importer.sync({
    seedUrls: [SEED_URL],
    maxDetails: 2,
    fullSync: true,
    allowLowCoverage: true,
  });

  assert.equal(result.discovered, 300);
  assert.equal(result.selected, 2);
  assert.equal(result.fetched, 2);
  assert.equal(result.parsed, 2);
  assert.equal(result.upserted, 2);
  assert.equal(result.deactivated, 1);
  assert.equal(result.deactivationSkipped, false);
  assert.equal(result.deactivationBlocked, null);
  assert.equal(result.errorRate, 0);
  assert.equal(result.errorBudgetExceeded, false);
  assert.equal(result.estateResolved, 2);
  assert.equal(result.estateUnresolved, 0);
  assert.equal(result.canonicalMissing, 0);

  assert.equal(calls.upserted.length, 2);
  assert.deepEqual(
    calls.upserted.map((row) => [row.deal_type, row.estate_id, row.district_slug]),
    [
      ["sale", "estate-lido", "sham-tseng"],
      ["rent", "estate-lido", "sham-tseng"],
    ],
  );
  assert.equal(calls.upserted[0].unit_no, "A");
  assert.equal(calls.upserted[0].year_completed, 1989);
  assert.equal(calls.upserted[0].lease_expiry_year, 2050);

  assert.deepEqual(calls.deactivate.seenPairs, [
    [ids[0], "sale"],
    [ids[1], "rent"],
  ]);
  assert.equal(calls.deactivate.sourceSite, "earnestproperty-old-site");
  assert.equal(calls.deactivate.nowIso, "2026-11-12T00:00:00.000Z");
  assert.deepEqual(calls.deactivate.seenLegacyIds, ids);
  assert.equal(calls.deactivate.protectedLegacyIds.length, 298);
  assert.ok(calls.deactivate.protectedLegacyIds.includes(ids[2]));
  assert.ok(!calls.deactivate.protectedLegacyIds.includes(ids[0]));
  // The one-off reconciliation flag reaches the DB layer and is surfaced.
  assert.equal(calls.deactivate.allowLowCoverage, true);
  assert.equal(result.coverageOverride, true);

  assert.deepEqual(result.pairsSeen, [
    [ids[0], "sale"],
    [ids[1], "rent"],
  ]);
  assert.equal(result.protectedLegacyIds.length, 298);
  assert.equal(result.discoveredLegacyIds.length, 300);
});

test("a legacy db without listEstates keeps slug-map resolution working", async () => {
  const indexHtml = fixture("property-index-c1.html");
  const detailHtml = fixture("property-detail-6709182.html");
  const fetched = new Map([
    ["https://www.earnestproperty.com/property/c1", indexHtml],
    ["https://www.earnestproperty.com/property-detail/6709182.html", detailHtml],
  ]);
  const importer = createMlsImporter({
    fetchText: async (url) => fetched.get(url) ?? "",
    db: OLD_STYLE_DB,
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  });

  const result = await importer.sync({
    seedUrls: ["https://www.earnestproperty.com/property/c1"],
    maxDetails: 1,
    dryRun: true,
  });

  assert.equal(result.fetched, 1);
  assert.equal(result.parsed, 1);
  assert.equal(result.dryRunRows[0].estate_id, "estate-lido");
  assert.equal(result.dryRunRows[0].district_slug, "sham-tseng");
  assert.deepEqual(result.pairsSeen, [["6709182", "sale"]]);
  assert.equal(result.errorRate, 0);
  assert.equal(result.errorBudgetExceeded, false);
});

test("detail error budget is reported on dry runs and blocks apply before any write", async () => {
  const ids = ["7100001", "7100002", "7100003", "7100004"];
  const documents = new Map([
    [SEED_URL, syntheticIndexHtml(ids)],
    [detailUrl(ids[0]), syntheticDetailHtml({ detailId: ids[0] })],
  ]);
  const fetchText = async (url) => {
    if (url === detailUrl(ids[1])) throw new Error("detail fetch exploded");
    const document = documents.get(url);
    if (document === undefined) throw new Error(`unexpected URL ${url}`);
    return document;
  };
  let upserts = 0;
  let deactivates = 0;
  const db = {
    ...OLD_STYLE_DB,
    upsertProperties: async (rows) => {
      upserts += 1;
      return { count: rows.length };
    },
    deactivateMissing: async () => {
      deactivates += 1;
      return { count: 0 };
    },
  };
  const importer = createMlsImporter({
    fetchText,
    db,
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  });

  const dryRun = await importer.sync({
    seedUrls: [SEED_URL],
    maxDetails: 2,
    dryRun: true,
  });
  assert.equal(dryRun.errors.length, 1);
  assert.equal(dryRun.errorRate, 0.5);
  assert.equal(dryRun.errorBudgetExceeded, true);
  assert.ok(dryRun.errorRate > MAX_DETAIL_ERROR_RATE);
  assert.equal(dryRun.deactivationBlocked, "DISCOVERY_TOO_SMALL");
  assert.equal(upserts, 0);
  assert.equal(deactivates, 0);

  await assert.rejects(
    importer.sync({ seedUrls: [SEED_URL], maxDetails: 2 }),
    (error) => error.code === "detail_error_budget_exceeded",
  );
  assert.equal(upserts, 0, "the error budget must trip before any DB write");
  assert.equal(deactivates, 0);
});

test("a discovery pass below MIN_DISCOVERED_FOR_SWEEP never deactivates, even with fullSync", async () => {
  const ids = ["7200001", "7200002", "7200003", "7200004"];
  const documents = new Map([[SEED_URL, syntheticIndexHtml(ids)]]);
  for (const id of ids) documents.set(detailUrl(id), syntheticDetailHtml({ detailId: id }));
  let deactivates = 0;
  const db = {
    ...OLD_STYLE_DB,
    deactivateMissing: async () => {
      deactivates += 1;
      return { count: 0 };
    },
  };
  const importer = createMlsImporter({
    fetchText: async (url) => {
      const document = documents.get(url);
      if (document === undefined) throw new Error(`unexpected URL ${url}`);
      return document;
    },
    db,
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  });

  assert.ok(MIN_DISCOVERED_FOR_SWEEP > ids.length);
  const partial = await importer.sync({ seedUrls: [SEED_URL] });
  assert.equal(partial.discovered, 4);
  assert.equal(partial.fetched, 4);
  assert.equal(partial.parsed, 4);
  assert.equal(partial.deactivationSkipped, true);
  assert.equal(partial.deactivationBlocked, "DISCOVERY_TOO_SMALL");
  assert.equal(deactivates, 0);

  const forced = await importer.sync({ seedUrls: [SEED_URL], fullSync: true });
  assert.equal(forced.deactivationSkipped, true);
  assert.equal(forced.deactivationBlocked, "DISCOVERY_TOO_SMALL");
  assert.equal(deactivates, 0);
});

test("one error in two details exceed the error budget (2%)", () => {
  assert.equal(1 / 2 > MAX_DETAIL_ERROR_RATE, true);
  assert.equal(MAX_DETAIL_ERROR_RATE, 0.02);
});

test("discover caps list-page requests at maxPages when the index advertises more", async () => {
  const requested = [];
  const indexHtmlFor = (ids) =>
    `<html><body>${ids
      .map((id) => `<a href="/property-detail/${id}.html">${id}</a>`)
      .join("\n")}<script>findForm_submit("page", 9)</script></body></html>`;
  const importer = createMlsImporter({
    fetchText: async (url) => {
      requested.push(url);
      return indexHtmlFor(["7300001", "7300002"]);
    },
    db: OLD_STYLE_DB,
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  });

  const discovered = await importer.discover([SEED_URL], { maxPages: 2 });

  assert.deepEqual(requested, [SEED_URL, SEED_PAGE_2_URL]);
  assert.deepEqual(discovered, [detailUrl("7300001"), detailUrl("7300002")]);
});

function response(body, { status = 200, headers = {} } = {}) {
  return new Response(body, { status, headers });
}

test("createHardenedFetchText retries transient statuses with backoff and honours Retry-After", async () => {
  const sleeps = [];
  const attempts = [];
  const fetchText = createHardenedFetchText({
    fetchImpl: async (url, init) => {
      attempts.push({ url, hasSignal: init.signal instanceof AbortSignal });
      if (attempts.length === 1)
        return response("busy", { status: 503, headers: { "retry-after": "7" } });
      if (attempts.length === 2) return response("nope", { status: 500 });
      return response("<html>ok</html>");
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    retries: 3,
  });

  assert.equal(await fetchText(SEED_URL), "<html>ok</html>");
  assert.equal(attempts.length, 3);
  assert.ok(attempts[0].hasSignal, "the timeout signal must be forwarded to fetch");
  assert.deepEqual(sleeps, [7000, 4000]);
});

test("createHardenedFetchText retries network errors and fails with code fetch_failed", async () => {
  const sleeps = [];
  const networkFetch = createHardenedFetchText({
    fetchImpl: async () => {
      throw new TypeError("socket hang up");
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    retries: 1,
  });

  await assert.rejects(networkFetch(SEED_URL), (error) => {
    assert.equal(error.code, "fetch_failed");
    assert.equal(error.status, null);
    return true;
  });
  assert.deepEqual(sleeps, [1000]);

  const sleepsAlways = [];
  let attempts = 0;
  const always503 = createHardenedFetchText({
    fetchImpl: async () => {
      attempts += 1;
      return response("down", { status: 503 });
    },
    sleep: async (ms) => {
      sleepsAlways.push(ms);
    },
    retries: 3,
  });
  await assert.rejects(always503(SEED_URL), (error) => {
    assert.equal(error.code, "fetch_failed");
    assert.equal(error.status, 503);
    return true;
  });
  assert.equal(attempts, 4);
  assert.deepEqual(sleepsAlways, [1000, 4000, 10000]);
});

test("createHardenedFetchText does not retry terminal responses or oversized bodies", async () => {
  const sleeps = [];
  const fetchText = createHardenedFetchText({
    fetchImpl: async () => response("missing", { status: 404 }),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  await assert.rejects(fetchText(SEED_URL), (error) => {
    assert.equal(error.code, "fetch_failed");
    assert.equal(error.status, 404);
    return true;
  });
  assert.deepEqual(sleeps, []);

  const tooLarge = createHardenedFetchText({
    fetchImpl: async () =>
      response("x".repeat(64), { headers: { "content-length": String(10 * 1024 * 1024) } }),
    sleep: async () => {},
    maxBytes: 1024,
  });
  await assert.rejects(tooLarge(SEED_URL), (error) => {
    assert.equal(error.code, "fetch_failed");
    return true;
  });
});

test("neon-db listEstates and upsertProperties persist the capture columns", async () => {
  const calls = [];
  const db = createNeonMlsDb({
    query: async (statement, params) => {
      calls.push({ statement, params });
      return [];
    },
  });

  const estates = [
    {
      id: "estate-lido",
      slug: "lido-garden",
      name_zh: "麗都花園",
      name_en: "LIDO GDN",
      aliases: null,
      district_slug: "sham-tseng",
    },
  ];
  assert.ok(estates.length > 0);
  assert.deepEqual(await db.listEstates(), []);
  assert.match(calls[0].statement, /SELECT id, slug, name_zh, name_en, aliases, district_slug/);

  await db.upsertProperties([
    {
      listing_no: "B054805-6709182-S",
      legacy_detail_id: "6709182",
      deal_type: "sale",
      unit_no: "A",
      year_completed: 1989,
      lease_expiry_year: 2047,
      property_use: "住宅",
      remarks: "有匙",
      source_payload: { parser: "old-site-detail/v1" },
    },
    { listing_no: "OLD-1-1-S", legacy_detail_id: "1", deal_type: "sale" },
  ]);

  const ownership = calls[1];
  assert.match(ownership.statement, /listing_no = ANY\(\$1::text\[\]\)/);
  assert.deepEqual(ownership.params, [["B054805-6709182-S", "OLD-1-1-S"]]);

  const [insert] = calls.slice(2);
  assert.match(
    insert.statement,
    /unit_no, year_completed, lease_expiry_year, property_use, remarks, source_payload/,
  );
  assert.match(insert.statement, /\$31, \$32, \$33, \$34, \$35, \$36/);
  assert.equal(insert.params[29], undefined);
  assert.deepEqual(insert.params.slice(30, 36), [
    "A",
    1989,
    2047,
    "住宅",
    "有匙",
    { parser: "old-site-detail/v1" },
  ]);

  const [secondInsert] = calls.slice(3);
  assert.deepEqual(secondInsert.params.slice(30, 36), [null, null, null, null, null, null]);
});

test("neon-db upsertProperties skips listing_no owned by another feed or by the v2 writer", async () => {
  const calls = [];
  const db = createNeonMlsDb({
    query: async (statement, params) => {
      calls.push({ statement, params });
      if (/WHERE listing_no = ANY/.test(statement)) {
        return [
          {
            listing_no: "C010229-6818486-R",
            source_site: "propertyhk",
            legacy_detail_id: null,
            deal_type: "rent",
            ingestion_owner: "no-hermes-v2",
          },
          {
            listing_no: "A063817-6761032-S",
            source_site: "earnestproperty-old-site",
            legacy_detail_id: "6761032",
            deal_type: "sale",
            ingestion_owner: "no-hermes-v2",
          },
        ];
      }
      return [];
    },
  });

  const result = await db.upsertProperties([
    { listing_no: "C010229-6818486-R", legacy_detail_id: "6818486", deal_type: "rent" },
    { listing_no: "A063817-6761032-S", legacy_detail_id: "6761032", deal_type: "sale" },
    { listing_no: "A063817-6761032-R", legacy_detail_id: "6761032", deal_type: "rent" },
  ]);

  assert.equal(result.count, 1);
  assert.deepEqual(result.conflicts, [
    {
      listing_no: "C010229-6818486-R",
      canonical_property_no: null,
      deal_type: "rent",
      existing_source_site: "propertyhk",
      existing_legacy_detail_id: null,
      existing_deal_type: "rent",
      existing_ingestion_owner: "no-hermes-v2",
    },
    {
      listing_no: "A063817-6761032-S",
      canonical_property_no: null,
      deal_type: "sale",
      existing_source_site: "earnestproperty-old-site",
      existing_legacy_detail_id: "6761032",
      existing_deal_type: "sale",
      existing_ingestion_owner: "no-hermes-v2",
    },
  ]);
  // One ownership SELECT + one INSERT: neither fenced row reaches the trigger.
  assert.equal(calls.length, 2);
  assert.match(calls[1].statement, /INSERT INTO properties/);
});

test("neon-db deactivateMissing uses the pair sweep when seenPairs is provided", async () => {
  const calls = [];
  const db = createNeonMlsDb({
    query: async (statement, params) => {
      calls.push({ statement, params });
      if (calls.length === 1) return [{ active_count: 10, seen_count: 9 }];
      return [{ id: "property-1" }];
    },
  });

  const result = await db.deactivateMissing({
    sourceSite: "earnestproperty-old-site",
    seenLegacyIds: ["1", "2", "3"],
    seenPairs: [["1", "sale"]],
    protectedLegacyIds: ["2"],
    nowIso: "2026-11-12T00:00:00.000Z",
  });

  assert.equal(result.count, 1);
  assert.equal(calls.length, 2);
  const [sweep] = calls.slice(1);
  assert.match(sweep.statement, /unnest\(\$2::text\[\], \$3::text\[\]\)/);
  assert.match(sweep.statement, /legacy_detail_id <> ALL\(\$4::text\[\]\)/);
  assert.match(sweep.statement, /status <> 'inactive'/);
  assert.deepEqual(sweep.params, [
    "earnestproperty-old-site",
    ["1"],
    ["sale"],
    ["2"],
    "2026-11-12T00:00:00.000Z",
  ]);
});

test("neon-db deactivateMissing keeps the legacy seenLegacyIds sweep for old callers", async () => {
  const calls = [];
  const db = createNeonMlsDb({
    query: async (statement, params) => {
      calls.push({ statement, params });
      if (calls.length === 1) return [{ active_count: 4, seen_count: 4 }];
      return [{ id: "a" }, { id: "b" }];
    },
  });

  const result = await db.deactivateMissing({
    sourceSite: "earnestproperty-old-site",
    seenLegacyIds: ["1", "2"],
    nowIso: "2026-11-12T00:00:00.000Z",
  });

  assert.equal(result.count, 2);
  const [sweep] = calls.slice(1);
  assert.doesNotMatch(sweep.statement, /unnest\(/);
  assert.match(sweep.statement, /legacy_detail_id <> ALL\(\$2::text\[\]\)/);
  assert.deepEqual(sweep.params, [
    "earnestproperty-old-site",
    ["1", "2"],
    "2026-11-12T00:00:00.000Z",
  ]);
});

test("neon-db deactivateMissing refuses an empty pair set and low-coverage discoveries", async () => {
  let calls = 0;
  const emptyPairsDb = createNeonMlsDb({
    query: async () => {
      calls += 1;
      return [];
    },
  });
  assert.deepEqual(
    await emptyPairsDb.deactivateMissing({
      sourceSite: "earnestproperty-old-site",
      seenLegacyIds: ["1"],
      seenPairs: [],
      nowIso: "2026-11-12T00:00:00.000Z",
    }),
    { count: 0, skipped: "NO_SEEN_PAIRS" },
  );
  assert.equal(calls, 0, "the guard must short-circuit before any SQL");

  const lowCoverageDb = createNeonMlsDb({
    query: async () => [{ active_count: 10, seen_count: 1 }],
  });
  const blocked = await lowCoverageDb.deactivateMissing({
    sourceSite: "earnestproperty-old-site",
    seenLegacyIds: ["1"],
    seenPairs: [["1", "sale"]],
    protectedLegacyIds: [],
    nowIso: "2026-11-12T00:00:00.000Z",
  });
  assert.equal(blocked.count, 0);
  assert.equal(blocked.skipped, "DISCOVERY_COVERAGE_TOO_LOW");
  assert.equal(blocked.coverage, 0.1);

  // The one-off reconciliation override is explicit, reported, and still uses
  // the pair sweep (a bare override would otherwise look like a healthy run).
  let overriddenCalls = 0;
  const overriddenDb = createNeonMlsDb({
    query: async (statement) => {
      overriddenCalls += 1;
      if (/count\(DISTINCT legacy_detail_id\)/.test(statement)) {
        return [{ active_count: 10, seen_count: 1 }];
      }
      return [{ id: "property-1" }];
    },
  });
  const overridden = await overriddenDb.deactivateMissing({
    sourceSite: "earnestproperty-old-site",
    seenLegacyIds: ["1"],
    seenPairs: [["1", "sale"]],
    protectedLegacyIds: [],
    nowIso: "2026-11-12T00:00:00.000Z",
    allowLowCoverage: true,
  });
  assert.deepEqual(overridden, { count: 1, coverage: 0.1, coverageOverride: true });
  assert.equal(overriddenCalls, 2);
});

test("sync without the override keeps the default coverage refusal", async () => {
  const ids = Array.from({ length: 300 }, (_, index) => String(7_100_000 + index));
  const documents = new Map([[SEED_URL, syntheticIndexHtml(ids)]]);
  for (const id of ids) documents.set(detailUrl(id), syntheticDetailHtml({ detailId: id }));
  const { db, calls } = createRecordingDb({
    estates: [],
    // Simulate a DB that refuses the sweep: the importer must not invent success.
    deactivateResult: { count: 0, skipped: "DISCOVERY_COVERAGE_TOO_LOW", coverage: 0.2 },
  });
  const importer = createMlsImporter({
    fetchText: async (url) => documents.get(url) ?? "",
    db,
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  });
  const result = await importer.sync({ seedUrls: [SEED_URL], maxDetails: 400, fullSync: true });
  assert.equal(calls.deactivate.allowLowCoverage, false);
  assert.equal(result.deactivationBlocked, "DISCOVERY_COVERAGE_TOO_LOW");
  assert.equal(result.coverageOverride, false);
});
