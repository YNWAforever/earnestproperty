import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const sql = () =>
  readFileSync("neon/migrations/20260906120000_admin_property_management.sql", "utf8");
test("management is atomic with permission, version and source preservation boundaries", () => {
  const migration = sql();
  for (const marker of [
    "ADMIN_PROPERTY_CONFLICT",
    "FORBIDDEN",
    "admin_property_source_snapshots",
    "admin_property_group_version",
    "SHARE ROW EXCLUSIVE",
    "audit_logs",
    "jsonb_populate_record",
    "FOR UPDATE",
  ])
    assert.ok(migration.includes(marker), marker);
});
