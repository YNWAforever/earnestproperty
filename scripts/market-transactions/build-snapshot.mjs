#!/usr/bin/env node
/**
 * Deterministic offline generator for the market-registration snapshot.
 *
 * Spec: docs/market-transactions/data-contract.md (schemaVersion 1).
 *
 * The two source packages are *inputs*, never committed. Only the derived
 * snapshot under src/content/fixtures/ is committed. Same archives in => same
 * bytes out: no Date.now(), no randomness, no directory enumeration, fixed row
 * ordering, fixed key order, JSON.stringify(doc, null, 2) + trailing newline.
 *
 * Usage:
 *   node scripts/market-transactions/build-snapshot.mjs \
 *     --estates61 <dir with roster.csv, parsed/ and combined/> \
 *     --mount <dir with parsed/transactions.csv> \
 *     [--out src/content/fixtures/market-transactions-62-estates-20261123.json] \
 *     [--dry-run] [--check] [--print-summary]
 *
 *   --dry-run          print counts + the mapping report, write nothing
 *   --check            regenerate in memory, byte-compare with the committed
 *                      file, exit 1 on any difference
 *   --print-summary    print counts + the mapping report when writing
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEFAULT_OUT = "src/content/fixtures/market-transactions-62-estates-20261123.json";

/* ------------------------------------------------------------------ *
 * Package provenance
 *
 * These stamps are the package finalisation times documented in the handoff
 * brief (DEEPSEEK_INSTRUCTIONS.md §4.1, §4.2). They are constants on purpose:
 * the generated file must be byte-identical on every run and the 61 package
 * does not carry its finalisation time machine-readably. `assertPackageStamps`
 * re-checks them against the archives so a swapped archive fails loudly
 * instead of silently relabelling the source.
 * ------------------------------------------------------------------ */
const SOURCES = {
  "estates-61": {
    package: "earnest-estates-61-20261122",
    /** generatedFrom.estates61.asOf — finalised data zip time. */
    generatedAsOf: "2026-11-23T01:58:00+08:00",
    /** estates[].asOf — street-alias reprocess / scrape completion stamp. */
    estateAsOf: "2026-11-23T01:51:39+08:00",
  },
  mount: {
    package: "earnest-mount-20261122",
    /** Mount package generated_at; corroborated by parsed/metadata.json. */
    generatedAsOf: "2026-11-22T23:38:48+08:00",
    estateAsOf: "2026-11-22T23:38:48+08:00",
  },
};

/** The Mount package has no estate_slug column: its rows are this one estate. */
const MOUNT_SLUG = "mun-ming-shan";
/** Every Mount row must carry this canonical_key prefix. */
const MOUNT_CANONICAL_PREFIX = "mun-ming-shan/";
/** Mount rows carry one list URL per year page (18 of them), not one estate filter URL. */
const MOUNT_LIST_SOURCE_URL = null;

const FILTERED_EMPTY_NOTE = "舊網站 2021–2026 公開成交列表搜尋結果為空，不代表此屋苑沒有成交。";

const YEAR_FILTER_MIN = 2021;
const YEAR_FILTER_MAX = 2026;
const CHART_SERIES = "image_transcribed";
const CHART_METHOD = "chart_label_transcription_visual_verified";

/**
 * Verified totals from the handoff brief (§4) and the data contract. This is an
 * oracle, not a convenience default: a difference means rows were dropped,
 * mis-mapped or double-counted. Report the delta and review the archives before
 * changing a number here.
 */
const VERIFIED = {
  counts: {
    sourceRows: 8819,
    estates61Rows: 8496,
    mountRows: 323,
    estates: 62,
    estatesWithRows: 59,
    filteredEmpty: 3,
    chartMonths: 408,
    chartEstates: 17,
  },
  registrationThrough: "2026-11-19",
  filteredEmptySlugs: ["chui-king-garden", "hoi-wan-toi", "kwun-hoi-villas"],
  /** brief §4.1 — 61-package source rows per public-list year filter. */
  estates61YearCounts: { 2021: 2235, 2022: 992, 2023: 1159, 2024: 1258, 2025: 1594, 2026: 1258 },
  /** brief §4.2 — Mount source rows per year filter. */
  mountYearCounts: { 2021: 92, 2022: 41, 2023: 38, 2024: 40, 2025: 57, 2026: 55 },
  /** brief §4.1 — instrument natures in the 61 package. */
  estates61NatureCounts: { 買賣合約: 7765, 臨時合約: 730, 確認合約: 1 },
  /** brief §4.1 / §4.2 — missing gross area and 呎價 must stay null, never 0. */
  nullCounts: {
    estates61NullGrossArea: 4397,
    estates61NullPricePerSqft: 4400,
    mountNullGrossArea: 322,
    mountNullPricePerSqft: 322,
  },
  /** brief §4.2 — Mount documents 14 same-registration-day 臨時/買賣 pairs. */
  mountPairs: 14,
  /** parsed/estates.json covers the 61 scraped estates (all but 滿名山). */
  estatesJsonEntries: 61,
};

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */
const options = {
  estates61: null,
  mount: null,
  out: DEFAULT_OUT,
  dryRun: false,
  check: false,
  printSummary: false,
};

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  const takeValue = () => {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) usage(`missing value for ${arg}`);
    i += 1;
    return value;
  };
  if (arg === "--estates61") options.estates61 = takeValue();
  else if (arg === "--mount") options.mount = takeValue();
  else if (arg === "--out") options.out = takeValue();
  else if (arg === "--dry-run") options.dryRun = true;
  else if (arg === "--check") options.check = true;
  else if (arg === "--print-summary") options.printSummary = true;
  else usage(`unknown argument ${arg}`);
}
if (!options.estates61 || !options.mount) usage("both --estates61 and --mount are required");

