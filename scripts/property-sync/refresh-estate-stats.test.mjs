import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ESTATE_STAT_FIELDS,
  buildEstateStatsProposals,
  computeEstateAggregates,
  runEstateStatsRefresh,
} from "./refresh-estate-stats.mjs";

function inventoryRow(overrides = {}) {
  return {
    id: "property-1",
    estate_id: "estate-1",
    estate_slug: "lido-garden",
    deal_type: "sale",
    saleable_area: 500,
    price: 6_000_000,
    rent: null,
    year_completed: 1983,
    source_payload: { buildingZh: "麗都花園 第03座" },
    ...overrides,
  };
}

test("computeEstateAggregates computes area range, blocks, mode year, listing counts", () => {
  const aggregates = computeEstateAggregates([
    inventoryRow({ id: "property-1", saleable_area: 500, price: 6_000_000 }),
    inventoryRow({ id: "property-2", saleable_area: 400, price: 5_000_000 }),
    inventoryRow({ id: "property-3", saleable_area: 700, price: 7_000_000, year_completed: 1984 }),
    inventoryRow({ id: "property-1", deal_type: "rent", rent: 22_000, year_completed: 1983 }),
  ]);

  assert.deepEqual([...aggregates.keys()], ["lido-garden"]);
  assert.deepEqual(aggregates.get("lido-garden"), {
    area_min: 400,
    area_max: 700,
    blocks: 1,
    year_completed: 1983,
    avg_saleable_psf: 12_000,
    active_listings: 3,
    sale_listings: 3,
    rent_listings: 1,
  });
});

test("computeEstateAggregates averages the two middle sale psf values for an even count", () => {
  const aggregates = computeEstateAggregates([
    inventoryRow({ id: "a", saleable_area: 500, price: 6_000_000 }), // 12,000/呎
    inventoryRow({ id: "b", saleable_area: 400, price: 5_200_000 }), // 13,000/呎
  ]);
  assert.equal(aggregates.get("lido-garden").avg_saleable_psf, 12_500);
});

test("computeEstateAggregates rounds the psf median to one decimal", () => {
  const aggregates = computeEstateAggregates([
    inventoryRow({ id: "a", saleable_area: 300, price: 1_000_000 }), // 3,333.33
    inventoryRow({ id: "b", saleable_area: 700, price: 1_000_000 }), // 1,428.57
    inventoryRow({ id: "c", saleable_area: 500, price: 1_000_000 }), // 2,000
  ]);
  assert.equal(aggregates.get("lido-garden").avg_saleable_psf, 2000);
});

test("computeEstateAggregates breaks a year-mode tie with the earlier year", () => {
  const aggregates = computeEstateAggregates([
    inventoryRow({ year_completed: 1990 }),
    inventoryRow({ id: "b", year_completed: 1983 }),
  ]);
  assert.equal(aggregates.get("lido-garden").year_completed, 1983);
});

test("computeEstateAggregates ignores nulls and rent rows for psf and area", () => {
  const aggregates = computeEstateAggregates([
    inventoryRow({ saleable_area: null, price: 6_000_000 }),
    inventoryRow({ id: "b", saleable_area: 480, price: null }),
    inventoryRow({ id: "c", deal_type: "rent", saleable_area: 520, price: null, rent: 20_000 }),
    inventoryRow({ id: "d", saleable_area: 0, price: 0 }),
  ]);
  const aggregate = aggregates.get("lido-garden");
  assert.equal(aggregate.area_min, 480);
  assert.equal(aggregate.area_max, 520);
  // Only the 480呎 row has both a sale price and an area.
  assert.equal(aggregate.avg_saleable_psf, null);
  assert.equal(aggregate.sale_listings, 3);
  assert.equal(aggregate.rent_listings, 1);
});

test("computeEstateAggregates takes the year from source_payload.yearCompleted", () => {
  const aggregates = computeEstateAggregates([
    inventoryRow({
      year_completed: null,
      source_payload: { buildingZh: "麗都花園 第03座", yearCompleted: 1982 },
    }),
  ]);
  assert.equal(aggregates.get("lido-garden").year_completed, 1982);
});

test("computeEstateAggregates reads the raw table label when buildingZh is absent", () => {
  const aggregates = computeEstateAggregates([
    inventoryRow({
      id: "a",
      source_payload: { rawFields: { "大廈 (中)": "麗都花園 第03座" } },
    }),
    inventoryRow({ id: "b", source_payload: { rawFields: { "大廈 (中)": "碧堤半島 第01座" } } }),
    inventoryRow({ id: "c", source_payload: null }),
  ]);
  assert.equal(aggregates.get("lido-garden").blocks, 2);
});

test("computeEstateAggregates ignores rows without an estate slug", () => {
  const aggregates = computeEstateAggregates([
    inventoryRow({ estate_slug: null }),
    inventoryRow({ estate_slug: "  " }),
    inventoryRow({ estate_slug: "sea-crest-villa" }),
  ]);
  assert.deepEqual([...aggregates.keys()], ["sea-crest-villa"]);
});

