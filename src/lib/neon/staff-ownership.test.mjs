import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  STAFF_HISTORICAL_COLUMNS,
  STAFF_OWNERSHIP_COLUMNS,
  staffOwnershipCountSql,
  staffReassignStatements,
} from "./staff-ownership.ts";

test("ownership covers exactly the six current-assignment columns", () => {
  assert.deepEqual(
    STAFF_OWNERSHIP_COLUMNS.map((entry) => `${entry.table}.${entry.column}`).sort(),
    [
      "crm_contacts.assigned_agent_id",
      "crm_leads.assigned_agent_id",
      "inquiries.assigned_agent_id",
      "live_agent_sessions.assigned_agent_id",
      "properties.agent_id",
      "whatsapp_conversations.assigned_agent_id",
    ],
  );
});

test("reassignment touches every ownership column and no historical column", () => {
  const statements = staffReassignStatements("from-id", "to-id");
  assert.equal(statements.length, STAFF_OWNERSHIP_COLUMNS.length);

  for (const { table, column } of STAFF_OWNERSHIP_COLUMNS) {
    const match = statements.find((entry) => entry.statement.includes(`UPDATE ${table}`));
    assert.ok(match, `${table} must be reassigned`);
    assert.match(match.statement, new RegExp(`SET ${column} = \\$2`));
    assert.match(match.statement, new RegExp(`WHERE ${column} = \\$1`));
    assert.deepEqual(match.params, ["from-id", "to-id"]);
  }

  // Rewriting any of these would falsify who did something.
  const allSql = statements.map((entry) => entry.statement).join("\n");
  for (const historical of STAFF_HISTORICAL_COLUMNS) {
    assert.doesNotMatch(
      allSql,
      new RegExp(`SET ${historical}\\b`),
      `${historical} records history and must never be reassigned`,
    );
  }
});

test("historical columns and ownership columns do not overlap", () => {
  const owned = new Set(STAFF_OWNERSHIP_COLUMNS.map((entry) => entry.column));
  for (const historical of STAFF_HISTORICAL_COLUMNS) {
    assert.equal(owned.has(historical), false, `${historical} cannot be both`);
  }
  // Thirteen distinct names across nineteen FK occurrences -- several tables
  // share a name such as `created_by`.
  assert.equal(STAFF_HISTORICAL_COLUMNS.length, 13);
});

test("count SQL pairs each table with its own column, not a copy-pasted one", () => {
  const { statement, params } = staffOwnershipCountSql("staff-id");
  assert.deepEqual(params, ["staff-id"]);
  for (const { table, column } of STAFF_OWNERSHIP_COLUMNS) {
    // Asserting FROM <table> and AS <table> in isolation would still pass if
    // every subquery were copy-pasted with the same WHERE column -- the
    // counts would be wrong but every table/alias would still be present.
    // Anchoring the column inside the same subquery as its table closes that.
    assert.match(
      statement,
      new RegExp(
        `\\(SELECT count\\(\\*\\)::int FROM ${table} WHERE ${column} = \\$1::uuid\\) AS ${table}\\b`,
      ),
      `${table} must be counted by its own column (${column}), not another table's`,
    );
  }
});

const DEFAULT_MIGRATIONS_DIR = join(import.meta.dirname, "..", "..", "..", "neon", "migrations");

/**
 * Strip `--` line comments while staying quote-aware, so a comment marker
 * inside a string literal doesn't truncate real SQL and a real `--` outside
 * one does get removed. Mirrors the comment/quote/dollar-tag handling in
 * `splitSqlStatements` (scripts/neon/apply-migrations.mjs) rather than
 * reusing it directly: that function is unexported and its module has
 * top-level side effects (reads .env files, throws without DATABASE_URL,
 * opens a real Neon connection) that make it unsafe to import into a unit
 * test. Keeping this repo to one comment-handling algorithm, mirrored here
 * deliberately, is the point -- not a shortcut around it.
 *
 * Unlike `splitSqlStatements`, this returns text (not statements) with line
 * structure preserved, since the caller below walks the file line by line.
 */
