import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { estateRegistry } from "./estate-registry.ts";
import { buildEprcSnapshot, getEprcEstateTransactions } from "./eprc-transactions.ts";

const csv = readFileSync(
  new URL("./fixtures/eprc-transactions-22-estates-20261027.csv", import.meta.url),
  "utf8",
);
const [header, ...lines] = csv.trim().split(/\r?\n/);
const snapshot = buildEprcSnapshot(csv);

test("all 107 supplied rows map through registry names/aliases; list any unmapped queries", () => {
  assert.equal(lines.length, 107);
  assert.deepEqual(
    snapshot.unmappedEstateQueries,
    [],
    `Unmapped EstateQuery values: ${snapshot.unmappedEstateQueries.join(", ")}`,
  );
  assert.equal(Object.values(snapshot.byEstate).flat().length, 107);
  // This versioned export covers 22 estates, independent of later registry additions.
  assert.equal(Object.keys(snapshot.byEstate).length, 22);
  for (const slug of Object.keys(snapshot.byEstate)) {
    assert.ok(
      estateRegistry.some((estate) => estate.slug === slug && estate.hasPage),
      slug,
    );
  }
  const expected = {
    碧堤半島: 13,
    浪翠園: 6,
    海雲軒: 2,
    麗都花園: 4,
    縉皇居: 4,
    海韻花園: 2,
    海韻臺: 1,
    帝濤灣: 3,
    愛琴海岸: 4,
    滿名山: 6,
    黃金海灣: 17,
    帝御: 12,
    星堤: 4,
    上源: 14,
    "Oma Oma": 3,
    豪景花園: 12,
  };
  for (const [query, count] of Object.entries(expected)) {
    const entry = estateRegistry.find((estate) => estate.aliases.includes(query));
    assert.ok(entry, query);
    const rows = snapshot.byEstate[entry.slug];
    assert.equal(rows.length, count, query);
    assert.ok(rows.every((row) => row.estateSlug === entry.slug && row.estateQuery === query));
  }
});

test("the six estates without deals retain empty sections, with no invented rows", () => {
  const expected = ["帝華軒", "龍騰閣", "黃金海岸", "The Carmel", "漣山", "浪濤灣"];
  const emptyNames = Object.entries(snapshot.byEstate)
    .filter(([, rows]) => rows.length === 0)
    .map(([slug]) => estateRegistry.find((estate) => estate.slug === slug))
    .map((estate) => expected.find((name) => estate.aliases.includes(name)));
  assert.deepEqual(emptyNames.sort(), expected.sort());
  for (const name of expected) {
    const entry = estateRegistry.find((estate) => estate.aliases.includes(name));
    assert.deepEqual(getEprcEstateTransactions(snapshot, entry.slug), { rows: [], total: 0 });
  }
  assert.equal(getEprcEstateTransactions(snapshot, "not-a-covered-estate"), null);
  assert.equal(getEprcEstateTransactions(snapshot, "toString"), null);
  assert.ok(estateRegistry.find((estate) => estate.slug === "riviera")?.hasPage);
  assert.equal(getEprcEstateTransactions(snapshot, "riviera"), null);
});

test("registry aliases handle 帝御/黃金海岸; unknown EstateQuery is excluded and reported", () => {
  const sample = lines[0].split(",");
  const withQuery = (query) => [query, ...sample.slice(1)].join(",");
  const result = buildEprcSnapshot(
    [header, withQuery(" 帝御‧星濤 "), withQuery("GOLD COAST"), withQuery("Unknown Estate")].join(
      "\n",
    ),
  );
  const taiYu = estateRegistry.find((estate) => estate.aliases.includes("帝御"));
  const goldCoast = estateRegistry.find((estate) => estate.aliases.includes("黃金海岸"));
  assert.equal(result.byEstate[taiYu.slug].length, 1);
  assert.equal(result.byEstate[goldCoast.slug].length, 1);
  assert.deepEqual(result.unmappedEstateQueries, ["Unknown Estate"]);
  assert.equal(Object.values(result.byEstate).flat().length, 2);
});

test("DD/MM/YYYY dates sort by instrument date and the page caps at eight rows", () => {
  const bellagio = getEprcEstateTransactions(snapshot, "bellagio");
  assert.equal(bellagio.total, 13);
  assert.equal(bellagio.rows.length, 8);
  assert.deepEqual(
    bellagio.rows.map((row) => row.instrumentDate),
    [
      "2026-10-09",
      "2026-10-07",
      "2026-09-30",
      "2026-09-29",
      "2026-09-28",
      "2026-09-24",
      "2026-09-21",
      "2026-09-21",
    ],
  );
  assert.equal(bellagio.rows[0].deliveryDate, "2026-10-16");
  assert.equal(bellagio.rows[0].priceMillions, 6.68);
  assert.equal(bellagio.rows[0].grossArea, 670);
  assert.equal(bellagio.rows[0].saleableArea, 527);
  assert.equal(bellagio.rows[0].grossPsf, 9970);
  assert.equal(bellagio.rows[0].saleablePsf, 12676);
});

test("blanks remain null, leading-zero floors survive, and ASP/P-ASP are separate records", () => {
  const oma = getEprcEstateTransactions(snapshot, "oma-oma");
  assert.equal(oma.rows[0].floor, "01");
  assert.equal(oma.rows[0].grossArea, null);
  assert.equal(oma.rows[0].grossPsf, null);
  assert.equal(oma.rows[0].efficiencyRatio, null);
  assert.deepEqual(
    oma.rows.map((row) => row.nature),
    ["ASP", "ASP", "P-ASP"],
  );
  const blank = lines[0]
    .split(",")
    .map((value, index) => ([0, 1, 2, 3, 12].includes(index) ? value : "-"));
  const row = buildEprcSnapshot(`${header}\n${blank.join(",")}`).byEstate.bellagio[0];
  for (const key of [
    "floor",
    "unit",
    "grossArea",
    "saleableArea",
    "priceMillions",
    "grossPsf",
    "saleablePsf",
    "deliveryDate",
  ]) {
    assert.equal(row[key], null, key);
  }
});

test("malformed snapshot columns, dates and numbers fail instead of publishing corrupt records", () => {
  assert.throws(() => buildEprcSnapshot("Wrong,Header\n"), /header/i);
  assert.throws(() => buildEprcSnapshot(`${header}\nmissing,columns`), /column/i);
  assert.throws(() => buildEprcSnapshot(csv.replace("09/10/2026", "31/02/2026")), /date/i);
  assert.throws(() => buildEprcSnapshot(csv.replace("6.680", "invalid")), /number/i);
});
