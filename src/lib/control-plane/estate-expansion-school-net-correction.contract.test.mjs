import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(import.meta.dirname, "../../../neon/migrations");
const migrationFile = readdirSync(MIGRATIONS_DIR).find((name) =>
  name.endsWith("_estate_expansion_school_net_correction.sql"),
);

const EXPANSION_SLUGS = new Set([
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
]);

test("the school net correction migration exists", () => {
  assert.ok(
    migrationFile,
    "expected a migration file ending in _estate_expansion_school_net_correction.sql",
  );
});

test("only touches school_net_code, on estate-expansion slugs, to a known net", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
  const statements = [...sql.matchAll(/UPDATE estates SET ([^;]+) WHERE slug = '([a-z0-9-]+)';/g)];
  for (const [, setClause, slug] of statements) {
    assert.match(
      setClause.trim(),
      /^school_net_code = '(62|71)'$/,
      `${slug}'s UPDATE must set only school_net_code, to '62' or '71'`,
    );
    assert.ok(EXPANSION_SLUGS.has(slug), `${slug} must be one of the 17 expansion estates`);
  }
});

test("never touches published, verified_at, or any fact/photo column", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
  assert.ok(!/published\s*=/i.test(sql), "must never touch published");
  assert.ok(!/verified_at\s*=/i.test(sql), "must never touch verified_at");
  assert.ok(!/avg_saleable_psf|developer|area_min|area_max|blocks\s*=/i.test(sql));
});

test("with zero corrections, the header states all 17 estates were checked", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
  const statements = [...sql.matchAll(/UPDATE estates SET [^;]+ WHERE slug = '[a-z0-9-]+';/g)];
  if (statements.length > 0) return; // this file currently has corrections; not applicable

  assert.match(
    sql,
    /all 17.*(confirmed|checked)/i,
    "the header comment must explicitly state all 17 estates were checked/confirmed",
  );
  for (const slug of EXPANSION_SLUGS) {
    assert.ok(sql.includes(slug), `${slug} should be named somewhere in the verification file`);
  }
});

test("each UPDATE statement is preceded by a non-empty source-citing comment", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
  const statements = [...sql.matchAll(/UPDATE estates SET [^;]+ WHERE slug = '[a-z0-9-]+';/g)];
  for (const match of statements) {
    const linesBefore = sql.slice(0, match.index).split("\n");
    const precedingLine = (linesBefore[linesBefore.length - 2] ?? "").trim();
    assert.match(
      precedingLine,
      /^--\s*\S/,
      `the statement "${match[0]}" must have a non-empty "--" citation comment on the line immediately above it`,
    );
  }
});

test("the migration is registered in migration-versions.js", async () => {
  const { MIGRATION_VERSIONS } = await import("./migration-versions.js");
  assert.ok(
    MIGRATION_VERSIONS.some((v) => v.includes("estate_expansion_school_net_correction")),
    "the new migration filename must be registered",
  );
});