function usage(message) {
  console.error(`build-snapshot: ${message}`);
  console.error(
    "usage: node scripts/market-transactions/build-snapshot.mjs --estates61 <dir> --mount <dir> " +
      "[--out <path>] [--dry-run] [--check] [--print-summary]",
  );
  process.exit(2);
}

/* ------------------------------------------------------------------ *
 * CSV reading (RFC 4180 subset: quoted fields, doubled quotes, CRLF, BOM)
 * ------------------------------------------------------------------ */
function parseCsv(text, file) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
  if (nonEmpty.length === 0) throw new Error(`${file}: empty CSV`);
  const header = nonEmpty[0].map((cell, index) =>
    index === 0 ? cell.replace(/^\uFEFF/, "") : cell,
  );
  const records = nonEmpty.slice(1).map((cells, index) => {
    if (cells.length !== header.length) {
      throw new Error(
        `${file}: row ${index + 2} has ${cells.length} columns, header has ${header.length}`,
      );
    }
    const record = Object.create(null);
    header.forEach((column, columnIndex) => {
      record[column] = cells[columnIndex];
    });
    return record;
  });
  return { header, records };
}

function readCsvFile(path, requiredColumns) {
  const { header, records } = parseCsv(readFileSync(path, "utf8"), path);
  const missing = requiredColumns.filter((column) => !header.includes(column));
  if (missing.length > 0) throw new Error(`${path}: missing columns ${missing.join(", ")}`);
  return records;
}

/* ------------------------------------------------------------------ *
 * Value readers — parse strictly, never coerce silently
 * ------------------------------------------------------------------ */
function text(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function digits(value) {
  return String(value).replace(/,/g, "");
}

function numberValue(value, context) {
  const raw = text(value);
  if (raw === null) return null;
  const cleaned = digits(raw);
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) {
    throw new Error(`${context}: not a number: ${JSON.stringify(value)}`);
  }
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) throw new Error(`${context}: not finite: ${JSON.stringify(value)}`);
  return parsed;
}

