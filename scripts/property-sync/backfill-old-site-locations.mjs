#!/usr/bin/env node
/**
 * Correct estate_id / district_slug on old-site properties from the captured detail
 * pages, without ever overwriting a deliberate editorial assignment.
 *
 * The 1,056 rows imported from the legacy site in 2026-08 were normalised by the
 * old heuristic resolver: it defaulted every unknown location to district
 * "tsuen-wan" (a district the new site does not have). The new estate resolver
 * (@see src/lib/mls/estate-resolver.mjs) matches estate names/aliases and the
 * castle-peak-road corridor, so this backfill applies only the safe corrections:
 *
 *   - estate_id: fill only when it is NULL and the resolver matched unambiguously;
 *   - district_slug: fill when it is NULL or still the bogus "tsuen-wan";
 *   - a different, non-NULL estate is reported as stale (never overwritten unless
 *     the operator passes --stale-estate).
 *
 * Usage:
 *   node scripts/property-sync/backfill-old-site-locations.mjs                   # dry-run
 *   node scripts/property-sync/backfill-old-site-locations.mjs --apply
 *   node scripts/property-sync/backfill-old-site-locations.mjs --apply --stale-estate
 *   node scripts/property-sync/backfill-old-site-locations.mjs --report=out.json
 *   node scripts/property-sync/backfill-old-site-locations.mjs --help
 *
 * Flags: --dry-run (default), --apply, --stale-estate, --report=PATH|--report PATH, --help.
 * Env:   DATABASE_URL_UNPOOLED | DATABASE_URL | IMPORT_DATABASE_URL.
 *        Default report: artifacts/old-site-locations/<runId>.json.
 *
 * The UPDATE only touches estate_id, district_slug and updated_at -- never
 * source_site, legacy_detail_id or status. This module opens no database
 * connection on import; `runLocationBackfill` only uses the injected `sql`.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { neon } from "@neondatabase/serverless";

export const OLD_SITE_SOURCE = "earnestproperty-old-site";
/** The legacy heuristic's placeholder district, which the new site does not have. */
export const TSUEN_WAN_DISTRICT = "tsuen-wan";
export const DEFAULT_ARTIFACT_ROOT = "artifacts/old-site-locations";
const DETAIL_LABELS = Object.freeze({
  buildingZh: "大廈 (中)",
  buildingEn: "大廈 (英)",
  streetZh: "街道 (中)",
  streetEn: "街道 (英)",
});

const USAGE = `Usage: node scripts/property-sync/backfill-old-site-locations.mjs [--apply] [--stale-estate] [--report=PATH] [--help]

Applies safe estate/district corrections to earnestproperty-old-site properties:
fills a NULL estate_id, fixes a NULL or bogus "tsuen-wan" district_slug and, with
--stale-estate, replaces a different non-NULL estate. Defaults to a dry run.
Report: per-row changes plus counts, stale-estate samples and errors.`;

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

function cleanText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return null;
}

/**
 * Decide the safe estate/district correction for one old-site property row.
 *
 * The resolver receives a detail-shaped object built from the captured raw
 * fields (`payload.rawFields["大廈 (中)"]` etc.) with the old-site title as the
 * building-name fallback, mirroring `parseListingDetail`.
 *
 * @param {object} row properties row with `title_zh`, `address`,
 *   `source_payload`, `estate_id`, `district_slug`.
 * @param {{resolveLocation: Function}} resolver estate resolver instance.
 * @param {{updateStaleEstate?: boolean}} [options]
 * @returns {{propertyId: any, listingNo: any,
 *   current: {estate_id: string|null, district_slug: string|null},
 *   proposed: {estate_id: string|null, district_slug: string|null},
 *   matchedBy: string|null, ambiguous: boolean, staleEstate: boolean,
 *   changes: {estate_id?: string, district_slug?: string}, changed: boolean,
 *   reason: string|null}}
 */
