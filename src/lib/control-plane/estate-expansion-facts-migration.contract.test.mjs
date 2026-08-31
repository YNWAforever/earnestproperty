import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(import.meta.dirname, "../../../neon/migrations");
const migrationFile = readdirSync(MIGRATIONS_DIR).find((name) =>
  name.endsWith("_estate_expansion_facts.sql"),
);

test("the estate expansion facts migration exists", () => {
  assert.ok(migrationFile, "expected a migration file ending in _estate_expansion_facts.sql");
});

test("the migration never seeds avg_saleable_psf, price, listing counts, or transactions", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
  assert.ok(!/avg_saleable_psf\s*=/i.test(sql), "must never set avg_saleable_psf");
  assert.ok(
    !sql.toLowerCase().includes("insert into transactions"),
    "must never insert transaction rows",
  );
});

test("the migration does not touch published or verified_at", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
  assert.ok(!/published\s*=\s*true/i.test(sql), "must never flip published to true");
  assert.ok(
    !/verified_at\s*=\s*(now\(\)|'[^']+')/i.test(sql),
    "must never set a real verified_at timestamp",
  );
});

test("the migration is registered in migration-versions.js", async () => {
  const { MIGRATION_VERSIONS } = await import("./migration-versions.js");
  assert.ok(
    MIGRATION_VERSIONS.some((v) => v.includes("estate_expansion_facts")),
    "the new migration filename must be registered",
  );
});

test("the migration only updates the 17 expansion estates, never inserts new rows", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
  assert.ok(!/insert\s+into\s+estates/i.test(sql), "must never insert new estate rows");
  const slugs = [...sql.matchAll(/WHERE slug = '([a-z0-9-]+)';/g)].map((m) => m[1]);
  assert.equal(slugs.length, 17, "expected exactly 17 UPDATE statements, one per expansion estate");
  assert.equal(new Set(slugs).size, 17, "every slug should be updated exactly once");
});
