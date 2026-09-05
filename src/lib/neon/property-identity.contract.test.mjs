import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const migration = "neon/migrations/20260906040000_property_public_identity.sql";

test("property public identity migration is additive and preserves source offerings", () => {
  const sql = read(migration);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS property_public_groups/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS property_public_members/i);
  assert.match(sql, /REFERENCES properties\s*\(id\)/i);
  assert.match(sql, /CREATE TRIGGER assign_property_public_identity_after_insert/i);
  assert.match(sql, /review_required/i);
  assert.doesNotMatch(sql, /(?:DELETE\s+FROM|DROP\s+TABLE|TRUNCATE)\s+properties\b/i);
  assert.doesNotMatch(sql, /UPDATE\s+properties\b/i);
});

test("identity assignment rejects physical conflicts and ambiguous null bridges", () => {
  const sql = read(migration);
  for (const fact of [
    "estate_id",
    "district_slug",
    "saleable_area",
    "gross_area",
    "bedrooms",
    "regexp_replace\\(trim\\(candidate\\.floor\\)",
  ]) {
    assert.match(sql, new RegExp(fact, "i"));
  }
  assert.match(sql, /compatible_group_count\s*=\s*1/i);
  assert.match(sql, /public_listing_no\s*:=\s*candidate\.listing_no/i);
});

test("public property reads rank offerings before filters, count groups, and keep aliases", () => {
  const source = read("src/lib/neon/public-data.server.ts");
  assert.match(source, /PARTITION BY ppm\.public_listing_no, p\.deal_type/i);
  assert.match(source, /offering_rank\s*=\s*1/i);
  assert.match(source, /count\(\*\)::int AS total FROM eligible_groups/i);
  assert.match(source, /jsonb_build_object\([\s\S]*?'id'[\s\S]*?'listing_no'[\s\S]*?'deal_type'/i);
  assert.match(source, /requested\.listing_no = \$1 OR requested_public\.public_listing_no = \$1/i);
});

test("public row transport exposes stable identity and original offerings", () => {
  const types = read("src/lib/neon/public-data.types.ts");
  assert.match(types, /export type PropertyOffering\s*=\s*\{/);
  assert.match(types, /public_listing_no\?: string/);
  assert.ok(types.includes("listing_aliases?: string[];"));
  assert.ok(types.includes("offerings?: PropertyOffering[];"));
});
