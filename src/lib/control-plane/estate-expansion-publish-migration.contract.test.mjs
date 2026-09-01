import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(import.meta.dirname, "../../../neon/migrations");
const migrationFile = readdirSync(MIGRATIONS_DIR).find((name) =>
  name.endsWith("_estate_expansion_publish.sql"),
);

const EXPANSION_SLUGS = [
  "hoi-wan-hin",
  "tai-wah-hin",
  "hoi-wan-toi",
  "chun-wong-kui",
  "lung-tang-kok",
  "mun-ming-shan",
  "wong-gam-hoi-ngon",
  "oi-kam-hoi-ngon",
  "tai-yu",
  "wong-gam-hoi-waan",
  "sing-tai",
  "seong-yuen",
  "the-carmel",
  "oma-oma",
  "lin-shan",
  "long-tou-waan",
  "tai-tou-waan",
];

test("the publish migration exists", () => {
  assert.ok(migrationFile, "expected a migration file ending in _estate_expansion_publish.sql");
});

test("the migration sets published = true for exactly the 17 expansion slugs, no more no fewer", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
  const slugs = [...sql.matchAll(/WHERE slug (?:= '([a-z0-9-]+)'|IN \(([^)]+)\))/g)].flatMap((m) =>
    m[1] ? [m[1]] : m[2].split(",").map((s) => s.trim().replace(/^'|'$/g, "")),
  );
  assert.deepEqual(slugs.sort(), [...EXPANSION_SLUGS].sort());
});

test("the migration never touches verified_at, facts columns, district_slug, or name_zh", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
  assert.ok(!/verified_at/i.test(sql), "must never touch verified_at");
  assert.ok(!/address\s*=/i.test(sql), "must never touch address");
  assert.ok(!/developer\s*=/i.test(sql), "must never touch developer");
  assert.ok(!/district_slug\s*=/i.test(sql), "must never touch district_slug");
  assert.ok(!/name_zh\s*=/i.test(sql), "must never touch name_zh");
  assert.ok(!/avg_saleable_psf/i.test(sql), "must never touch avg_saleable_psf");
});

test("every SET clause in the migration only ever sets published = true", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
  const setClauses = [...sql.matchAll(/UPDATE estates SET (.+?) WHERE/gs)].map((m) => m[1].trim());
  for (const clause of setClauses) {
    assert.equal(clause.replace(/\s+/g, " "), "published = true");
  }
});

test("the migration is registered in migration-versions.js", async () => {
  const { MIGRATION_VERSIONS } = await import("./migration-versions.js");
  assert.ok(MIGRATION_VERSIONS.some((v) => v.includes("estate_expansion_publish")));
});
