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

/** Each `UPDATE crm_leads` statement, sliced up to its first RETURNING, WHERE or `;`. */
function crmLeadUpdates(path) {
  const text = readFileSync(join(root, path), "utf8");
  const found = [];
  const update = /UPDATE\s+crm_leads\b/gi;
  let match;
  while ((match = update.exec(text))) {
    const rest = text.slice(match.index);
    const end = rest.search(/\bRETURNING\b|\bWHERE\b|;/i);
    found.push(end === -1 ? rest : rest.slice(0, end));
  }
  return found;
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
      assert.match(
        slice,
        /updated_at/,
        `${relative(root, join(root, path))}: ${BUMP_RULE}\n${slice}`,
      );
    }
  }
  assert.ok(seen >= 3, "expected the single-lead, bulk and live-agent lead updates to be scanned");

  const handover = staffReassignStatements("a", "b").find((entry) =>
    /UPDATE\s+crm_leads\b/.test(entry.statement),
  );
  assert.ok(handover, "staff handover must reassign crm_leads");
  assert.match(handover.statement, /updated_at/, `staffReassignStatements: ${BUMP_RULE}`);
});

test("no non-lead writer touches crm_leads", () => {
  for (const path of [
    "src/lib/ai/crm-enrichment.server.ts",
    "src/lib/neon/whatsapp-consent.server.ts",
  ]) {
    const text = readFileSync(join(root, path), "utf8");
    assert.doesNotMatch(
      text,
      /UPDATE\s+crm_leads\b/i,
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
