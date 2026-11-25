import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as market from "./market-transactions.ts";

/**
 * Everything in this file is synthetic. The only real data touched is the
 * committed snapshot (derived counts + determinism), never archive rows or real
 * addresses.
 */

// Both slugs exist in src/content/estate-registry.ts.
const COVERED = "bellagio";
const EMPTY = "chung-yuet-waan";

function syntheticRow(overrides = {}) {
  return {
    ref: "T0000001",
    yearFilter: 2026,
    registrationDate: "2026-10-15",
    instrumentDate: "2026-10-08",
    registrationNo: "TESTREG0001",
    nature: "買賣合約",
    phase: null,
    tower: "第01座",
    houseId: null,
    floor: "8",
    unit: "A",
    address: "測試屋苑 第01座 8樓 A室",
    district: "測試區",
    considerationMillion: 6.5,
    grossAreaSqft: 500,
    pricePerSqft: 13000,
    psfBasis: "建築",
    completionYear: 2000,
    ...overrides,
  };
}

function syntheticEstate(slug, rows, overrides = {}) {
  const dates = rows.map((row) => row.registrationDate).sort();
  return {
    slug,
    nameZh: "測試屋苑",
    sourcePackage: "estates-61",
    asOf: "2026-11-23T01:51:39+08:00",
    registrationThrough: dates.length === 0 ? null : dates[dates.length - 1],
    rowCount: rows.length,
    status: rows.length === 0 ? "filtered-empty" : "covered",
    note: rows.length === 0 ? "測試：此來源及期間的公開列表搜尋結果為空，不代表沒有成交。" : null,
    listSourceUrl: "https://example.test/tran_prop.php?year=2026",
    ...overrides,
  };
}

function syntheticChartMonth(overrides = {}) {
  return {
    slug: COVERED,
    month: "2025-01",
    count: 3,
    avgPsf: 12000,
    sourceDisplayedPpsf: "12000",
    visualVerified: true,
    chartTitle: "測試圖表",
    periodStart: "2024-11",
    periodEnd: "2026-10",
    ...overrides,
  };
}

/** Build a consistent snapshot document, then let a test break one field. */
function syntheticDoc({ estates, rowsByEstate, chartTranscription = [] }) {
  // Copy the inputs: a test that mutates its document must not leak into the
  // next fixture through a shared array.
  const estatesCopy = estates.map((estate) => ({ ...estate }));
  const rowsCopy = Object.fromEntries(
    Object.entries(rowsByEstate).map(([slug, rows]) => [slug, rows.map((row) => ({ ...row }))]),
  );
  const packageBySlug = new Map(estatesCopy.map((estate) => [estate.slug, estate.sourcePackage]));
  let estates61Rows = 0;
  let mountRows = 0;
  const allRows = [];
  for (const [slug, rows] of Object.entries(rowsCopy)) {
    allRows.push(...rows);
    if (packageBySlug.get(slug) === "mount") mountRows += rows.length;
    else estates61Rows += rows.length;
  }
  const registrationThrough = allRows
    .map((row) => row.registrationDate)
    .sort()
    .at(-1);
  assert.ok(
    registrationThrough,
    "synthetic fixtures need at least one row to define registrationThrough",
  );
  return {
    schemaVersion: 1,
    generatedFrom: {
      estates61: { package: "earnest-estates-61-20261122", asOf: "2026-11-23T01:58:00+08:00" },
      mount: { package: "earnest-mount-20261122", asOf: "2026-11-22T23:38:48+08:00" },
    },
    registrationThrough,
    counts: {
      sourceRows: estates61Rows + mountRows,
      estates61Rows,
      mountRows,
      estates: estatesCopy.length,
      estatesWithRows: estatesCopy.filter((estate) => estate.rowCount > 0).length,
      filteredEmpty: estatesCopy.filter((estate) => estate.status === "filtered-empty").length,
      chartMonths: chartTranscription.length,
      chartEstates: new Set(chartTranscription.map((month) => month.slug)).size,
    },
    estates: estatesCopy,
    rowsByEstate: rowsCopy,
    chartTranscription: chartTranscription.map((month) => ({ ...month })),
  };
}