export function proposeLocation(row, resolver, options = {}) {
  if (!row || typeof row !== "object") {
    throw new TypeError("proposeLocation requires a property row");
  }
  if (!resolver || typeof resolver.resolveLocation !== "function") {
    throw new TypeError("proposeLocation requires a resolver with resolveLocation()");
  }

  const payload = parsePayload(row.source_payload);
  const rawFields =
    payload && typeof payload.rawFields === "object" && payload.rawFields ? payload.rawFields : {};
  const fromPayload = (key) => firstText(payload?.[key], rawFields[DETAIL_LABELS[key]]);
  const title = firstText(row.title_zh, payload?.title);
  const detail = {
    buildingZh: firstText(fromPayload("buildingZh"), title),
    buildingEn: fromPayload("buildingEn"),
    streetZh: fromPayload("streetZh"),
    streetEn: fromPayload("streetEn"),
    title,
    address: cleanText(row.address),
  };

  const resolved = resolver.resolveLocation(detail) ?? {};
  const currentEstateId = cleanText(row.estate_id);
  const currentDistrict = cleanText(row.district_slug);
  const proposedEstateId = cleanText(resolved.estateId);
  const proposedDistrict = cleanText(resolved.districtSlug);
  const ambiguous = resolved.ambiguous === true;
  const matchedBy = cleanText(resolved.matchedBy);

  const changes = {};
  if (proposedEstateId && !ambiguous && currentEstateId === null) {
    changes.estate_id = proposedEstateId;
  }
  if (proposedDistrict && (currentDistrict === null || currentDistrict === TSUEN_WAN_DISTRICT)) {
    changes.district_slug = proposedDistrict;
  }
  const staleEstate =
    proposedEstateId !== null &&
    !ambiguous &&
    currentEstateId !== null &&
    currentEstateId !== proposedEstateId;
  // A stale estate needs explicit operator consent: the current value may be a
  // deliberate editorial assignment rather than the old heuristic's guess.
  if (staleEstate && options.updateStaleEstate === true) {
    changes.estate_id = proposedEstateId;
  }

  const changed = Object.keys(changes).length > 0;
  let reason = null;
  if (ambiguous) reason = "ambiguous";
  else if (changed) reason = null;
  else if (staleEstate) reason = "stale_estate";
  else if (proposedEstateId || proposedDistrict) reason = "already_current";
  else reason = "no_match";

  return {
    propertyId: row.id ?? null,
    listingNo: row.listing_no ?? null,
    current: { estate_id: currentEstateId, district_slug: currentDistrict },
    proposed: { estate_id: proposedEstateId, district_slug: proposedDistrict },
    matchedBy,
    ambiguous,
    staleEstate,
    changes,
    changed,
    reason,
  };
}

async function loadDefaultResolverFactory() {
  const module = await import(
    new URL("../../src/lib/mls/estate-resolver.mjs", import.meta.url).href
  );
  if (typeof module.createEstateResolver !== "function") {
    throw new Error("estate-resolver.mjs does not export createEstateResolver");
  }
  return module.createEstateResolver;
}

