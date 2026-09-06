import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { MIGRATION_VERSIONS } from "../control-plane/migration-versions.js";
const version = "20260907120000_propertyhk_ingestion_v2.sql";
const path = new URL(`../../../neon/migrations/${version}`, import.meta.url);
const sql = existsSync(path) ? readFileSync(path, "utf8") : "";
test("v2 ingestion migration is registered and uses the existing table writer gate", () => {
  assert.ok(MIGRATION_VERSIONS.includes(version));
  assert.match(sql, /LOCK TABLE properties IN SHARE ROW EXCLUSIVE MODE/i);
});
test("v2 receipts, policy, scope, source state and sidecars have persistence boundaries", () => {
  for (const table of [
    "mls_ingestion_policies",
    "mls_ingestion_scopes",
    "mls_ingestion_receipts",
    "mls_source_state",
    "mls_source_contacts",
    "mls_ingestion_conflicts",
    "mls_ingestion_reviews",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, "i"));
  }
  assert.match(sql, /UNIQUE \(source, scope_id, scraped_at\)/i);
  assert.match(sql, /owner TEXT NOT NULL DEFAULT 'disabled'/i);
  assert.match(sql, /publish_enabled BOOLEAN NOT NULL DEFAULT false/i);
  assert.match(sql, /last_accepted_at TIMESTAMPTZ/i);
  assert.match(sql, /full_receipt_id UUID REFERENCES mls_ingestion_receipts/i);
  assert.match(sql, /PRIMARY KEY \(source, external_listing_id, deal_type\)/i);
});
test("legacy observations and links are extended without removing historical source identity", () => {
  assert.match(sql, /source IN \('old_site', '28hse_agent_540', 'propertyhk'\)/i);
  assert.match(sql, /ALTER COLUMN match_key DROP NOT NULL/i);
  assert.match(sql, /'source_id_v2', 'exact_unit_v2'/i);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM properties\b/i);
});
test("v2 public identity cannot fall back to canonical number and issued membership survives updates", () => {
  assert.match(sql, /candidate\.ingestion_identity_policy = 'no-hermes-v2'/i);
  assert.match(sql, /VALUES \(candidate\.listing_no, NULL\)/i);
  assert.match(
    sql,
    /IF NEW\.ingestion_identity_policy = 'no-hermes-v2' THEN[\s\S]*?assign_property_public_identity\(NEW\.id\);[\s\S]*?RETURN NEW;/i,
  );
});
test("ownership fence gates legacy writes and adoption while retaining explicit admin writes", () => {
  assert.match(
    sql,
    /CREATE TRIGGER aaa_mls_ingestion_owner_fence BEFORE INSERT OR UPDATE OR DELETE/i,
  );
  assert.match(sql, /current_setting\('app\.mls_writer_policy', true\)/i);
  assert.match(sql, /current_setting\('app\.admin_property_write', true\)/i);
  assert.match(sql, /current_setting\('app\.staff_property_handover', true\)/i);
  assert.match(sql, /RAISE EXCEPTION 'MLS_INGESTION_OWNERSHIP_CONFLICT'/i);
  assert.doesNotMatch(sql, /^UPDATE properties SET ingestion_owner/gim);
});
test("new v2 rows cannot inherit an unrelated canonical-number group's staff overrides", () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION admin_property_protect_source\(\)/i);
  assert.match(
    sql,
    /IF NEW\.ingestion_identity_policy = 'no-hermes-v2' THEN[\s\S]*?v_no := coalesce\(v_no, NEW\.listing_no\);[\s\S]*?ELSIF v_no IS NULL THEN/i,
  );
});
test("v2 migration declares safe deployment boundary and retryable named DDL", () => {
  assert.match(sql, /dedicated client transaction/i);
  assert.doesNotMatch(sql, /migration runner's transaction/i);
  assert.match(sql, /DROP TRIGGER IF EXISTS aaa_mls_ingestion_owner_fence ON properties/i);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS property_source_links_match_evidence_check/i);
});
test("known scopes are paired with their source and conflicts retain review decisions", () => {
  assert.match(sql, /source = '28hse_agent_540' AND scope_id = 'agent:540'/i);
  assert.match(sql, /source = 'propertyhk' AND scope_id = 'branches:EPW,EPS,EPT'/i);
  assert.match(sql, /resolution TEXT NOT NULL DEFAULT 'keep_28hse'/i);
  assert.match(sql, /review_status TEXT NOT NULL DEFAULT 'unreviewed'/i);
});