/** One covered estate with `count` synthetic rows, all distinct refs. */
function docWithRows(count, overrides = () => ({})) {
  const rows = Array.from({ length: count }, (_, index) => {
    const day = String((index % 28) + 1).padStart(2, "0");
    return syntheticRow({
      ref: `T${String(index + 1).padStart(7, "0")}`,
      registrationDate: `2026-09-${day}`,
      instrumentDate: `2026-08-${day}`,
      considerationMillion: 5 + index,
      address: `測試屋苑 第${String(index + 1).padStart(2, "0")}座 5樓 A室`,
      ...overrides(index),
    });
  });
  return syntheticDoc({
    estates: [syntheticEstate(COVERED, rows)],
    rowsByEstate: { [COVERED]: rows },
  });
}

test("buildMarketSnapshot validates a consistent document and derives the pairing summary", () => {
  const rows = [syntheticRow()];
  const snapshot = market.buildMarketSnapshot(
    syntheticDoc({ estates: [syntheticEstate(COVERED, rows)], rowsByEstate: { [COVERED]: rows } }),
  );

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.registrationThrough, "2026-10-15");
  assert.equal(snapshot.counts.sourceRows, 1);
  assert.equal(snapshot.estates.length, 1);
  const summary = snapshot.estates[0];
  assert.equal(summary.slug, COVERED);
  assert.equal(summary.rowCount, 1);
  assert.equal(summary.pairedRowCount, 0);
  assert.equal(summary.dedupedDealCount, 1);
  assert.equal(summary.mixedSameUnitCount, 0);
  assert.equal(summary.status, "covered");
});

test("buildMarketSnapshot throws on schema drift instead of coercing", () => {
  const rows = [syntheticRow()];
  const make = (mutate) => {
    const doc = syntheticDoc({
      estates: [syntheticEstate(COVERED, rows)],
      rowsByEstate: { [COVERED]: rows },
    });
    mutate(doc);
    return doc;
  };

  assert.throws(
    () => market.buildMarketSnapshot(make((doc) => (doc.schemaVersion = 2))),
    /schemaVersion/,
  );
  assert.throws(
    () => market.buildMarketSnapshot(make((doc) => (doc.schemaVersion = "1"))),
    /schemaVersion/,
  );
  assert.throws(
    () =>
      market.buildMarketSnapshot(make((doc) => (doc.estates[0].slug = "not-a-registry-estate"))),
    /estate-registry\.ts/,
  );
  assert.throws(
    () =>
      market.buildMarketSnapshot(
        make((doc) => {
          doc.rowsByEstate["another-estate"] = [];
        }),
      ),
    /no matching entry/,
  );
  assert.throws(
    () => market.buildMarketSnapshot(make((doc) => (doc.counts.sourceRows = 99))),
    /counts\.sourceRows/,
  );
  assert.throws(
    () => market.buildMarketSnapshot(make((doc) => (doc.estates[0].rowCount = 2))),
    /rowCount is 2/,
  );
  // Row identity is sourcePackage + yearFilter + ref: the same ref twice in the
  // same package is a collision even when it sits under two estates.
  assert.throws(
    () =>
      market.buildMarketSnapshot(
        syntheticDoc({
          estates: [syntheticEstate(COVERED, rows), syntheticEstate("napa", rows)],
          rowsByEstate: { [COVERED]: rows, napa: rows },
        }),
      ),
    /row identity collision/,
  );
  assert.throws(
    () =>
      market.buildMarketSnapshot(make((doc) => (doc.rowsByEstate[COVERED][0].yearFilter = 2027))),
    /yearFilter/,
  );
  assert.throws(
    () =>
      market.buildMarketSnapshot(make((doc) => (doc.rowsByEstate[COVERED][0].pricePerSqft = 0))),
    /pricePerSqft/,
  );
  assert.throws(
    () =>
      market.buildMarketSnapshot(
        make((doc) => (doc.rowsByEstate[COVERED][0].psfBasis = "建築面積")),
      ),
    /psfBasis/,
  );
  assert.throws(
    () => market.buildMarketSnapshot(make((doc) => (doc.estates[0].status = "empty"))),
    /status/,
  );
  // A filtered-empty estate without its honest note is drift.
  assert.throws(
    () =>
      market.buildMarketSnapshot(
        syntheticDoc({
          estates: [syntheticEstate(COVERED, rows), syntheticEstate(EMPTY, [], { note: null })],
          rowsByEstate: { [COVERED]: rows },
        }),
      ),
    /note/,
  );
});

