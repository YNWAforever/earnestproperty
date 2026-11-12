#!/usr/bin/env node
/**
 * Fill NULL estate aggregate facts from the active old-site inventory.
 *
 * The legacy detail pages carry the building name, the year a building was
 * completed and the saleable area, so the old-site stock can seed the estate
 * directory's area range, block count, build year and median saleable psf.
 * Estate rows are curated editorial data: an existing value was verified by a
 * person and is never overwritten. Only NULL columns are filled, and the UPDATE
 * itself uses COALESCE so a concurrent edit wins over this script.
 *
 * Usage:
 *   node scripts/property-sync/refresh-estate-stats.mjs                      # dry-run
 *   node scripts/property-sync/refresh-estate-stats.mjs --apply              # write
 *   node scripts/property-sync/refresh-estate-stats.mjs --report=out.json    # also write here
 *   node scripts/property-sync/refresh-estate-stats.mjs --help
 *
 * Flags: --dry-run (default), --apply, --report=PATH|--report PATH, --help.
 * Env:   DATABASE_URL_UNPOOLED | DATABASE_URL | IMPORT_DATABASE_URL.
 *        Default report: artifacts/old-site-estate-stats/<runId>.json.
 *
 * Report: { dryRun, estatesConsidered, updated, skippedExisting, proposals }.
 * This module opens no database connection on import; the CLI does, and
 * `runEstateStatsRefresh({ sql, dryRun, reportPath })` only uses the injected
 * `sql`.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { neon } from "@neondatabase/serverless";

export const OLD_SITE_SOURCE = "earnestproperty-old-site";
/** Estate columns this script may fill; only NULL values are ever written. */
export const ESTATE_STAT_FIELDS = Object.freeze([
  "area_min",
  "area_max",
  "blocks",
  "year_completed",
  "avg_saleable_psf",
]);
export const DEFAULT_ARTIFACT_ROOT = "artifacts/old-site-estate-stats";

const USAGE = `Usage: node scripts/property-sync/refresh-estate-stats.mjs [--apply] [--report=PATH] [--help]

Fills NULL estate aggregate facts (area_min, area_max, blocks, year_completed,
avg_saleable_psf) from the active earnestproperty-old-site inventory.
Defaults to a dry run; --apply writes. Existing non-NULL estate facts are never
overwritten. Report: { estatesConsidered, updated, skippedExisting, proposals }.`;