async function writeReport(reportPath, report) {
  if (!reportPath) return;
  const target = path.resolve(reportPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

/**
 * Load the old-site properties + estates, propose safe location corrections and
 * (with `dryRun: false`) apply them.
 *
 * @param {{sql: Function, dryRun?: boolean, reportPath?: string|null,
 *   updateStaleEstate?: boolean, resolverFactory?: Function|null,
 *   now?: () => Date}} options `sql` is a neon tagged-template function;
 *   `resolverFactory` overrides the estate-resolver import (used by tests).
 */
export async function runLocationBackfill({
  sql,
  dryRun = true,
  reportPath = null,
  updateStaleEstate = false,
  resolverFactory = null,
  now = () => new Date(),
} = {}) {
  if (typeof sql !== "function") {
    throw new TypeError("runLocationBackfill requires a sql tagged-template function");
  }
  const startedAt = now();
  const runId = newRunId(startedAt);

  // `no-hermes-v2` rows are owned by the Property.hk v2 feed: the DB fence
  // (aaa_mls_ingestion_owner_fence) refuses legacy writes to them, so the
  // location backfill must leave those rows alone too.
  const properties = await sql`
    SELECT
      p.id,
      p.listing_no,
      p.title_zh,
      p.address,
      p.estate_id,
      p.district_slug,
      p.source_payload,
      p.ingestion_owner
    FROM properties p
    WHERE p.source_site = ${OLD_SITE_SOURCE}
      AND p.ingestion_owner = 'legacy'
    ORDER BY p.listing_no
  `;
  const estates = await sql`
    SELECT id, slug, name_zh, name_en, aliases, district_slug
    FROM estates
  `;

  const factory =
    typeof resolverFactory === "function" ? resolverFactory : await loadDefaultResolverFactory();
  const resolver = factory(estates);
  const proposals = properties.map((row) => proposeLocation(row, resolver, { updateStaleEstate }));
  const changedRows = proposals.filter((proposal) => proposal.changed);

  const errors = [];
  let applied = 0;
  if (!dryRun) {
    for (const proposal of changedRows) {
      const estateId = proposal.changes.estate_id ?? proposal.current.estate_id;
      const districtSlug = proposal.changes.district_slug ?? proposal.current.district_slug;
      try {
        await sql`
          UPDATE properties SET
            estate_id = ${estateId}::uuid,
            district_slug = ${districtSlug},
            updated_at = now()
          WHERE id = ${proposal.propertyId}::uuid
            AND ingestion_owner = 'legacy'
        `;
        applied += 1;
      } catch (error) {
        errors.push({
          property: proposal.listingNo,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const matchedByCounts = { name_zh: 0, name_en: 0, alias: 0, none: 0 };
  for (const proposal of proposals) {
    if (proposal.matchedBy && proposal.matchedBy in matchedByCounts) {
      matchedByCounts[proposal.matchedBy] += 1;
    } else {
      matchedByCounts.none += 1;
    }
  }
  const staleEstateSamples = proposals
    .filter((proposal) => proposal.staleEstate)
    .slice(0, 50)
    .map((proposal) => ({
      propertyId: proposal.propertyId,
      listingNo: proposal.listingNo,
      current: proposal.current.estate_id,
      proposed: proposal.proposed.estate_id,
      reason: proposal.reason,
    }));

  const finishedAt = now();
  const report = {
    runId,
    dryRun: dryRun === true,
    sourceSite: OLD_SITE_SOURCE,
    updateStaleEstate: updateStaleEstate === true,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.valueOf() - startedAt.valueOf()),
    candidates: proposals.length,
    changed: changedRows.length,
    applied: dryRun === true ? 0 : applied,
    unchanged: proposals.length - changedRows.length,
    staleEstateCount: proposals.filter((proposal) => proposal.staleEstate).length,
    ambiguous: proposals.filter((proposal) => proposal.ambiguous).length,
    matchedByCounts,
    counts: {
      estate_id: changedRows.filter((proposal) => proposal.changes.estate_id).length,
      district_slug: changedRows.filter((proposal) => proposal.changes.district_slug).length,
    },
    changes: changedRows.map((proposal) => ({
      propertyId: proposal.propertyId,
      listingNo: proposal.listingNo,
      current: proposal.current,
      proposed: proposal.proposed,
      changes: proposal.changes,
      matchedBy: proposal.matchedBy,
    })),
    staleEstate: staleEstateSamples,
    errors,
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
  const options = { apply: false, staleEstate: false, reportPath: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") options.apply = true;
    else if (argument === "--dry-run") options.apply = false;
    else if (argument === "--stale-estate") options.staleEstate = true;
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
    console.error(`backfill-old-site-locations: ${error instanceof Error ? error.message : error}`);
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
      "backfill-old-site-locations: DATABASE_URL_UNPOOLED, DATABASE_URL or IMPORT_DATABASE_URL is required.",
    );
    return 2;
  }
  const reportPath = options.reportPath ?? path.join(DEFAULT_ARTIFACT_ROOT, `${newRunId()}.json`);
  try {
    const report = await runLocationBackfill({
      sql: neon(databaseUrl),
      dryRun: !options.apply,
      reportPath,
      updateStaleEstate: options.staleEstate,
    });
    console.log(JSON.stringify(report, null, 2));
    return report.errors.length ? 1 : 0;
  } catch (error) {
    console.error(`backfill-old-site-locations: ${error instanceof Error ? error.message : error}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