test("registration and instrument dates are validated as two separate ISO fields", () => {
  const rows = [syntheticRow({ registrationDate: "2026-10-15", instrumentDate: "2002-06-28" })];
  const snapshot = market.buildMarketSnapshot(
    syntheticDoc({ estates: [syntheticEstate(COVERED, rows)], rowsByEstate: { [COVERED]: rows } }),
  );
  const row = market.getEstateMarketTransactions(snapshot, COVERED).rows[0];
  // An instrument date outside the 2021–2026 list filter is kept, never dropped.
  assert.equal(row.registrationDate, "2026-10-15");
  assert.equal(row.instrumentDate, "2002-06-28");
  assert.notEqual(row.registrationDate, row.instrumentDate);

  const docWith = (badRow) => {
    const doc = syntheticDoc({
      estates: [syntheticEstate(COVERED, [badRow])],
      rowsByEstate: { [COVERED]: [badRow] },
    });
    // Pin the derived top-level fields so the row-level date validation is what
    // throws, not the summary date derived from the bad row.
    doc.registrationThrough = "2026-01-01";
    doc.estates[0].registrationThrough = "2026-01-01";
    return doc;
  };

  for (const bad of ["2026-13-01", "2026-02-30", "15/10/2026", "2026-1-5"]) {
    assert.throws(
      () => market.buildMarketSnapshot(docWith(syntheticRow({ registrationDate: bad }))),
      /registrationDate/,
      `registrationDate ${JSON.stringify(bad)} must be rejected`,
    );
  }
  const blankDate = docWith(syntheticRow());
  blankDate.rowsByEstate[COVERED][0].registrationDate = "";
  assert.throws(() => market.buildMarketSnapshot(blankDate), /registrationDate/);
  assert.throws(
    () => market.buildMarketSnapshot(docWith(syntheticRow({ instrumentDate: "2026-02-30" }))),
    /instrumentDate/,
  );
});

test("a filtered-empty estate returns an honest empty result, not an error and not a zero chart", () => {
  const coveredRows = [syntheticRow()];
  const doc = syntheticDoc({
    estates: [syntheticEstate(COVERED, coveredRows), syntheticEstate(EMPTY, [])],
    rowsByEstate: { [COVERED]: coveredRows },
    chartTranscription: [],
  });
  const snapshot = market.buildMarketSnapshot(doc);

  const empty = market.getEstateMarketTransactions(snapshot, EMPTY);
  assert.ok(empty, "a filtered-empty estate is a known estate, not an unknown slug");
  assert.equal(empty.estate.status, "filtered-empty");
  assert.equal(typeof empty.estate.note, "string");
  assert.ok(empty.estate.note.length > 0);
  assert.equal(empty.estate.registrationThrough, null);
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.total, 0);
  assert.equal(empty.page, 1);
  assert.equal(empty.pageCount, 1, "pageCount is at least 1 even with no rows");
  assert.deepEqual(empty.facets, { years: [], natures: [], phases: [] });
  // No synthesised zero-volume chart: an empty transcription is an empty list.
  assert.deepEqual(market.getEstateChartTranscription(snapshot, EMPTY), []);

  assert.equal(market.getEstateMarketTransactions(snapshot, "unknown-slug"), null);
});