test("buildEstateStatsProposals fills only the NULL columns", () => {
  const aggregates = new Map([
    [
      "lido-garden",
      {
        area_min: 400,
        area_max: 700,
        blocks: 3,
        year_completed: 1983,
        avg_saleable_psf: 12_000,
        active_listings: 4,
        sale_listings: 3,
        rent_listings: 1,
      },
    ],
  ]);
  const estateRows = [
    {
      id: "estate-1",
      slug: "lido-garden",
      area_min: 469,
      area_max: null,
      blocks: null,
      year_completed: 1982,
      avg_saleable_psf: null,
    },
  ];

  const result = buildEstateStatsProposals(aggregates, estateRows);
  assert.equal(result.updated, 1);
  assert.equal(result.skippedExisting, 0);
  assert.deepEqual(result.proposals[0].filled, {
    area_max: 700,
    blocks: 3,
    avg_saleable_psf: 12_000,
  });
  assert.deepEqual(result.proposals[0].existing, {
    area_min: 469,
    area_max: null,
    blocks: null,
    year_completed: 1982,
    avg_saleable_psf: null,
  });
  // The curated values in `existing` are never part of the fill list.
  assert.equal(result.proposals[0].filled.area_min, undefined);
  assert.equal(result.proposals[0].filled.year_completed, undefined);
});

test("buildEstateStatsProposals counts an already-complete estate as skipped", () => {
  const aggregates = new Map([
    [
      "lido-garden",
      {
        area_min: 400,
        area_max: 700,
        blocks: 3,
        year_completed: 1983,
        avg_saleable_psf: 12_000,
        active_listings: 4,
        sale_listings: 3,
        rent_listings: 1,
      },
    ],
  ]);
  const estateRows = [
    {
      id: "estate-1",
      slug: "lido-garden",
      area_min: 469,
      area_max: 1427,
      blocks: 2,
      year_completed: 1982,
      avg_saleable_psf: 11_000,
    },
  ];
  const result = buildEstateStatsProposals(aggregates, estateRows);
  assert.deepEqual(result.proposals, []);
  assert.equal(result.updated, 0);
  assert.equal(result.skippedExisting, 1);
});

test("buildEstateStatsProposals ignores aggregates whose estate row is missing", () => {
  const aggregates = computeEstateAggregates([inventoryRow({ estate_slug: "unknown-estate" })]);
  const result = buildEstateStatsProposals(aggregates, [
    { id: "estate-1", slug: "lido-garden", area_min: null },
  ]);
  assert.deepEqual(result.proposals, []);
  assert.equal(result.updated, 0);
});

test("buildEstateStatsProposals skips estates with no computable fact at all", () => {
  const aggregates = computeEstateAggregates([
    inventoryRow({ saleable_area: null, price: null, year_completed: null, source_payload: null }),
  ]);
  const result = buildEstateStatsProposals(aggregates, [
    {
      id: "estate-1",
      slug: "lido-garden",
      area_min: null,
      area_max: null,
      blocks: null,
      year_completed: null,
      avg_saleable_psf: null,
    },
  ]);
  assert.deepEqual(result.proposals, []);
  assert.equal(result.skippedExisting, 0);
});

test("ESTATE_STAT_FIELDS stays the fill-NULL-only column set", () => {
  assert.deepEqual(ESTATE_STAT_FIELDS, [
    "area_min",
    "area_max",
    "blocks",
    "year_completed",
    "avg_saleable_psf",
  ]);
});

function createFakeSql({ propertiesRows = [], estateRows = [] } = {}) {
  const queries = [];
  const updates = [];
  const sql = async (strings, ...values) => {
    const text = String.raw(strings, ...values.map((_, index) => `$${index + 1}`));
    queries.push({ text, values });
    if (/UPDATE estates/.test(text)) {
      updates.push({ text, values });
      return [];
    }
    if (/FROM properties/.test(text)) return propertiesRows;
    if (/FROM estates/.test(text)) return estateRows;
    return [];
  };
  return { sql, queries, updates };
}

test("runEstateStatsRefresh dry-run only SELECTs and reports the proposal", async () => {
  const propertiesRows = [
    inventoryRow({ id: "property-1", estate_id: "estate-1" }),
    inventoryRow({ id: "property-2", saleable_area: 400, price: 5_000_000 }),
  ];
  const estateRows = [
    {
      id: "estate-1",
      slug: "lido-garden",
      area_min: null,
      area_max: null,
      blocks: null,
      year_completed: null,
      avg_saleable_psf: null,
    },
  ];
  const { sql, updates } = createFakeSql({ propertiesRows, estateRows });

  const report = await runEstateStatsRefresh({ sql, dryRun: true });

  assert.equal(updates.length, 0);
  assert.equal(report.dryRun, true);
  assert.equal(report.estatesConsidered, 1);
  assert.equal(report.updated, 1);
  assert.equal(report.skippedExisting, 0);
  assert.equal(report.proposals.length, 1);
  assert.equal(report.proposals[0].slug, "lido-garden");
  assert.equal(report.proposals[0].filled.area_min, 400);
  assert.equal(report.proposals[0].filled.area_max, 500);
});

test("runEstateStatsRefresh --apply issues one NULL-only COALESCE update per estate", async () => {
  const propertiesRows = [inventoryRow({ id: "property-1" })];
  const estateRows = [
    {
      id: "estate-1",
      slug: "lido-garden",
      area_min: 469,
      area_max: null,
      blocks: null,
      year_completed: 1982,
      avg_saleable_psf: null,
    },
  ];
  const { sql, updates } = createFakeSql({ propertiesRows, estateRows });

  const report = await runEstateStatsRefresh({ sql, dryRun: false });

  assert.equal(updates.length, 1);
  assert.match(updates[0].text, /area_min = COALESCE\(area_min, \$1\)/);
  assert.match(updates[0].text, /avg_saleable_psf = COALESCE\(avg_saleable_psf, \$5\)/);
  assert.equal(report.dryRun, false);
  assert.equal(report.updated, 1);
  assert.equal(report.proposals.length, 1);
});

test("runEstateStatsRefresh requires an injected sql function", async () => {
  await assert.rejects(() => runEstateStatsRefresh({}), /tagged-template function/);
});
