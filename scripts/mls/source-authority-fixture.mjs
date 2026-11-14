import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { splitSqlStatements } from "../acceptance/migrated-schema.mjs";

// Legacy isolated schemas intentionally omit the later WhatsApp dependencies.
// Apply only the actual additive column DDL needed by the shared public selector;
// the complete migration and replacement functions run in the full owned suites.
export async function applySourceAuthorityColumn(client) {
  const sql = await readFile(
    new URL("../../neon/migrations/20261114040000_property_source_authority.sql", import.meta.url),
    "utf8",
  );
  const statements = splitSqlStatements(sql);
  const firstFunction = statements.findIndex((statement) =>
    /^CREATE OR REPLACE FUNCTION\b/i.test(statement),
  );
  const columns = statements.slice(0, firstFunction);
  assert.equal(columns.length, 2, "Source authority migration column prefix changed");
  assert.match(columns[0], /^ALTER TABLE properties ADD COLUMN IF NOT EXISTS source_authority\b/i);
  assert.match(columns[1], /^COMMENT ON COLUMN properties\.source_authority\b/i);
  for (const statement of columns) await client.query(statement);
}