test("year, nature and phase filters paginate source rows and keep facets unfiltered", () => {
  const rows = [
    syntheticRow({
      ref: "T0000001",
      yearFilter: 2025,
      registrationDate: "2025-03-01",
      nature: "買賣合約",
      phase: "滿庭",
      address: "測試屋苑 第01座 5樓 A室",
    }),
    syntheticRow({
      ref: "T0000002",
      yearFilter: 2026,
      registrationDate: "2026-04-02",
      nature: "臨時合約",
      phase: "滿庭",
      address: "測試屋苑 第02座 6樓 B室",
    }),
    syntheticRow({
      ref: "T0000003",
      yearFilter: 2026,
      registrationDate: "2026-05-03",
      nature: "買賣合約",
      phase: "名庭",
      address: "測試屋苑 第03座 7樓 C室",
    }),
  ];
  const snapshot = market.buildMarketSnapshot(
    syntheticDoc({ estates: [syntheticEstate(COVERED, rows)], rowsByEstate: { [COVERED]: rows } }),
  );

  const all = market.getEstateMarketTransactions(snapshot, COVERED);
  assert.equal(all.total, 3);
  assert.deepEqual(all.facets.years, [
    { value: 2025, count: 1 },
    { value: 2026, count: 2 },
  ]);
  assert.deepEqual(all.facets.natures, [
    { value: "買賣合約", count: 2 },
    { value: "臨時合約", count: 1 },
  ]);
  assert.deepEqual(all.facets.phases, [
    { value: "滿庭", count: 2 },
    { value: "名庭", count: 1 },
  ]);
  assert.deepEqual(all.activeFilters, { year: null, nature: null, phase: null, page: 1 });

  const byYear = market.getEstateMarketTransactions(snapshot, COVERED, { year: 2026 });
  assert.equal(byYear.total, 2);
  assert.equal(byYear.facets.years.length, 2, "facets stay the unfiltered counts");
  assert.deepEqual(
    byYear.rows.map((row) => row.ref),
    ["T0000003", "T0000002"],
    "rows stay ordered registrationDate descending",
  );

  const byNature = market.getEstateMarketTransactions(snapshot, COVERED, { nature: "臨時合約" });
  assert.deepEqual(
    byNature.rows.map((row) => row.ref),
    ["T0000002"],
  );
  assert.equal(byNature.total, 1);

  const byPhase = market.getEstateMarketTransactions(snapshot, COVERED, { phase: "名庭" });
  assert.deepEqual(
    byPhase.rows.map((row) => row.ref),
    ["T0000003"],
  );

  const combined = market.getEstateMarketTransactions(snapshot, COVERED, {
    year: 2026,
    nature: "買賣合約",
    phase: "名庭",
  });
  assert.equal(combined.total, 1);

  const unmatched = market.getEstateMarketTransactions(snapshot, COVERED, { year: 2019 });
  assert.equal(unmatched.total, 0);
  assert.equal(unmatched.page, 1);
  assert.equal(unmatched.pageCount, 1);
  assert.equal(
    unmatched.facets.years.length,
    2,
    "an impossible filter still reports the real facets",
  );
});

test("pagination clamps to 1..pageCount with a page size of 20", () => {
  assert.equal(market.MARKET_PAGE_SIZE, 20);
  const snapshot = market.buildMarketSnapshot(docWithRows(45));

  const first = market.getEstateMarketTransactions(snapshot, COVERED);
  assert.equal(first.total, 45);
  assert.equal(first.page, 1);
  assert.equal(first.pageCount, 3);
  assert.equal(first.rows.length, 20);

  const last = market.getEstateMarketTransactions(snapshot, COVERED, { page: 3 });
  assert.equal(last.rows.length, 5);
  assert.equal(last.page, 3);

  const overlapping = new Set(first.rows.map((row) => row.ref));
  assert.equal(
    last.rows.some((row) => overlapping.has(row.ref)),
    false,
    "pages never repeat a row",
  );

  assert.equal(market.getEstateMarketTransactions(snapshot, COVERED, { page: 0 }).page, 1);
  assert.equal(market.getEstateMarketTransactions(snapshot, COVERED, { page: -3 }).page, 1);
  assert.equal(market.getEstateMarketTransactions(snapshot, COVERED, { page: 999 }).page, 3);
  assert.equal(market.getEstateMarketTransactions(snapshot, COVERED, { page: 2.7 }).page, 2);
  assert.equal(market.getEstateMarketTransactions(snapshot, COVERED, { page: Number.NaN }).page, 1);
  assert.equal(
    market.getEstateMarketTransactions(snapshot, COVERED, { year: 2019, page: 7 }).page,
    1,
  );
});

