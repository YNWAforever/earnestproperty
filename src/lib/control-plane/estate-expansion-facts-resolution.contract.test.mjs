import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(import.meta.dirname, "../../../neon/migrations");
const migrationFile = readdirSync(MIGRATIONS_DIR).find((name) =>
  name.endsWith("_estate_expansion_facts_resolution.sql"),
);

// slug -> the one field the data pack documented as disputed for it. An
// UPDATE that resolves a conflict may only ever set that slug's own disputed
// field -- setting some other field on a documented-conflict slug (or the
// right field on the wrong slug) is exactly the mix-up this guard exists to
// catch, so slug and field are checked as a pair, not as independent sets.
const EXPECTED_FIELD_BY_SLUG = new Map([
  ["lung-tang-kok", "developer"],
  ["sing-tai", "area_max"],
  ["seong-yuen", "blocks"],
  ["tai-tou-waan", "area_max"],
]);

// Matches one UPDATE statement whether it is written on a single line or
// spread across several -- the style the sibling migration this one follows
// up on, 20260901100000_estate_expansion_facts.sql, actually uses:
// `UPDATE estates SET\n  field = value\nWHERE slug = '...';`. `[^;]` already
// matches newlines, so no `s` flag is needed; the lazy `+?` stops the value
// at the first following `WHERE slug = '...';`, which is also what keeps two
// back-to-back statements from being swallowed into one match (values here
// never contain a literal semicolon).
const UPDATE_STATEMENT_REGEX =
  /UPDATE estates SET\s+(\w+)\s*=\s*[^;]+?\s*WHERE slug = '([a-z0-9-]+)';/g;

test("the facts resolution migration exists", () => {
  assert.ok(
    migrationFile,
    "expected a migration file ending in _estate_expansion_facts_resolution.sql",
  );
});

test("only touches the 4 documented conflict slugs, each with exactly its own disputed field", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
  const statements = [...sql.matchAll(UPDATE_STATEMENT_REGEX)];
  for (const [, field, slug] of statements) {
    const expectedField = EXPECTED_FIELD_BY_SLUG.get(slug);
    assert.ok(expectedField, `${slug} must be one of the 4 documented conflicts`);
    assert.equal(
      field,
      expectedField,
      `${slug}'s documented conflict is ${expectedField}, not ${field}`,
    );
  }
});

test("never seeds avg_saleable_psf, price, listing counts, transactions, published, verified_at, or new rows", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
  assert.ok(!/avg_saleable_psf\s*=/i.test(sql));
  assert.ok(!sql.toLowerCase().includes("insert into transactions"));
  assert.ok(!/insert\s+into\s+estates/i.test(sql), "must never insert new estate rows");
  assert.ok(!/insert\s+into\s+\w+/i.test(sql), "must never insert rows into any table");
  assert.ok(!/published\s*=\s*true/i.test(sql));
  assert.ok(!/verified_at\s*=\s*(now\(\)|'[^']+')/i.test(sql));
});

test("the migration is registered in migration-versions.js", async () => {
  const { MIGRATION_VERSIONS } = await import("./migration-versions.js");
  assert.ok(
    MIGRATION_VERSIONS.some((v) => v.includes("estate_expansion_facts_resolution")),
    "the new migration filename must be registered",
  );
});

test("every UPDATE statement has a non-empty citation comment immediately above it", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
  const lines = sql.split("\n");
  for (const match of sql.matchAll(UPDATE_STATEMENT_REGEX)) {
    const startLineIndex = sql.slice(0, match.index).split("\n").length - 1;
    let precedingLine = "";
    for (let j = startLineIndex - 1; j >= 0; j -= 1) {
      if (lines[j].trim() === "") continue;
      precedingLine = lines[j];
      break;
    }
    const trimmed = precedingLine.trim();
    const commentBody = trimmed.startsWith("--") ? trimmed.slice(2).trim() : "";
    assert.ok(
      commentBody,
      `expected a non-empty citation comment immediately above: ${match[0].split("\n")[0]}...`,
    );
  }
});

test("every one of the 4 conflict slugs is mentioned somewhere in the migration, resolved or not", () => {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, migrationFile), "utf8");
  for (const slug of EXPECTED_FIELD_BY_SLUG.keys()) {
    assert.ok(
      sql.includes(slug),
      `expected ${slug} to appear in the migration (as an UPDATE target or a comment explaining why it stays unresolved)`,
    );
  }
});
