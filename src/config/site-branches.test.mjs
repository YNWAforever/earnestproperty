import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const moduleUrl = new URL("./site-branches.js", import.meta.url);
const root = process.cwd();

test("estate mapping wins over the district default", async () => {
  assert.equal(existsSync(moduleUrl), true, "site branch resolver must exist");
  const { SITE_BRANCHES, resolveBranchContact } = await import(moduleUrl);
  const fallback = { id: "general" };

  const contact = resolveBranchContact({
    branches: SITE_BRANCHES,
    fallback,
    estateSlug: "rhine-garden",
    districtSlug: "sham-tseng",
  });

  assert.equal(contact.id, "rhine");
});

test("estate and district mappings resolve every approved branch", async () => {
  assert.equal(existsSync(moduleUrl), true, "site branch resolver must exist");
  const { SITE_BRANCHES, resolveBranchContact } = await import(moduleUrl);
  const fallback = { id: "general" };

  for (const estateSlug of ["bellagio", "sea-crest-villa", "lido-garden"]) {
    assert.equal(
      resolveBranchContact({ branches: SITE_BRANCHES, fallback, estateSlug }).id,
      "lido",
    );
  }
  for (const estateSlug of ["rhine-garden", "sea-pearl-garden"]) {
    assert.equal(
      resolveBranchContact({ branches: SITE_BRANCHES, fallback, estateSlug }).id,
      "rhine",
    );
  }
  assert.equal(
    resolveBranchContact({
      branches: SITE_BRANCHES,
      fallback,
      estateSlug: "hong-kong-garden",
    }).id,
    "hong-kong-garden",
  );
  assert.equal(
    resolveBranchContact({ branches: SITE_BRANCHES, fallback, districtSlug: "sham-tseng" }).id,
    "lido",
  );
  assert.equal(
    resolveBranchContact({ branches: SITE_BRANCHES, fallback, districtSlug: "ting-kau" }).id,
    "hong-kong-garden",
  );
});

test("unknown and empty locations use the general contact fallback", async () => {
  assert.equal(existsSync(moduleUrl), true, "site branch resolver must exist");
  const { SITE_BRANCHES, resolveBranchContact } = await import(moduleUrl);
  const fallback = { id: "general", phone: "general-phone" };

  assert.equal(
    resolveBranchContact({
      branches: SITE_BRANCHES,
      fallback,
      estateSlug: "unknown-estate",
      districtSlug: "unknown-district",
    }),
    fallback,
  );
  assert.equal(resolveBranchContact({ branches: SITE_BRANCHES, fallback }), fallback);
});

// 20260830160000_branches_entity.sql's job is to mirror SITE_BRANCHES into a
// real `branches` table -- this is the "migration-content contract test"
// asserting the seed INSERT's literal values actually match the config
// (rather than trusting the migration author copied every id/name/address/
// phone right), matching this repo's established pattern for asserting
// migration file contents (see agent-profiles.contract.test.mjs's migration
// tests for the same technique).
test("the branches table migration seeds exactly SITE_BRANCHES's id/name/address/phone", async () => {
  const { SITE_BRANCHES } = await import(moduleUrl);
  const migrationPath = join(root, "neon/migrations/20260830160000_branches_entity.sql");
  assert.equal(existsSync(migrationPath), true, "branches entity migration must exist");
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS branches/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches\(id\)/);
  // Additive/nullable, never backfilled -- the exact discipline this whole
  // migration exists to protect (see CHANGELOG.md:79-87 and this file's
  // header comment).
  assert.doesNotMatch(sql, /UPDATE staff_users SET branch_id/);
  assert.doesNotMatch(sql, /branch_id UUID NOT NULL/);

  const insertMatch = sql.match(/INSERT INTO branches[\s\S]*?ON CONFLICT \(slug\) DO NOTHING;/);
  assert.ok(insertMatch, "expected the seed INSERT for branches");
  const insertSql = insertMatch[0];

  assert.equal(SITE_BRANCHES.length, 3, "sanity check on the known roster before comparing");
  for (const branch of SITE_BRANCHES) {
    assert.ok(insertSql.includes(`'${branch.id}'`), `missing seed row for slug ${branch.id}`);
    assert.ok(insertSql.includes(`'${branch.name}'`), `missing seed name for ${branch.id}`);
    assert.ok(insertSql.includes(`'${branch.address}'`), `missing seed address for ${branch.id}`);
    assert.ok(insertSql.includes(`'${branch.phone}'`), `missing seed phone for ${branch.id}`);
  }
});