function newRunId(now = new Date()) {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

function parsePayload(value) {
  if (value == null) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function positiveNumber(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function toYear(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= 1800 && number <= 2200 ? number : null;
}

/** Median of `values` rounded to one decimal (NUMERIC column); null when empty. */
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value * 10) / 10;
}

/** Most frequent year; ties break to the earlier year so reruns are stable. */
function modeYear(values) {
  if (!values.length) return null;
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let bestYear = null;
  let bestCount = -1;
  for (const [year, count] of counts) {
    if (count > bestCount || (count === bestCount && year < bestYear)) {
      bestYear = year;
      bestCount = count;
    }
  }
  return bestYear;
}

/** The legacy building text that identifies one block ("麗都花園 第03座"). */
function buildingLabel(row) {
  const payload = parsePayload(row?.source_payload);
  const rawFields =
    payload && typeof payload.rawFields === "object" && payload.rawFields ? payload.rawFields : {};
  const candidate = payload?.buildingZh ?? rawFields["大廈 (中)"] ?? null;
  const text = typeof candidate === "string" ? candidate.trim() : "";
  return text || null;
}

/**
 * Aggregate the active old-site inventory per estate slug.
 *
 * @param {Array<object>} propertiesRows rows with at least `estate_slug`,
 *   `deal_type`, `saleable_area`, `price`, `year_completed` and
 *   `source_payload` (the query in `runEstateStatsRefresh` selects them).
 * @returns {Map<string, {area_min:number|null, area_max:number|null,
 *   blocks:number|null, year_completed:number|null,
 *   avg_saleable_psf:number|null, active_listings:number,
 *   sale_listings:number, rent_listings:number}>}
 */
export function computeEstateAggregates(propertiesRows = []) {
  const buckets = new Map();
  for (const row of Array.isArray(propertiesRows) ? propertiesRows : []) {
    const slug = typeof row?.estate_slug === "string" ? row.estate_slug.trim() : "";
    if (!slug) continue;
    if (!buckets.has(slug)) buckets.set(slug, []);
    buckets.get(slug).push(row);
  }

  const aggregates = new Map();
  for (const [slug, rows] of buckets) {
    const areas = [];
    const psfValues = [];
    const blockNames = new Set();
    const years = [];
    const listingIds = new Set();
    let saleListings = 0;
    let rentListings = 0;

    for (const row of rows) {
      if (row?.id != null) listingIds.add(String(row.id));
      const area = positiveNumber(row?.saleable_area);
      if (area !== null) areas.push(area);
      const block = buildingLabel(row);
      if (block) blockNames.add(block);
      const year =
        toYear(row?.year_completed) ?? toYear(parsePayload(row?.source_payload)?.yearCompleted);
      if (year !== null) years.push(year);
      if (row?.deal_type === "sale") {
        saleListings += 1;
        const price = positiveNumber(row?.price);
        if (price !== null && area !== null) psfValues.push(price / area);
      } else if (row?.deal_type === "rent") {
        rentListings += 1;
      }
    }

    aggregates.set(slug, {
      area_min: areas.length ? Math.min(...areas) : null,
      area_max: areas.length ? Math.max(...areas) : null,
      blocks: blockNames.size || null,
      year_completed: modeYear(years),
      avg_saleable_psf: median(psfValues),
      active_listings: listingIds.size || rows.length,
      sale_listings: saleListings,
      rent_listings: rentListings,
    });
  }
  return aggregates;
}

/**
 * Pair each aggregate with its estate row and keep only the NULL columns that
 * can be filled. `updated` counts estates the UPDATE will touch; an estate whose
 * aggregate carries no new fact is ignored, one whose facts are all already set
 * counts as `skippedExisting`.
 */
export function buildEstateStatsProposals(aggregates, estateRows = []) {
  const bySlug = new Map();
  for (const row of Array.isArray(estateRows) ? estateRows : []) {
    if (!row || row.id == null || typeof row.slug !== "string") continue;
    bySlug.set(row.slug.trim(), row);
  }

  const proposals = [];
  let skippedExisting = 0;
  for (const [slug, aggregate] of aggregates ?? []) {
    const estate = bySlug.get(slug);
    if (!estate) continue;
    const proposed = {};
    const filled = {};
    for (const field of ESTATE_STAT_FIELDS) {
      const value = aggregate?.[field] ?? null;
      if (value === null) continue;
      proposed[field] = value;
      if (estate[field] === null || estate[field] === undefined) filled[field] = value;
    }
    if (!Object.keys(proposed).length) continue;
    if (!Object.keys(filled).length) {
      skippedExisting += 1;
      continue;
    }
    proposals.push({
      id: estate.id,
      slug,
      existing: Object.fromEntries(
        ESTATE_STAT_FIELDS.map((field) => [field, estate[field] ?? null]),
      ),
      proposed,
      filled,
      listings: {
        active: aggregate.active_listings,
        sale: aggregate.sale_listings,
        rent: aggregate.rent_listings,
      },
    });
  }
  return { proposals, updated: proposals.length, skippedExisting };
}

async function writeReport(reportPath, report) {
  if (!reportPath) return;
  const target = path.resolve(reportPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

/**
 * Load the active old-site inventory, compute per-estate aggregates and fill the
 * NULL estate columns. Dry-run performs the SELECTs only; no UPDATE runs.
 *
 * @param {{sql: Function, dryRun?: boolean, reportPath?: string|null,
 *   now?: () => Date}} options `sql` is a neon tagged-template function.
 */
export async function runEstateStatsRefresh({
  sql,
  dryRun = true,
  reportPath = null,
  now = () => new Date(),
} = {}) {
  if (typeof sql !== "function") {
    throw new TypeError("runEstateStatsRefresh requires a sql tagged-template function");
  }
  const startedAt = now();
  const runId = newRunId(startedAt);

  const propertiesRows = await sql`
    SELECT
      p.id,
      p.estate_id,
      e.slug AS estate_slug,
      p.deal_type,
      p.saleable_area,
      p.price,
      p.rent,
      p.year_completed,
      p.source_payload
    FROM properties p
    JOIN estates e ON e.id = p.estate_id
    WHERE p.status = 'active'
      AND p.source_site = ${OLD_SITE_SOURCE}
  `;
  const estateRows = await sql`
    SELECT
      id,
      slug,
      area_min,
      area_max,
      blocks,
      year_completed,
      avg_saleable_psf
    FROM estates
  `;

  const aggregates = computeEstateAggregates(propertiesRows);
  const { proposals, updated, skippedExisting } = buildEstateStatsProposals(aggregates, estateRows);

  let applied = 0;
  if (!dryRun) {
    for (const proposal of proposals) {
      const { proposed } = proposal;
      await sql`
        UPDATE estates SET
          area_min = COALESCE(area_min, ${proposed.area_min ?? null}),
          area_max = COALESCE(area_max, ${proposed.area_max ?? null}),
          blocks = COALESCE(blocks, ${proposed.blocks ?? null}),
          year_completed = COALESCE(year_completed, ${proposed.year_completed ?? null}),
          avg_saleable_psf = COALESCE(avg_saleable_psf, ${proposed.avg_saleable_psf ?? null})
        WHERE id = ${proposal.id}::uuid
      `;
      applied += 1;
    }
  }

  const finishedAt = now();
  const report = {
    runId,
    dryRun: dryRun === true,
    sourceSite: OLD_SITE_SOURCE,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.valueOf() - startedAt.valueOf()),
    estatesConsidered: aggregates.size,
    updated: dryRun === true ? updated : applied,
    skippedExisting,
    proposals,
  };
  await writeReport(reportPath, report);
  return report;
}

function loadEnv() {
  const env = {};
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
  return { ...env, ...process.env };
}

class CliConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliConfigurationError";
    this.code = "invalid_configuration";
  }
}

