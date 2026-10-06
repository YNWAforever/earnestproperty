import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

import { staffReassignStatements } from "./staff-ownership.ts";

const root = process.cwd();

function sourceFiles(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx|js|mjs)$/.test(entry.name)) return [];
    if (/\.(test|spec)\.(ts|tsx|js|mjs)$/.test(entry.name)) return [];
    return [path];
  });
}

function migrationFiles() {
  return readdirSync(join(root, "neon/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .map((name) => `neon/migrations/${name}`);
}

// crm_leads with an optional schema and optional quotes, never a longer name
// such as crm_leads_archive.
const LEAD_TABLE = String.raw`(?:"?public"?\s*\.\s*)?"?crm_leads"?(?![\w"])`;
const LEAD_UPDATE = new RegExp(String.raw`\bUPDATE\s+(?:ONLY\s+)?` + LEAD_TABLE, "gi");
// An upsert, kept inside one statement: no `;` between INSERT and DO UPDATE.
const LEAD_UPSERT = new RegExp(
  String.raw`\bINSERT\s+INTO\s+` +
    LEAD_TABLE +
    String.raw`[^;]*?\bON\s+CONFLICT\b[^;]*?\bDO\s+UPDATE\b`,
  "gi",
);

function sliceSet(text, from) {
  const rest = text.slice(from);
  const end = rest.search(/\bRETURNING\b|\bWHERE\b|;/i);
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Each statement that writes an existing crm_leads row: every `UPDATE`
 * (with or without ONLY, schema or quotes) and every `INSERT ... ON CONFLICT
 * ... DO UPDATE`. Each is sliced from the write up to its first RETURNING,
 * WHERE or `;`, so the slice holds the SET list.
 */
function crmLeadWrites(text) {
  const found = [];
  for (const match of text.matchAll(LEAD_UPDATE)) found.push(sliceSet(text, match.index));
  for (const match of text.matchAll(LEAD_UPSERT)) {
    const doUpdate = match[0].search(/\bDO\s+UPDATE\b/i);
    found.push(sliceSet(text, match.index + doUpdate));
  }
  return found;
}

/**
 * True when the SET list assigns updated_at a value that moves it. A
 * self-assignment such as `updated_at = updated_at` or `updated_at = l.updated_at`
 * does not count, and neither does a mere mention of the column.
 */
function bumpsVersion(slice) {
  const assignment = /(?:^|[\s,(])"?updated_at"?\s*=(?!=)\s*/gi;
  for (const match of slice.matchAll(assignment)) {
    const value = slice.slice(match.index + match[0].length);
    const selfOnly = /^(?:"?\w+"?\s*\.\s*)?"?updated_at"?\s*(?:,|\)|$|\bFROM\b)/i;
    if (!selfOnly.test(value.trimEnd())) return true;
  }
  return false;
}

function crmLeadUpdates(path) {
  return crmLeadWrites(readFileSync(join(root, path), "utf8"));
}

const BUMP_RULE =
  "FX-09 fact 8 / Review Focus 2: every writer that changes a crm_leads row must bump " +
  "updated_at in the same statement, or a stale lead editor can silently undo it.";

test("every UPDATE of crm_leads bumps updated_at", () => {
  const files = [...sourceFiles("src"), ...migrationFiles()];
  let seen = 0;
  for (const path of files) {
    for (const slice of crmLeadUpdates(path)) {
      seen++;
      assert.ok(bumpsVersion(slice), `${relative(root, join(root, path))}: ${BUMP_RULE}\n${slice}`);
    }
  }
  assert.ok(seen >= 3, "expected the single-lead, bulk and live-agent lead updates to be scanned");

  const handover = staffReassignStatements("a", "b").flatMap((entry) =>
    crmLeadWrites(entry.statement),
  );
  assert.equal(handover.length, 1, "staff handover must reassign crm_leads");
  assert.ok(bumpsVersion(handover[0]), `staffReassignStatements: ${BUMP_RULE}`);
});

test("the writer scan catches every spelling of a crm_leads write and a bump that does not move", () => {
  const misses = [
    "UPDATE public.crm_leads SET assigned_agent_id = $1 WHERE id = $2",
    "UPDATE ONLY crm_leads SET stage = 'new' WHERE id = $1",
    'UPDATE "crm_leads" SET note = $1 WHERE id = $2',
    'UPDATE ONLY public."crm_leads" l SET note = $1 WHERE l.id = $2',
    "INSERT INTO crm_leads (id, stage) VALUES ($1, $2)\n  ON CONFLICT (id) DO UPDATE SET stage = EXCLUDED.stage",
    "INSERT INTO public.crm_leads AS l (id, note) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET note = EXCLUDED.note, updated_at = l.updated_at RETURNING l.id",
    "UPDATE crm_leads SET stage = $1, updated_at = updated_at WHERE id = $2",
    "UPDATE crm_leads l SET note = $1, updated_at = l.updated_at FROM old o WHERE l.id = o.id",
    "UPDATE crm_leads SET note = updated_at::text WHERE id = $1",
  ];
  for (const sql of misses) {
    const writes = crmLeadWrites(sql);
    assert.equal(writes.length, 1, `the scan must find this crm_leads write: ${sql}`);
    assert.equal(bumpsVersion(writes[0]), false, `the scan must reject this write: ${sql}`);
  }

  const passes = [
    "UPDATE crm_leads SET stage = $1, updated_at = now() WHERE id = $2",
    "UPDATE public.crm_leads l SET note = $1, updated_at = GREATEST(now(), l.updated_at + interval '1 microsecond') FROM old o WHERE l.id = o.id",
    "UPDATE crm_leads SET note = $1, updated_at = updated_at + interval '1 microsecond' WHERE id = $2",
    "INSERT INTO crm_leads (id, stage) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET stage = EXCLUDED.stage, updated_at = now()",
  ];
  for (const sql of passes) {
    const writes = crmLeadWrites(sql);
    assert.equal(writes.length, 1, sql);
    assert.equal(bumpsVersion(writes[0]), true, sql);
  }

  for (const sql of [
    "INSERT INTO crm_leads (id) VALUES ($1) ON CONFLICT DO NOTHING",
    "INSERT INTO crm_leads (id) VALUES ($1); INSERT INTO crm_contacts (id) VALUES ($1) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name",
    "UPDATE crm_leads_archive SET note = $1 WHERE id = $2",
  ])
    assert.deepEqual(crmLeadWrites(sql), [], sql);
});

test("no non-lead writer touches crm_leads", () => {
  for (const path of [
    "src/lib/ai/crm-enrichment.server.ts",
    "src/lib/neon/whatsapp-consent.server.ts",
  ]) {
    const text = readFileSync(join(root, path), "utf8");
    assert.deepEqual(
      crmLeadWrites(text),
      [],
      `${path} must not write crm_leads: it would bump or skip the lead version (Review Focus 2)`,
    );
  }
});

test("the version is never parsed as a date", () => {
  const server = readFileSync(join(root, "src/lib/neon/admin-data.server.ts"), "utf8");
  const start = server.indexOf("export async function fetchAdminLead(");
  assert.ok(start >= 0, "fetchAdminLead must exist");
  const end = server.indexOf("\nexport ", start + 1);
  const fetchLead = server.slice(start, end === -1 ? undefined : end);
  assert.ok(
    /\$\{leadVersionSql\("l"\)\} AS version/.test(fetchLead),
    'fetchAdminLead must select ${leadVersionSql("l")} AS version',
  );
  assert.ok(
    /version: stringOrEmpty\(lead\.version\)/.test(fetchLead),
    "fetchAdminLead must map version through stringOrEmpty, never a date helper",
  );

  for (const line of server.split("\n").filter((l) => l.includes("version"))) {
    assert.doesNotMatch(
      line,
      /rowDate\(|dateOrNull\(|new Date\(/,
      `admin-data.server.ts must not parse the lead version as a date: ${line.trim()}`,
    );
  }

  const route = readFileSync(join(root, "src/routes/admin.leads.tsx"), "utf8");
  for (const line of route.split("\n").filter((l) => l.includes("version"))) {
    assert.doesNotMatch(
      line,
      /new Date\(|Date\.parse\(/,
      `admin.leads.tsx must treat the lead version as an opaque string: ${line.trim()}`,
    );
  }
});