function isoDate(value, context) {
  const raw = text(value);
  if (raw === null) throw new Error(`${context}: required date is blank`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`${context}: not an ISO date: ${JSON.stringify(raw)}`);
  }
  const date = new Date(`${raw}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    throw new Error(`${context}: not a real calendar date: ${JSON.stringify(raw)}`);
  }
  return raw;
}

function yearMonth(value, context) {
  const raw = text(value);
  if (raw === null) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(raw);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    throw new Error(`${context}: not a YYYY-MM month: ${JSON.stringify(raw)}`);
  }
  return raw;
}

function booleanValue(value, context) {
  const raw = text(value);
  if (raw === "True" || raw === "true") return true;
  if (raw === "False" || raw === "false") return false;
  throw new Error(`${context}: not a boolean: ${JSON.stringify(raw)}`);
}

function yearFilterValue(value, context) {
  const year = numberValue(value, context);
  if (
    year === null ||
    !Number.isInteger(year) ||
    year < YEAR_FILTER_MIN ||
    year > YEAR_FILTER_MAX
  ) {
    throw new Error(
      `${context}: year filter ${JSON.stringify(value)} outside ${YEAR_FILTER_MIN}-${YEAR_FILTER_MAX}`,
    );
  }
  return year;
}

function completionYearValue(value) {
  const raw = text(value);
  if (raw === null) return null;
  // One 61-package row carries the source artifact "Y199" instead of a year.
  // The contract field is number | null, so an unparseable value stays null
  // rather than being guessed at.
  if (!/^\d{4}$/.test(raw)) return null;
  return Number(raw);
}

/**
 * Old-site 呎價 is published as `@554` (list cell) or `$554平方呎 (建築)`
 * (detail cell). Both decode to 554 with basis 建築. The basis is recorded only
 * when the printed label states it; a blank label stays null, never 0.
 */
function pricePerSqftValue(listValue, detailValue, context) {
  const listRaw = text(listValue);
  const detailRaw = text(detailValue);
  const listMatch = listRaw === null ? null : /^@([\d,]+)$/.exec(listRaw);
  const detailMatch =
    detailRaw === null ? null : /^\$([\d,]+)平方呎(?: \((建築|實用)\))?$/.exec(detailRaw);
  if (listRaw !== null && listMatch === null) {
    throw new Error(`${context}: unparseable list 呎價 ${JSON.stringify(listRaw)}`);
  }
  if (detailRaw !== null && detailMatch === null) {
    throw new Error(`${context}: unparseable detail 呎價 ${JSON.stringify(detailRaw)}`);
  }
  const listNumber = listMatch === null ? null : Number(digits(listMatch[1]));
  const detailNumber = detailMatch === null ? null : Number(digits(detailMatch[1]));
  if (listNumber !== null && detailNumber !== null && listNumber !== detailNumber) {
    throw new Error(`${context}: list 呎價 ${listNumber} != detail 呎價 ${detailNumber}`);
  }
  const price = detailNumber ?? listNumber;
  if (price === null) return { pricePerSqft: null, psfBasis: null };
  if (price === 0) {
    // The contract forbids a stored 0: a blank published 呎價 is null, and a
    // literal 0 label is not a real per-sq-ft price.
    throw new Error(`${context}: published 呎價 is 0; a blank label must be null`);
  }
  return { pricePerSqft: price, psfBasis: detailMatch === null ? null : (detailMatch[2] ?? null) };
}

/** List and detail gross-area cells must agree; either may be blank. */
function grossAreaValue(listValue, detailValue, context) {
  const listNumber = numberValue(listValue, `${context} gross_area_list`);
  const detailNumber = numberValue(detailValue, `${context} gross_area_detail`);
  if (listNumber !== null && detailNumber !== null && listNumber !== detailNumber) {
    throw new Error(
      `${context}: list gross area ${listNumber} != detail gross area ${detailNumber}`,
    );
  }
  return detailNumber ?? listNumber;
}

function considerationValue(listValue, detailValue, context) {
  const listNumber = numberValue(listValue, `${context} consideration_million_list`);
  const detailNumber = numberValue(detailValue, `${context} consideration_million_detail`);
  if (listNumber !== null && detailNumber !== null && listNumber !== detailNumber) {
    throw new Error(
      `${context}: list consideration ${listNumber} != detail consideration ${detailNumber}`,
    );
  }
  return detailNumber ?? listNumber;
}

/* ------------------------------------------------------------------ *
 * Estate registry mapping (roster slug -> registry slug)
 * ------------------------------------------------------------------ */
async function loadRegistry() {
  const module = await import(
    pathToFileURL(join(REPO_ROOT, "src/content/estate-registry.ts")).href
  );
  const entries = module.estateRegistry;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(
      "src/content/estate-registry.ts did not export a non-empty estateRegistry array",
    );
  }
  const bySlug = new Map();
  for (const entry of entries) {
    if (bySlug.has(entry.slug)) throw new Error(`estate-registry.ts: duplicate slug ${entry.slug}`);
    bySlug.set(entry.slug, entry);
  }
  return bySlug;
}

function resolveRegistrySlug(registry, slug, context) {
  const entry = registry.get(slug);
  if (entry === null || entry === undefined) {
    throw new Error(
      `${context}: slug ${JSON.stringify(slug)} is not in src/content/estate-registry.ts`,
    );
  }
  return entry;
}

/* ------------------------------------------------------------------ *
 * Row construction (fixed key order, contract field names)
 * ------------------------------------------------------------------ */
function requireRef(value, context) {
  const raw = text(value);
  if (raw === null) throw new Error(`${context}: blank ref`);
  return raw;
}

function requireNature(value, context) {
  const raw = text(value);
  if (raw === null) throw new Error(`${context}: blank instrument nature`);
  return raw;
}

/**
 * Map one transaction CSV record to a snapshot row. Both packages use the same
 * value column names; only the estate identity columns differ, and the caller
 * resolves those (61 package: estate_slug; Mount: canonical_key + fixed slug).
 */
function mapTransactionRow(record, context) {
  const { pricePerSqft, psfBasis } = pricePerSqftValue(
    record.price_per_sqft_list,
    record.price_per_sqft_detail,
    context,
  );
  return {
    ref: requireRef(record.ref, context),
    yearFilter: yearFilterValue(record.list_year_filter, `${context} list_year_filter`),
    registrationDate: isoDate(record.registration_date_list, `${context} registration_date_list`),
    instrumentDate: isoDate(record.instrument_date_detail, `${context} instrument_date_detail`),
    registrationNo: text(record.registration_no),
    nature: requireNature(record.instrument_nature, context),
    phase: text(record.phase_zh),
    tower: text(record.tower_zh),
    houseId: text(record.house_id),
    floor: text(record.floor_list),
    unit: text(record.unit_list),
    address: text(record.address_zh_detail),
    district: text(record.district),
    considerationMillion: considerationValue(
      record.consideration_million_list,
      record.consideration_million_detail,
      context,
    ),
    grossAreaSqft: grossAreaValue(record.gross_area_list, record.gross_area_detail, context),
    pricePerSqft,
    psfBasis,
    completionYear: completionYearValue(record.completion_year),
  };
}

/* ------------------------------------------------------------------ *
 * Pairing (data-contract.md, "Preliminary / formal pairing rule").
 * The generator only uses this to re-check the Mount package's documented
 * 14 pairs; the pure module owns the counts the UI shows.
 * ------------------------------------------------------------------ */
const NATURE_PROVISIONAL = "臨時合約";
const NATURE_FORMAL = "買賣合約";

function countPairs(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (row.address === null) continue;
    const key = `${row.address}\u0001${row.considerationMillion}\u0001${row.registrationDate}`;
    const group = groups.get(key) ?? { provisional: 0, formal: 0 };
    if (row.nature === NATURE_PROVISIONAL) group.provisional += 1;
    else if (row.nature === NATURE_FORMAL) group.formal += 1;
    groups.set(key, group);
  }
  let pairs = 0;
  for (const group of groups.values()) pairs += Math.min(group.provisional, group.formal);
  return pairs;
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */
function printSummary(summary) {
  console.log(
    [
      `estates61 rows: ${summary.estates61Rows}`,
      `mount rows: ${summary.mountRows}`,
      `source rows: ${summary.sourceRows}`,
      `estates: ${summary.estates}`,
      `estates covered: ${summary.estatesWithRows}`,
      `filtered-empty: ${summary.filteredEmpty}`,
      `chart months: ${summary.chartMonths}`,
      `chart estates: ${summary.chartEstates}`,
      `registration through: ${summary.registrationThrough}`,
      `unmapped slugs: ${summary.unmappedSlugs}`,
      `output bytes: ${summary.outputBytes}`,
    ].join("\n"),
  );
}

function printMappingReport(report) {
  console.log(
    [
      "",
      "mapping report",
      `  registry slugs: ${report.registrySlugs}`,
      `  roster slugs: ${report.rosterSlugs} (mapped ${report.mappedSlugs}, unmapped ${report.unmappedSlugs})`,
      `  nameZh source: estate-registry.ts${
        report.nameDifferences.length > 0 ? ` (${report.nameDifferences.join("; ")})` : ""
      }`,
      `  mount package: ${report.mountRows} rows -> ${MOUNT_SLUG} (canonical_key prefix ${MOUNT_CANONICAL_PREFIX}, estate_zh ${report.mountEstateZh})`,
      `  filtered-empty: ${report.filteredEmptySlugs.join(", ")}`,
      `  listSourceUrl: ${report.listSourceUrlFromEstates} from parsed/estates.json, ${report.listSourceUrlNull} null`,
      `  chart series: ${CHART_SERIES} only (${report.droppedTrendRows} transaction_derived rows dropped)`,
      `  chart estates: ${report.chartSlugs.join(", ")}`,
      `  rows by year filter (all rows): ${JSON.stringify(report.yearFilterCounts)}`,
      `  natures (all rows): ${JSON.stringify(report.natureCounts)}`,
      `  row identity: ${report.uniqueRowKeys} sourcePackage+yearFilter+ref keys, no collisions`,
    ].join("\n"),
  );
}

/* ------------------------------------------------------------------ *
 * Guards
 * ------------------------------------------------------------------ */
function assertEqualCounts(actual, expected, label) {
  const problems = [];
  for (const [key, value] of Object.entries(expected)) {
    const got = actual[key];
    if (JSON.stringify(got) !== JSON.stringify(value)) {
      problems.push(
        `${label}.${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(got)}`,
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(
      "verified-count mismatch against DEEPSEEK_INSTRUCTIONS.md / data-contract.md — stop and report the delta " +
        `instead of adjusting the expectation:\n  ${problems.join("\n  ")}`,
    );
  }
}

function countBy(rows, read) {
  const counts = new Map();
  for (const row of rows) {
    const key = read(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function sortedObject(map) {
  const object = {};
  for (const key of [...map.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    object[key] = map.get(key);
  }
  return object;
}

function sortRows(rows) {
  return rows.sort((a, b) => {
    if (a.registrationDate !== b.registrationDate) {
      return a.registrationDate < b.registrationDate ? 1 : -1;
    }
    if (a.instrumentDate !== b.instrumentDate) {
      return a.instrumentDate < b.instrumentDate ? 1 : -1;
    }
    if (a.ref !== b.ref) return a.ref < b.ref ? -1 : 1;
    return 0;
  });
}

function maxDate(rows, field) {
  let max = null;
  for (const row of rows) {
    const value = row[field];
    if (value === null) continue;
    if (max === null || value > max) max = value;
  }
  return max;
}

function latestFetchStamp(records) {
  let max = null;
  for (const record of records) {
    for (const value of [record.list_fetched_at, record.detail_fetched_at]) {
      if (value && (max === null || value > max)) max = value;
    }
  }
  return max;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */
async function main() {
  const report = {
    registrySlugs: 0,
    rosterSlugs: 0,
    mappedSlugs: 0,
    unmappedSlugs: 0,
    nameDifferences: [],
    mountRows: 0,
    mountEstateZh: null,
    filteredEmptySlugs: [],
    listSourceUrlFromEstates: 0,
    listSourceUrlNull: 0,
    droppedTrendRows: 0,
    chartSlugs: [],
    yearFilterCounts: {},
    natureCounts: {},
    uniqueRowKeys: 0,
  };

  assertPackageStamps();
  const registry = await loadRegistry();
  report.registrySlugs = registry.size;

  // --- 61-estate package ------------------------------------------------
  const estate61Root = options.estates61;
  const rosterRecords = readCsvFile(join(estate61Root, "roster.csv"), [
    "slug",
    "name_zh_preferred",
    "included_in_this_batch",
  ]);
  const roster = [];
  for (const record of rosterRecords) {
    const slug = text(record.slug);
    if (slug === null) throw new Error("roster.csv: blank slug");
    if (roster.some((entry) => entry.slug === slug))
      throw new Error(`roster.csv: duplicate slug ${slug}`);
    const registryEntry = resolveRegistrySlug(registry, slug, "roster.csv");
    const rosterName = text(record.name_zh_preferred);
    if (rosterName !== null && rosterName !== registryEntry.nameZh) {
      report.nameDifferences.push(
        `${slug}: registry ${registryEntry.nameZh} / roster ${rosterName}`,
      );
    }
    roster.push({
      slug,
      registryEntry,
      includedInBatch: text(record.included_in_this_batch) === "True",
    });
  }
  report.rosterSlugs = roster.length;
  report.mappedSlugs = roster.length;
  if (report.rosterSlugs !== VERIFIED.counts.estates) {
    throw new Error(
      `roster.csv lists ${report.rosterSlugs} slugs, expected ${VERIFIED.counts.estates}`,
    );
  }
  // The Mount estate is the one roster slug excluded from the 61-estate scrape.
  for (const entry of roster) {
    const expectedBatch = entry.slug !== MOUNT_SLUG;
    if (entry.includedInBatch !== expectedBatch) {
      throw new Error(
        `roster.csv: ${entry.slug} has included_in_this_batch=${entry.includedInBatch}, expected ${expectedBatch}`,
      );
    }
  }

  const transactionRecords = readCsvFile(join(estate61Root, "parsed", "transactions.csv"), [
    "estate_slug",
    "ref",
    "list_year_filter",
    "registration_date_list",
    "instrument_date_detail",
    "instrument_nature",
    "address_zh_detail",
    "phase_zh",
    "tower_zh",
    "house_id",
    "floor_list",
    "unit_list",
    "consideration_million_list",
    "consideration_million_detail",
    "gross_area_list",
    "gross_area_detail",
    "price_per_sqft_list",
    "price_per_sqft_detail",
    "completion_year",
  ]);
  const rowsBySlug = new Map(roster.map((entry) => [entry.slug, []]));
  const rosterSlugs = new Set(roster.map((entry) => entry.slug));
  for (const [index, record] of transactionRecords.entries()) {
    const context = `parsed/transactions.csv row ${index + 2}`;
    const slug = text(record.estate_slug);
    if (slug === null) throw new Error(`${context}: blank estate_slug`);
    if (!rosterSlugs.has(slug))
      throw new Error(`${context}: estate_slug ${slug} is not in roster.csv`);
    rowsBySlug.get(slug).push(mapTransactionRow(record, context));
  }
  if ((rowsBySlug.get(MOUNT_SLUG) ?? []).length > 0) {
    throw new Error(
      `61-package contains ${MOUNT_SLUG} transaction rows; the packages are disjoint by design and joining them would double-count`,
    );
  }

  // --- Mount package ----------------------------------------------------
  const mountRecords = readCsvFile(join(options.mount, "parsed", "transactions.csv"), [
    "ref",
    "list_year_filter",
    "registration_date_list",
    "instrument_date_detail",
    "instrument_nature",
    "address_zh_detail",
    "estate_zh",
    "phase_zh",
    "tower_zh",
    "house_id",
    "canonical_key",
    "floor_list",
    "unit_list",
    "consideration_million_list",
    "consideration_million_detail",
    "gross_area_list",
    "gross_area_detail",
    "price_per_sqft_list",
    "price_per_sqft_detail",
    "completion_year",
  ]);
  resolveRegistrySlug(registry, MOUNT_SLUG, "mount package");
  const mountRows = [];
  for (const [index, record] of mountRecords.entries()) {
    const context = `mount parsed/transactions.csv row ${index + 2}`;
    const canonicalKey = text(record.canonical_key);
    if (canonicalKey === null || !canonicalKey.startsWith(MOUNT_CANONICAL_PREFIX)) {
      throw new Error(
        `${context}: canonical_key ${JSON.stringify(canonicalKey)} is not under ${MOUNT_CANONICAL_PREFIX}`,
      );
    }
    const estateZh = text(record.estate_zh);
    if (report.mountEstateZh === null) report.mountEstateZh = estateZh;
    mountRows.push(mapTransactionRow(record, context));
  }
  rowsBySlug.set(MOUNT_SLUG, mountRows);
  report.mountRows = mountRows.length;

  // --- per-estate old-site list URLs -----------------------------------
  const estatesJson = JSON.parse(
    readFileSync(join(estate61Root, "parsed", "estates.json"), "utf8"),
  );
  const estateFacts = Array.isArray(estatesJson.estates) ? estatesJson.estates : null;
  if (estateFacts === null) throw new Error("parsed/estates.json: missing estates array");
  if (estateFacts.length !== VERIFIED.estatesJsonEntries) {
    throw new Error(
      `parsed/estates.json lists ${estateFacts.length} estates, expected ${VERIFIED.estatesJsonEntries}`,
    );
  }
  const listSourceUrlBySlug = new Map();
  for (const entry of estateFacts) {
    const slug = text(entry.slug);
    if (slug === null) throw new Error("parsed/estates.json: estate without slug");
    resolveRegistrySlug(registry, slug, "parsed/estates.json");
    const url = text(entry.old_site_search?.chosen?.url);
    listSourceUrlBySlug.set(slug, url !== null && url.startsWith("https://") ? url : null);
  }
  for (const entry of roster) {
    if (entry.slug === MOUNT_SLUG) continue;
    if (!listSourceUrlBySlug.has(entry.slug)) {
      throw new Error(`parsed/estates.json: no recorded old-site search for ${entry.slug}`);
    }
  }

  // --- chart transcription (image_transcribed series only) --------------
  const trendRecords = readCsvFile(join(estate61Root, "combined", "monthly_trends.csv"), [
    "estate_slug",
    "series",
    "method",
    "month",
    "avg_psf",
    "source_displayed_ppsf",
    "count",
    "visual_verified",
    "chart_title_ocr",
    "chart_period_start",
    "chart_period_end",
  ]);
  const chartTranscription = [];
  for (const [index, record] of trendRecords.entries()) {
    if (text(record.series) !== CHART_SERIES) {
      report.droppedTrendRows += 1;
      continue;
    }
    const context = `combined/monthly_trends.csv row ${index + 2}`;
    if (text(record.method) !== CHART_METHOD) {
      throw new Error(`${context}: unexpected chart method ${JSON.stringify(record.method)}`);
    }
    const slug = text(record.estate_slug);
    if (slug === null) throw new Error(`${context}: blank estate_slug`);
    resolveRegistrySlug(registry, slug, "combined/monthly_trends.csv");
    const count = numberValue(record.count, `${context} count`);
    if (count === null || !Number.isInteger(count) || count < 0) {
      throw new Error(
        `${context}: count ${JSON.stringify(record.count)} is not a non-negative integer`,
      );
    }
    let avgPsf = numberValue(record.avg_psf, `${context} avg_psf`);
    // Contract rule: a zero-volume month has no normalized average even when the
    // chart printed a label (a repeated label on a zero-volume connecting line).
    if (count === 0) avgPsf = null;
    chartTranscription.push({
      slug,
      month: yearMonth(record.month, `${context} month`),
      count,
      avgPsf,
      sourceDisplayedPpsf: text(record.source_displayed_ppsf),
      visualVerified: booleanValue(record.visual_verified, `${context} visual_verified`),
      chartTitle: text(record.chart_title_ocr),
      periodStart: yearMonth(record.chart_period_start, `${context} chart_period_start`),
      periodEnd: yearMonth(record.chart_period_end, `${context} chart_period_end`),
    });
  }
  chartTranscription.sort((a, b) => {
    if (a.slug !== b.slug) return a.slug < b.slug ? -1 : 1;
    return a.month < b.month ? -1 : a.month > b.month ? 1 : 0;
  });
  const chartKeys = new Set();
  for (const month of chartTranscription) {
    const key = `${month.slug}\u0001${month.month}`;
    if (chartKeys.has(key))
      throw new Error(`chart transcription duplicate for ${JSON.stringify(key)}`);
    chartKeys.add(key);
  }
  report.chartSlugs = [...new Set(chartTranscription.map((month) => month.slug))].sort();

  // --- estate records, row ordering, row identity -----------------------
  const estatePackage = new Map();
  const estateRecords = [];
  for (const entry of roster) {
    const rows = rowsBySlug.get(entry.slug) ?? [];
    sortRows(rows);
    const sourcePackage = entry.slug === MOUNT_SLUG ? "mount" : "estates-61";
    estatePackage.set(entry.slug, sourcePackage);
    const listSourceUrl =
      sourcePackage === "mount"
        ? MOUNT_LIST_SOURCE_URL
        : (listSourceUrlBySlug.get(entry.slug) ?? null);
    if (listSourceUrl === null) report.listSourceUrlNull += 1;
    else report.listSourceUrlFromEstates += 1;
    const status = rows.length > 0 ? "covered" : "filtered-empty";
    estateRecords.push({
      slug: entry.slug,
      nameZh: entry.registryEntry.nameZh,
      sourcePackage,
      asOf: SOURCES[sourcePackage].estateAsOf,
      registrationThrough: maxDate(rows, "registrationDate"),
      rowCount: rows.length,
      status,
      note: status === "filtered-empty" ? FILTERED_EMPTY_NOTE : null,
      listSourceUrl,
    });
  }
  estateRecords.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

  const rowsByEstate = {};
  for (const estate of estateRecords) {
    const rows = rowsBySlug.get(estate.slug) ?? [];
    if (rows.length > 0) rowsByEstate[estate.slug] = rows;
  }

  // Row identity is sourcePackage + yearFilter + ref: a second run of the same
  // archives can never add a duplicate row.
  const seenKeys = new Map();
  for (const estate of estateRecords) {
    for (const row of rowsByEstate[estate.slug] ?? []) {
      const key = `${estate.sourcePackage}\u0001${row.yearFilter}\u0001${row.ref}`;
      const previous = seenKeys.get(key);
      if (previous !== undefined) {
        throw new Error(
          `row identity collision for ${JSON.stringify(key)}: ${previous} and ${estate.slug} ` +
            "(sourcePackage + yearFilter + ref must be unique)",
        );
      }
      seenKeys.set(key, estate.slug);
    }
  }
  report.uniqueRowKeys = seenKeys.size;

  report.filteredEmptySlugs = estateRecords
    .filter((estate) => estate.status === "filtered-empty")
    .map((estate) => estate.slug);
  const allRows = estateRecords.flatMap((estate) => rowsByEstate[estate.slug] ?? []);
  const estates61Rows = estateRecords
    .filter((estate) => estate.sourcePackage === "estates-61")
    .flatMap((estate) => rowsByEstate[estate.slug] ?? []);
  const registrationThrough = maxDate(allRows, "registrationDate");
  if (registrationThrough === null) throw new Error("snapshot has no registration dates");
  report.yearFilterCounts = sortedObject(countBy(allRows, (row) => row.yearFilter));
  report.natureCounts = sortedObject(countBy(allRows, (row) => row.nature));

  const counts = {
    sourceRows: allRows.length,
    estates61Rows: estates61Rows.length,
    mountRows: mountRows.length,
    estates: estateRecords.length,
    estatesWithRows: estateRecords.filter((estate) => estate.rowCount > 0).length,
    filteredEmpty: report.filteredEmptySlugs.length,
    chartMonths: chartTranscription.length,
    chartEstates: report.chartSlugs.length,
  };

  // --- verified-count guards -------------------------------------------
  assertEqualCounts(counts, VERIFIED.counts, "counts");
  if (registrationThrough !== VERIFIED.registrationThrough) {
    throw new Error(
      `registrationThrough ${registrationThrough} != verified ${VERIFIED.registrationThrough}; stop and report the delta`,
    );
  }
  if (JSON.stringify(report.filteredEmptySlugs) !== JSON.stringify(VERIFIED.filteredEmptySlugs)) {
    throw new Error(
      `filtered-empty estates ${JSON.stringify(report.filteredEmptySlugs)} != verified ` +
        `${JSON.stringify(VERIFIED.filteredEmptySlugs)}; stop and report the delta`,
    );
  }
  assertEqualCounts(
    sortedObject(countBy(estates61Rows, (row) => row.yearFilter)),
    VERIFIED.estates61YearCounts,
    "estates61 year filter counts",
  );
  assertEqualCounts(
    sortedObject(countBy(mountRows, (row) => row.yearFilter)),
    VERIFIED.mountYearCounts,
    "mount year filter counts",
  );
  assertEqualCounts(
    sortedObject(countBy(estates61Rows, (row) => row.nature)),
    VERIFIED.estates61NatureCounts,
    "estates61 instrument natures",
  );
  const nullCount = (rows, read) => rows.filter((row) => read(row) === null).length;
  assertEqualCounts(
    {
      estates61NullGrossArea: nullCount(estates61Rows, (row) => row.grossAreaSqft),
      estates61NullPricePerSqft: nullCount(estates61Rows, (row) => row.pricePerSqft),
      mountNullGrossArea: nullCount(mountRows, (row) => row.grossAreaSqft),
      mountNullPricePerSqft: nullCount(mountRows, (row) => row.pricePerSqft),
    },
    VERIFIED.nullCounts,
    "null gross area / 呎價 counts",
  );
  if (allRows.some((row) => row.pricePerSqft === 0)) {
    throw new Error("a row stores pricePerSqft 0; blank published 呎價 must be null");
  }
  if (mountRows.some((row) => row.pricePerSqft !== null && row.psfBasis === null)) {
    throw new Error("a Mount 呎價 row lost its published basis label");
  }
  const mountPairs = countPairs(mountRows);
  if (mountPairs !== VERIFIED.mountPairs) {
    throw new Error(
      `pairing rule found ${mountPairs} same-day 臨時/買賣 pairs in the Mount package, which documents ` +
        `${VERIFIED.mountPairs}; stop and report the delta`,
    );
  }

  // --- document (fixed key order) --------------------------------------
  const doc = {
    schemaVersion: 1,
    generatedFrom: {
      estates61: {
        package: SOURCES["estates-61"].package,
        asOf: SOURCES["estates-61"].generatedAsOf,
      },
      mount: { package: SOURCES.mount.package, asOf: SOURCES.mount.generatedAsOf },
    },
    registrationThrough,
    counts,
    estates: estateRecords,
    rowsByEstate,
    chartTranscription,
  };

  const serialised = `${JSON.stringify(doc, null, 2)}\n`;
  const bytes = Buffer.byteLength(serialised, "utf8");
  const outPath = join(REPO_ROOT, options.out);
  const summary = {
    ...counts,
    registrationThrough,
    unmappedSlugs: report.unmappedSlugs,
    outputBytes: bytes,
  };

  if (options.dryRun) {
    printSummary(summary);
    printMappingReport(report);
    return;
  }

  if (options.check) {
    let committed = null;
    try {
      committed = readFileSync(outPath);
    } catch {
      committed = null;
    }
    printSummary(summary);
    if (committed === null) {
      console.error(`\ncheck failed: ${options.out} does not exist`);
      process.exitCode = 1;
      return;
    }
    if (!committed.equals(Buffer.from(serialised, "utf8"))) {
      console.error(
        `\ncheck failed: regenerated snapshot differs from ${options.out} ` +
          `(${committed.length} bytes on disk, ${bytes} bytes regenerated)`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`\ncheck ok: ${options.out} is byte-identical to a fresh regeneration`);
    return;
  }

  writeFileSync(outPath, serialised);
  printSummary(summary);
  if (options.printSummary) printMappingReport(report);
  console.log(`\nwrote ${options.out} (${bytes} bytes)`);
}

/**
 * Package stamps and directory identity. Both directories must look like the
 * documented packages, and no as-of stamp may predate the newest fetch it
 * summarises.
 */
function assertPackageStamps() {
  const checkDir = (dir, source, flag) => {
    const name = basename(dir);
    if (!name.startsWith(source.package)) {
      throw new Error(
        `${flag} directory ${JSON.stringify(name)} does not look like ${source.package}`,
      );
    }
  };
  checkDir(options.estates61, SOURCES["estates-61"], "--estates61");
  checkDir(options.mount, SOURCES.mount, "--mount");

  const metadataPath = join(options.mount, "parsed", "metadata.json");
  let mountGeneratedAt = null;
  try {
    mountGeneratedAt = JSON.parse(readFileSync(metadataPath, "utf8")).generated_at ?? null;
  } catch {
    mountGeneratedAt = null;
  }
  if (mountGeneratedAt !== null && mountGeneratedAt !== SOURCES.mount.generatedAsOf) {
    throw new Error(
      `Mount metadata generated_at ${mountGeneratedAt} != documented ${SOURCES.mount.generatedAsOf}; ` +
        "review the package before regenerating",
    );
  }

  const latest = latestFetchStamp(
    readCsvFile(join(options.estates61, "parsed", "transactions.csv"), ["ref"]),
  );
  if (latest !== null && latest > SOURCES["estates-61"].estateAsOf) {
    throw new Error(
      `61-package newest fetch ${latest} is later than the documented as-of ${SOURCES["estates-61"].estateAsOf}`,
    );
  }
}

await main();