test("blank gross area and 呎價 stay null and the module never averages an estate 實用呎價", () => {
  const rows = [
    syntheticRow({ ref: "T0000001", grossAreaSqft: null, pricePerSqft: null, psfBasis: null }),
    syntheticRow({ ref: "T0000002", address: "測試屋苑 第02座 9樓 B室", grossAreaSqft: 700 }),
  ];
  const snapshot = market.buildMarketSnapshot(
    syntheticDoc({ estates: [syntheticEstate(COVERED, rows)], rowsByEstate: { [COVERED]: rows } }),
  );
  const page = market.getEstateMarketTransactions(snapshot, COVERED);

  const blank = page.rows.find((row) => row.ref === "T0000001");
  assert.equal(blank.grossAreaSqft, null, "a blank gross area stays null, never 0");
  assert.equal(blank.pricePerSqft, null, "a blank published 呎價 stays null, never 0");
  assert.equal(blank.psfBasis, null, "no basis label is invented");

  // The estate 實用呎價 average is not a thing this module can produce: the rows
  // only carry the published per-row label, and no averaging export exists.
  assert.deepEqual(
    Object.keys(market).filter((name) => /avg|average|psf/i.test(name)),
    [],
    "the module must expose no estate 呎價 average helper",
  );
  assert.deepEqual(market.getEstateChartTranscription(snapshot, COVERED), []);
  for (const row of page.rows) {
    if (row.grossAreaSqft === null) assert.equal(row.pricePerSqft, null);
  }
});

test("a zero-volume chart month keeps its printed label but stores avgPsf null", () => {
  const rows = [syntheticRow()];
  const chart = [
    syntheticChartMonth({ month: "2025-07", count: 0, avgPsf: null, sourceDisplayedPpsf: "10560" }),
    syntheticChartMonth({
      month: "2025-08",
      count: 4,
      avgPsf: 11000,
      sourceDisplayedPpsf: "11000",
    }),
  ];
  const snapshot = market.buildMarketSnapshot(
    syntheticDoc({
      estates: [syntheticEstate(COVERED, rows)],
      rowsByEstate: { [COVERED]: rows },
      chartTranscription: chart,
    }),
  );
  const months = market.getEstateChartTranscription(snapshot, COVERED);
  assert.deepEqual(
    months.map((month) => month.month),
    ["2025-07", "2025-08"],
    "chart months are ordered by month",
  );
  const zero = months[0];
  assert.equal(zero.count, 0);
  assert.equal(zero.avgPsf, null);
  assert.equal(zero.sourceDisplayedPpsf, "10560", "the printed label is kept verbatim");
  assert.equal(zero.visualVerified, true);
  assert.equal(months[1].avgPsf, 11000);

  const inconsistent = [syntheticChartMonth({ count: 0, avgPsf: 12000 })];
  assert.throws(
    () =>
      market.buildMarketSnapshot(
        syntheticDoc({
          estates: [syntheticEstate(COVERED, rows)],
          rowsByEstate: { [COVERED]: rows },
          chartTranscription: inconsistent,
        }),
      ),
    /avgPsf/,
  );
  const badMonth = [syntheticChartMonth({ month: "2025-13" })];
  assert.throws(
    () =>
      market.buildMarketSnapshot(
        syntheticDoc({
          estates: [syntheticEstate(COVERED, rows)],
          rowsByEstate: { [COVERED]: rows },
          chartTranscription: badMonth,
        }),
      ),
    /month/,
  );
});

