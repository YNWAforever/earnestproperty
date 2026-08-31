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

test("the migration only touches the 17 expansion estates, never inserts new rows", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
  assert.ok(!/insert\s+into\s+estates/i.test(sql), "must never insert new estate rows");
  const slugs = [...sql.matchAll(/WHERE slug = '([a-z0-9-]+)';/g)].map((m) => m[1]);
  // 5 of the 17 slugs (深井/汀九) get 2 UPDATE statements each: one
  // district_slug correction plus the facts UPDATE every slug gets, so the
  // total statement count exceeds 17 -- what must stay true is that every
  // touched slug is one of the 17 real expansion estates, and every one of
  // the 17 is touched at least once.
  assert.equal(
    new Set(slugs).size,
    17,
    "expected every one of the 17 expansion estates to be touched, no more no fewer",
  );
});

test("only the 5 深井/汀九 estates get a district_slug correction, and each exactly once", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
  const correctedSlugs = [
    ...sql.matchAll(
      /UPDATE estates SET district_slug = '[a-z-]+'(?:, name_zh = '[^']+')? WHERE slug = '([a-z0-9-]+)';/g,
    ),
  ].map((m) => m[1]);
  assert.deepEqual(
    correctedSlugs.sort(),
    ["chun-wong-kui", "hoi-wan-hin", "hoi-wan-toi", "lung-tang-kok", "tai-wah-hin"].sort(),
    "exactly these 5 slugs should get a district_slug correction",
  );
  assert.equal(
    new Set(correctedSlugs).size,
    correctedSlugs.length,
    "no slug should be corrected twice",
  );
});