function stripSqlComments(text) {
  let out = "";
  let singleQuoted = false;
  let doubleQuoted = false;
  let dollarTag = null;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (!singleQuoted && !doubleQuoted && !dollarTag && char === "-" && next === "-") {
      const end = text.indexOf("\n", index + 2);
      if (end === -1) break; // comment runs to EOF with no trailing newline
      index = end - 1; // loop's `index += 1` lands on the newline itself, preserving it
      continue;
    }

    if (!doubleQuoted && !dollarTag && char === "'" && text[index - 1] !== "\\") {
      singleQuoted = !singleQuoted;
      out += char;
      continue;
    }

    if (!singleQuoted && !dollarTag && char === '"') {
      doubleQuoted = !doubleQuoted;
      out += char;
      continue;
    }

    if (!singleQuoted && !doubleQuoted && char === "$") {
      const match = text.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        const tag = match[0];
        if (!dollarTag) {
          dollarTag = tag;
        } else if (dollarTag === tag) {
          dollarTag = null;
        }
        out += tag;
        index += tag.length - 1;
        continue;
      }
    }

    out += char;
  }

  return out;
}

/**
 * Ground truth: every `REFERENCES staff_users` column actually declared in
 * `migrationsDir` (defaults to neon/migrations/*.sql), resolved back to its
 * owning table by walking to the nearest preceding CREATE TABLE / ALTER
 * TABLE statement in the same file.
 *
 * This is the same manual method used in review to catch the
 * `live_agent_sessions.assigned_agent_id` gap -- automated here so the next
 * new FK doesn't depend on a human remembering to re-run it. The
 * `migrationsDir` parameter exists so the parser itself is testable against
 * fixture SQL, independent of whatever the real schema currently contains.
 */
function staffForeignKeysInMigrations(migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const refs = [];
  for (const file of files) {
    const text = stripSqlComments(readFileSync(join(migrationsDir, file), "utf8"));
    const lines = text.split("\n");
    let currentTable = null;
    for (const rawLine of lines) {
      const line = rawLine.trim();

      // Both regexes only anchor the table-name token at the start of the
      // line -- neither `continue`s early, so a table declared and
      // referenced on the very same line (e.g. a one-line
      // `ALTER TABLE t ADD COLUMN c UUID REFERENCES staff_users(id)`) still
      // falls through to the REFERENCES check below instead of being
      // silently dropped.
      const createMatch = line.match(/^CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-zA-Z0-9_]+)/i);
      if (createMatch) currentTable = createMatch[1];

      const alterMatch = line.match(/^ALTER TABLE\s+([a-zA-Z0-9_]+)/i);
      if (alterMatch) currentTable = alterMatch[1];

      if (!line.includes("REFERENCES staff_users")) continue;

      // The column name is whatever token sits right before the UUID type.
      const tokens = line.split(/\s+/);
      const uuidIndex = tokens.findIndex((token) => token.toLowerCase() === "uuid");
      const column = uuidIndex > 0 ? tokens[uuidIndex - 1] : null;
      if (!currentTable || !column) {
        throw new Error(
          `staffForeignKeysInMigrations: could not resolve a table/column for a ` +
            `"REFERENCES staff_users" line in ${file}: "${line}". The parser in ` +
            `staff-ownership.test.mjs expects "<column> UUID ... REFERENCES staff_users" inside a ` +
            `CREATE TABLE or ALTER TABLE statement -- fix the parser (or the migration) rather than ` +
            `silently skipping this line.`,
        );
      }
      refs.push({ table: currentTable, column, file });
    }
  }
  return refs;
}