test("a same-day 臨時 + 買賣 pair counts as one deduped deal", () => {
  const rows = [
    syntheticRow({
      ref: "T0000001",
      nature: "臨時合約",
      registrationDate: "2026-10-15",
      instrumentDate: "2026-10-01",
    }),
    syntheticRow({
      ref: "T0000002",
      nature: "買賣合約",
      registrationDate: "2026-10-15",
      instrumentDate: "2026-10-09",
    }),
  ];
  const snapshot = market.buildMarketSnapshot(
    syntheticDoc({ estates: [syntheticEstate(COVERED, rows)], rowsByEstate: { [COVERED]: rows } }),
  );
  const estate = snapshot.estates[0];
  assert.equal(estate.rowCount, 2, "both source rows are kept");
  assert.equal(estate.pairedRowCount, 2);
  assert.equal(estate.dedupedDealCount, 1);
  assert.equal(estate.mixedSameUnitCount, 0);

  const page = market.getEstateMarketTransactions(snapshot, COVERED);
  assert.equal(page.total, 2, "the UI always shows raw source rows");
  assert.equal(page.estate.rowCount, 2);
  assert.equal(page.estate.dedupedDealCount, 1);
});

test("a cross-date mixed pair stays as two source rows and lands in mixedSameUnitCount", () => {
  const rows = [
    syntheticRow({
      ref: "T0000001",
      nature: "臨時合約",
      registrationDate: "2026-09-01",
      instrumentDate: "2026-08-20",
    }),
    syntheticRow({
      ref: "T0000002",
      nature: "買賣合約",
      registrationDate: "2026-10-15",
      instrumentDate: "2026-10-09",
    }),
  ];
  const snapshot = market.buildMarketSnapshot(
    syntheticDoc({ estates: [syntheticEstate(COVERED, rows)], rowsByEstate: { [COVERED]: rows } }),
  );
  const estate = snapshot.estates[0];
  assert.equal(estate.rowCount, 2);
  assert.equal(estate.pairedRowCount, 0, "different registration dates are not a pair");
  assert.equal(estate.dedupedDealCount, 2);
  assert.equal(estate.mixedSameUnitCount, 2, "the audit reports both mixed candidate rows");

  const page = market.getEstateMarketTransactions(snapshot, COVERED);
  assert.deepEqual(
    page.rows.map((row) => row.ref),
    ["T0000002", "T0000001"],
  );
});

test("a same-nature duplicate is retained untouched and reported by the audit", () => {
  const rows = [
    syntheticRow({ ref: "T0000001", nature: "買賣合約", instrumentDate: "2026-10-01" }),
    syntheticRow({ ref: "T0000002", nature: "買賣合約", instrumentDate: "2026-10-09" }),
  ];
  const snapshot = market.buildMarketSnapshot(
    syntheticDoc({ estates: [syntheticEstate(COVERED, rows)], rowsByEstate: { [COVERED]: rows } }),
  );
  const estate = snapshot.estates[0];
  assert.equal(estate.rowCount, 2);
  assert.equal(estate.pairedRowCount, 0, "two 買賣合約 rows are not a 臨時/正式 pair");
  assert.equal(estate.dedupedDealCount, 2);
  assert.equal(estate.mixedSameUnitCount, 2);
  assert.deepEqual(
    market.getEstateMarketTransactions(snapshot, COVERED).rows.map((row) => row.ref),
    ["T0000002", "T0000001"],
  );
});

test("unit identity falls back to tower + floor + unit + house when no address is recorded", () => {
  const base = {
    address: null,
    tower: "第05座",
    floor: "12",
    unit: "C",
    houseId: null,
    registrationDate: "2026-10-15",
  };
  const rows = [
    syntheticRow({ ...base, ref: "T0000001", nature: "臨時合約" }),
    syntheticRow({ ...base, ref: "T0000002", nature: "買賣合約" }),
  ];
  const snapshot = market.buildMarketSnapshot(
    syntheticDoc({ estates: [syntheticEstate(COVERED, rows)], rowsByEstate: { [COVERED]: rows } }),
  );
  assert.equal(snapshot.estates[0].pairedRowCount, 2);
  assert.equal(snapshot.estates[0].dedupedDealCount, 1);
});

test("marketTransactionUrl derives the old-site detail URL from ref and year filter", () => {
  const row = syntheticRow({ ref: "Z0650060", yearFilter: 2026 });
  assert.equal(
    market.marketTransactionUrl(row),
    "https://www.earnestproperty.com.hk/tran_prop_detail.php?ref=Z0650060&year=2026",
  );
});