function requiredValue(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new CliConfigurationError(`${name} requires a value`);
  }
  return value;
}

function parseCliArgs(argv = []) {
  const options = { apply: false, reportPath: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") options.apply = true;
    else if (argument === "--dry-run") options.apply = false;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--report") {
      index += 1;
      options.reportPath = requiredValue(argv[index], "--report");
    } else if (argument.startsWith("--report=")) {
      options.reportPath = requiredValue(argument.slice("--report=".length), "--report");
    } else {
      throw new CliConfigurationError(`unknown argument: ${argument}`);
    }
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    console.error(`refresh-estate-stats: ${error instanceof Error ? error.message : error}`);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const env = loadEnv();
  const databaseUrl = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL || env.IMPORT_DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "refresh-estate-stats: DATABASE_URL_UNPOOLED, DATABASE_URL or IMPORT_DATABASE_URL is required.",
    );
    return 2;
  }
  const reportPath = options.reportPath ?? path.join(DEFAULT_ARTIFACT_ROOT, `${newRunId()}.json`);
  try {
    const report = await runEstateStatsRefresh({
      sql: neon(databaseUrl),
      dryRun: !options.apply,
      reportPath,
    });
    console.log(JSON.stringify(report, null, 2));
    return 0;
  } catch (error) {
    console.error(`refresh-estate-stats: ${error instanceof Error ? error.message : error}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