test("staffForeignKeysInMigrations resolves a same-line ALTER TABLE ADD COLUMN and ignores comments", () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "staff-ownership-fixture-"));
  try {
    writeFileSync(
      join(fixtureDir, "0001_fixture.sql"),
      [
        "CREATE TABLE IF NOT EXISTS widgets (",
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid()",
        ");",
        "",
        "-- Bug 1 regression: table name and REFERENCES staff_users on the very",
        "-- same ALTER TABLE ... ADD COLUMN line, not on separate lines.",
        "ALTER TABLE widgets ADD COLUMN owner_id UUID REFERENCES staff_users(id) ON DELETE SET NULL;",
        "",
        "CREATE TABLE IF NOT EXISTS gadgets (",
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),",
        "  -- Bug 2 regression: a commented-out FK must not produce a phantom ref.",
        "  -- legacy_owner_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,",
        "  owner_id UUID REFERENCES staff_users(id) ON DELETE SET NULL -- trailing comment says staff_users too",
        ");",
        "",
      ].join("\n"),
    );

    const refs = staffForeignKeysInMigrations(fixtureDir);

    assert.deepEqual(
      refs.map(({ table, column }) => `${table}.${column}`),
      ["widgets.owner_id", "gadgets.owner_id"],
      "expected exactly the two real references, in file order, with no phantom or dropped entries",
    );
    assert.ok(
      !refs.some((ref) => ref.column === "legacy_owner_id"),
      "a commented-out REFERENCES staff_users line must never be treated as a real reference",
    );
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("every REFERENCES staff_users column in the schema is classified as ownership or history", () => {
  const schemaRefs = staffForeignKeysInMigrations();
  assert.ok(
    schemaRefs.length > 0,
    "found zero REFERENCES staff_users lines in neon/migrations/*.sql -- the parser above is almost " +
      "certainly broken, not the schema; fix it before trusting this test",
  );

  const ownershipKeys = new Set(
    STAFF_OWNERSHIP_COLUMNS.map((entry) => `${entry.table}.${entry.column}`),
  );
  const historicalNames = new Set(STAFF_HISTORICAL_COLUMNS);

  // Forward: every staff_users FK the schema actually has must be accounted
  // for in exactly one list. Classification is by the (table, column) pair
  // for ownership and by column name alone for history -- never by column
  // name for ownership, since that heuristic is exactly what would let a
  // future `owner_staff_id` slip in unclassified.
  const unclassified = schemaRefs.filter(({ table, column }) => {
    const isOwnership = ownershipKeys.has(`${table}.${column}`);
    const isHistorical = historicalNames.has(column);
    return isOwnership === isHistorical; // false/false (missing) or true/true (ambiguous)
  });
  assert.deepEqual(
    unclassified,
    [],
    `${unclassified.map((r) => `${r.table}.${r.column} (found in ${r.file})`).join(", ")} -- ` +
      `new column(s) referencing staff_users(id) that are not in STAFF_OWNERSHIP_COLUMNS or ` +
      `STAFF_HISTORICAL_COLUMNS in src/lib/neon/staff-ownership.ts. A human has to decide: does this ` +
      `column mean "this row is currently owned by / assigned to a staff member" (add { table, ` +
      `column } to STAFF_OWNERSHIP_COLUMNS so a deactivation handover reassigns it), or does it just ` +
      `record who did something once, like created_by or sent_by (add the column name to ` +
      `STAFF_HISTORICAL_COLUMNS so it is never rewritten)? Do not guess from the column name alone -- ` +
      `read the migration and decide.`,
  );

  // Reverse: every column this module claims as current ownership must still
  // exist in the schema with that exact table/column pairing. A stale entry
  // here would make staffReassignStatements silently UPDATE a table/column
  // that no longer means what the comment says it means.
  const schemaKeys = new Set(schemaRefs.map(({ table, column }) => `${table}.${column}`));
  const stale = STAFF_OWNERSHIP_COLUMNS.filter(
    ({ table, column }) => !schemaKeys.has(`${table}.${column}`),
  );
  assert.deepEqual(
    stale,
    [],
    `${stale.map((r) => `${r.table}.${r.column}`).join(", ")} -- listed in ` +
      `STAFF_OWNERSHIP_COLUMNS in src/lib/neon/staff-ownership.ts, but no matching ` +
      `"<column> UUID ... REFERENCES staff_users" was found on that table in neon/migrations/*.sql. ` +
      `The column was likely dropped, renamed, or moved to a differently named table in a later ` +
      `migration -- update or remove this entry.`,
  );
});