test("the committed snapshot is deterministic and carries the verified coverage", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/market-transactions-62-estates-20261123.json", import.meta.url),
      "utf8",
    ),
  );
  const first = market.buildMarketSnapshot(fixture);
  const second = market.buildMarketSnapshot(fixture);
  assert.deepEqual(first, second, "two builds of the same document are deeply equal");

  assert.deepEqual(first.counts, {
    sourceRows: 8819,
    estates61Rows: 8496,
    mountRows: 323,
    estates: 62,
    estatesWithRows: 59,
    filteredEmpty: 3,
    chartMonths: 408,
    chartEstates: 17,
  });
  assert.equal(first.registrationThrough, "2026-11-19");
  assert.equal(Object.keys(first.rowsByEstate).length, 59);

  // Rows are ordered registrationDate desc, instrumentDate desc, ref asc.
  for (const rows of Object.values(first.rowsByEstate)) {
    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1];
      const current = rows[index];
      assert.ok(
        previous.registrationDate > current.registrationDate ||
          (previous.registrationDate === current.registrationDate &&
            (previous.instrumentDate > current.instrumentDate ||
              (previous.instrumentDate === current.instrumentDate && previous.ref <= current.ref))),
        `row order broken at ${current.ref}`,
      );
    }
  }

  // The three filtered-empty estates stay honest: no rows, no synthesised chart.
  for (const slug of ["chui-king-garden", "hoi-wan-toi", "kwun-hoi-villas"]) {
    const result = market.getEstateMarketTransactions(first, slug);
    assert.equal(result.estate.status, "filtered-empty");
    assert.equal(result.total, 0);
    assert.deepEqual(market.getEstateChartTranscription(first, slug), []);
  }
});

// 2026-11-24 audit, finding 2: the street-alias estates publish addresses that
// omit the tower (NAPA records 第03座 and 第05座 with the same address string),
// so matching on the published address alone merged different towers.
test("the same published address in two different towers is not a pair", () => {
  const sharedAddress = "測試路 1 號, 10樓 A室";
  const rows = [
    syntheticRow({
      ref: "T0000001",
      nature: "臨時合約",
      tower: "第03座",
      address: sharedAddress,
      registrationDate: "2026-10-15",
      instrumentDate: "2026-10-01",
      considerationMillion: 19.62,
    }),
    syntheticRow({
      ref: "T0000002",
      nature: "買賣合約",
      tower: "第05座",
      address: sharedAddress,
      registrationDate: "2026-10-15",
      instrumentDate: "2026-10-09",
      considerationMillion: 19.62,
    }),
  ];
  const snapshot = market.buildMarketSnapshot(
    syntheticDoc({ estates: [syntheticEstate(COVERED, rows)], rowsByEstate: { [COVERED]: rows } }),
  );
  const estate = snapshot.estates[0];
  assert.equal(estate.rowCount, 2, "both source rows are still kept");
  assert.equal(estate.pairedRowCount, 0, "different towers are different units");
  assert.equal(estate.dedupedDealCount, 2);
  assert.equal(estate.mixedSameUnitCount, 2);

  // Control: the same rows in the SAME tower do pair, so the tie-break above is
  // the tower and not something else in the fixture.
  const sameTower = rows.map((row) => ({ ...row, tower: "第03座" }));
  const paired = market.buildMarketSnapshot(
    syntheticDoc({
      estates: [syntheticEstate(COVERED, sameTower)],
      rowsByEstate: { [COVERED]: sameTower },
    }),
  );
  assert.equal(paired.estates[0].pairedRowCount, 2);
  assert.equal(paired.estates[0].dedupedDealCount, 1);

  // A row with no recorded tower can only be matched on what the source did
  // publish, so it still pairs with a tower row instead of being dropped.
  const noTower = [rows[0], { ...rows[1], tower: null }];
  const loose = market.buildMarketSnapshot(
    syntheticDoc({
      estates: [syntheticEstate(COVERED, noTower)],
      rowsByEstate: { [COVERED]: noTower },
    }),
  );
  assert.equal(loose.estates[0].pairedRowCount, 2);
  assert.equal(loose.estates[0].dedupedDealCount, 1);
});
