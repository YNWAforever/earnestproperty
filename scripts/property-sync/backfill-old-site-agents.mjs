#!/usr/bin/env node
/**
 * Backfill property_agents for old-site listings from their captured detail pages.
 *
 * Every earnestproperty-old-site detail page names the colleague(s) handling the
 * listing (聯絡人 / 聯絡電話). The sync stores that contact block in
 * properties.source_payload.contacts, so the two correspondent slots can be
 * filled from data we already captured -- no extra fetch. Contacts are matched
 * to active staff_users by phone first (normalised to 8 digits), then by
 * full-name containment over name_zh / name_en / any alias.
 *
 * Only positions 1-2 of the old-site rows are upserted; agents recorded from
 * another source are never deleted, and a position that already carries the
 * same staff member is left untouched so reruns are idempotent.
 *
 * Usage:
 *   node scripts/property-sync/backfill-old-site-agents.mjs                # dry-run
 *   node scripts/property-sync/backfill-old-site-agents.mjs --apply
 *   node scripts/property-sync/backfill-old-site-agents.mjs --limit=5 --report=artifacts/old-site-agents/try.json
 *   node scripts/property-sync/backfill-old-site-agents.mjs --help
 *
 * Flags: --dry-run (default), --apply, --limit=N (properties to process),
 *        --report=PATH|--report PATH, --help.
 * Env:   DATABASE_URL_UNPOOLED | DATABASE_URL | IMPORT_DATABASE_URL.
 *        Default report: artifacts/old-site-agents/<runId>.json.
 *
 * The table is the one from neon/migrations/20261110030000_property_correspondent_agents.sql:
 * PRIMARY KEY (property_id, position), positions 1-2 only.
 * Report: { candidates, matched, unmatched, written, skippedExisting, samples }.
 * This module opens no database connection on import; `runAgentBackfill` only
 * uses the injected `sql`.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { neon } from "@neondatabase/serverless";

export const OLD_SITE_SOURCE = "earnestproperty-old-site";
/** property_agents.source value written for agents captured from the old site. */
export const OLD_SITE_AGENT_SOURCE = "earnestproperty-old-site";
export const DEFAULT_ARTIFACT_ROOT = "artifacts/old-site-agents";
export const MAX_AGENTS_PER_PROPERTY = 2;

const USAGE = `Usage: node scripts/property-sync/backfill-old-site-agents.mjs [--apply] [--limit=N] [--report=PATH] [--help]

Matches the contacts captured in properties.source_payload (from the legacy
earnestproperty.com.hk detail pages) to active staff_users and upserts
property_agents positions 1-2 for the old-site rows. Defaults to a dry run;
--apply writes. Report: { candidates, matched, unmatched, written,
skippedExisting, samples }.`;

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

/**
 * Normalise a Hong Kong contact phone to its 8 digits.
 * Strips spaces/dashes/brackets and the +852 / 00852 country prefix; anything
 * that is not an 8-digit local number returns null (so emails and short codes
 * never match a staff phone).
 */
export function normalizeStaffPhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  let local = digits;
  if (local.length === 13 && local.startsWith("00852")) local = local.slice(5);
  else if (local.length === 11 && local.startsWith("852")) local = local.slice(3);
  return /^\d{8}$/.test(local) ? local : null;
}

/** Case/space/punctuation-insensitive name text for containment matching. */
function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s·•・.,，、/\\()（）\-_'’]/g, "");
}

function staffNameFields(row) {
  const fields = [];
  if (typeof row?.name_zh === "string" && row.name_zh.trim()) {
    fields.push(["name_zh", row.name_zh]);
  }
  if (typeof row?.name_en === "string" && row.name_en.trim()) {
    fields.push(["name_en", row.name_en]);
  }
  const aliases = Array.isArray(row?.aliases)
    ? row.aliases
    : typeof row?.alias === "string"
      ? [row.alias]
      : [];
  for (const alias of aliases) {
    if (typeof alias === "string" && alias.trim()) fields.push(["alias", alias]);
  }
  return fields;
}

/**
 * The single staff member whose full name contains (or is contained in) the raw
 * contact name. Two or more candidates is ambiguous and therefore no match.
 */
function matchStaffByFullName(rawName, staffRows) {
  const needle = normalizeName(rawName);
  if (needle.length < 2) return null;
  const hits = [];
  for (const row of staffRows) {
    for (const [matchedBy, value] of staffNameFields(row)) {
      const haystack = normalizeName(value);
      if (!haystack) continue;
      if (haystack === needle || haystack.includes(needle) || needle.includes(haystack)) {
        hits.push({ staff: row, matchedBy });
        break;
      }
    }
  }
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Select up to two staff members for one captured contact block.
 *
 * Phone matches win over name matches; each staff member appears at most once;
 * names that match more than one colleague are treated as ambiguous and
 * skipped; empty values and email addresses are ignored; inactive staff are
 * never matched.
 *
 * @param {{contactNames?: string[], contactPhones?: string[]}} contacts
 * @param {Array<object>} staffRows staff_users rows (`id`, `name_zh`,
 *   `name_en`, `phone`, `alias`/`aliases`, `active`).
 * @returns {Array<{staff: object, matchedBy: "phone"|"name_zh"|"name_en"|"alias",
 *   rawName: string|null, rawPhone: string|null}>} at most two, phone first.
 */
export function selectStaffMatches({ contactNames = [], contactPhones = [] } = {}, staffRows = []) {
  const staff = (Array.isArray(staffRows) ? staffRows : []).filter(
    (row) => row && row.id != null && row.active !== false,
  );
  const matches = [];
  const seenStaffIds = new Set();
  const add = (staffRow, matchedBy, rawName, rawPhone) => {
    const staffId = String(staffRow.id);
    if (matches.length >= MAX_AGENTS_PER_PROPERTY || seenStaffIds.has(staffId)) return;
    seenStaffIds.add(staffId);
    matches.push({
      staff: staffRow,
      matchedBy,
      rawName: rawName ?? null,
      rawPhone: rawPhone ?? null,
    });
  };

  const phones = (Array.isArray(contactPhones) ? contactPhones : []).filter(
    (value) => typeof value === "string" && value.trim() && !value.includes("@"),
  );
  for (const rawPhone of phones) {
    const phone = normalizeStaffPhone(rawPhone);
    if (!phone) continue;
    const phoneMatches = staff.filter((row) => normalizeStaffPhone(row.phone) === phone);
    if (phoneMatches.length === 1) add(phoneMatches[0], "phone", null, rawPhone.trim());
  }

  const names = (Array.isArray(contactNames) ? contactNames : []).filter(
    (value) => typeof value === "string" && value.trim() && !value.includes("@"),
  );
  for (const rawName of names) {
    const hit = matchStaffByFullName(rawName, staff);
    if (hit) add(hit.staff, hit.matchedBy, rawName.trim(), null);
  }

  return matches;
}

/** The contact block the sync captured from a legacy detail page. */
export function contactsFromSourcePayload(payload) {
  const parsed = parsePayload(payload);
  const contacts =
    parsed && typeof parsed.contacts === "object" && parsed.contacts ? parsed.contacts : {};
  const names = Array.isArray(contacts.names)
    ? contacts.names
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  const phones = Array.isArray(contacts.phones)
    ? contacts.phones
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  return { contactNames: names, contactPhones: phones };
}

function preferredStaffName(staffRow) {
  return staffRow?.name_zh || staffRow?.name_en || null;
}

async function writeReport(reportPath, report) {
  if (!reportPath) return;
  const target = path.resolve(reportPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

/**
 * Read the old-site properties that carry a captured contact block, match those
 * contacts to active staff, and upsert property_agents positions 1-2.
 *
 * @param {{sql: Function, dryRun?: boolean, reportPath?: string|null,
 *   limit?: number, now?: () => Date}} options `sql` is a neon
 *   tagged-template function.
 */
export async function runAgentBackfill({
  sql,
  dryRun = true,
  reportPath = null,
  limit = 0,
  now = () => new Date(),
} = {}) {
  if (typeof sql !== "function") {
    throw new TypeError("runAgentBackfill requires a sql tagged-template function");
  }
  const startedAt = now();
  const runId = newRunId(startedAt);

  const propertyRows = await sql`
    SELECT
      p.id,
      p.listing_no,
      p.canonical_property_no,
      p.legacy_detail_id,
      p.source_payload
    FROM properties p
    WHERE p.source_site = ${OLD_SITE_SOURCE}
      AND p.status = 'active'
      AND p.source_payload IS NOT NULL
    ORDER BY p.listing_no
  `;
  const staffRows = await sql`
    SELECT id, name_zh, name_en, phone, licence_no, active
    FROM staff_users
    WHERE active
  `;
  const existingAgentRows = await sql`
    SELECT a.property_id, a.position, a.staff_id, a.source
    FROM property_agents a
    JOIN properties p ON p.id = a.property_id
    WHERE p.source_site = ${OLD_SITE_SOURCE}
  `;

  const existingByProperty = new Map();
  for (const row of existingAgentRows) {
    const propertyKey = String(row.property_id);
    if (!existingByProperty.has(propertyKey)) existingByProperty.set(propertyKey, new Map());
    existingByProperty.get(propertyKey).set(Number(row.position), row);
  }

  const candidates = propertyRows
    .map((row) => ({ row, contacts: contactsFromSourcePayload(row.source_payload) }))
    .filter(({ contacts }) => contacts.contactNames.length || contacts.contactPhones.length);
  const limited = limit > 0 ? candidates.slice(0, limit) : candidates;

  let matched = 0;
  let unmatched = 0;
  let written = 0;
  let skippedExisting = 0;
  let rowsWritten = 0;
  const samples = [];
  const unmatchedSamples = [];
  const errors = [];

  for (const { row, contacts } of limited) {
    const matches = selectStaffMatches(contacts, staffRows);
    if (!matches.length) {
      unmatched += 1;
      if (unmatchedSamples.length < 20) {
        unmatchedSamples.push({
          property: row.listing_no ?? null,
          contacts,
        });
      }
      continue;
    }
    matched += 1;

    const sourceRef = row.legacy_detail_id ?? row.canonical_property_no ?? row.listing_no ?? null;
    const intended = matches.map((match, index) => ({
      position: index + 1,
      staffId: String(match.staff.id),
      staffName: preferredStaffName(match.staff),
      source: OLD_SITE_AGENT_SOURCE,
      sourceName: match.rawName ?? preferredStaffName(match.staff) ?? null,
      sourceLicenceNo: null,
      sourceRef,
      matchedBy: match.matchedBy,
    }));
    const existing = existingByProperty.get(String(row.id)) ?? new Map();
    // Leave positions that already carry the same colleague untouched so the
    // run is idempotent and never rewrites another source's provenance.
    const writes = intended.filter(
      (agent) => String(existing.get(agent.position)?.staff_id ?? "") !== agent.staffId,
    );
    if (!writes.length) {
      skippedExisting += 1;
      continue;
    }
    written += 1;
    rowsWritten += writes.length;
    if (samples.length < 20) {
      samples.push({
        propertyId: String(row.id),
        property: row.listing_no ?? null,
        agents: intended.map((agent) => ({
          position: agent.position,
          staffId: agent.staffId,
          staffName: agent.staffName,
          matchedBy: agent.matchedBy,
        })),
      });
    }
    if (dryRun) continue;

    try {
      for (const agent of writes) {
        await sql`
          INSERT INTO property_agents (
            property_id, position, staff_id, source, source_name, source_licence_no, source_ref
          )
          VALUES (
            ${row.id}::uuid, ${agent.position}, ${agent.staffId}::uuid, ${agent.source},
            ${agent.sourceName}, ${agent.sourceLicenceNo}, ${agent.sourceRef}
          )
          ON CONFLICT (property_id, position) DO UPDATE SET
            staff_id = EXCLUDED.staff_id,
            source = EXCLUDED.source,
            source_name = EXCLUDED.source_name,
            source_licence_no = EXCLUDED.source_licence_no,
            source_ref = EXCLUDED.source_ref,
            updated_at = now()
        `;
      }
    } catch (error) {
      errors.push({
        property: row.listing_no ?? null,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const finishedAt = now();
  const report = {
    runId,
    dryRun: dryRun === true,
    sourceSite: OLD_SITE_SOURCE,
    agentSource: OLD_SITE_AGENT_SOURCE,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.valueOf() - startedAt.valueOf()),
    candidates: candidates.length,
    processed: limited.length,
    staffConsidered: staffRows.length,
    matched,
    unmatched,
    written,
    rowsWritten,
    skippedExisting,
    samples,
    unmatchedSamples,
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

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new CliConfigurationError(`${name} must be a non-negative integer: ${value}`);
  }
  return number;
}

function parseCliArgs(argv = []) {
  const options = { apply: false, limit: 0, reportPath: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") options.apply = true;
    else if (argument === "--dry-run") options.apply = false;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--limit") {
      index += 1;
      options.limit = positiveInteger(requiredValue(argv[index], "--limit"), "--limit");
    } else if (argument.startsWith("--limit=")) {
      options.limit = positiveInteger(argument.slice("--limit=".length), "--limit");
    } else if (argument === "--report") {
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
    console.error(`backfill-old-site-agents: ${error instanceof Error ? error.message : error}`);
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
      "backfill-old-site-agents: DATABASE_URL_UNPOOLED, DATABASE_URL or IMPORT_DATABASE_URL is required.",
    );
    return 2;
  }
  const reportPath = options.reportPath ?? path.join(DEFAULT_ARTIFACT_ROOT, `${newRunId()}.json`);
  try {
    const report = await runAgentBackfill({
      sql: neon(databaseUrl),
      dryRun: !options.apply,
      reportPath,
      limit: options.limit,
    });
    console.log(JSON.stringify(report, null, 2));
    return report.errors.length ? 1 : 0;
  } catch (error) {
    console.error(`backfill-old-site-agents: ${error instanceof Error ? error.message : error}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
