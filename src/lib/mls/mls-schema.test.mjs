import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { MIGRATION_VERSIONS } from "../control-plane/migration-versions.js";

const version = "20260817120000_dual_source_listing_sync.sql";
const sql = readFileSync(new URL(`../../../neon/migrations/${version}`, import.meta.url), "utf8");

test("dual-source migration is registered", () => {
  assert.ok(MIGRATION_VERSIONS.includes(version));
});

test("dual-source migration creates every persistence boundary", () => {
  for (const relation of [
    "listing_sync_runs",
    "listing_source_observations",
    "property_source_links",
    "property_sync_fields",
    "property_sync_state",
    "listing_change_events",
    "listing_media_records",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${relation}\\b`, "i"), relation);
  }
  assert.match(sql, /ADD COLUMN IF NOT EXISTS canonical_property_no TEXT/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS content_hash TEXT/i);
  assert.match(sql, /baseline_approved_by TEXT/i);
});

test("source IDs are unique without overloading legacy_detail_id", () => {
  assert.match(sql, /UNIQUE \(source, external_listing_id, deal_type\)/i);
  assert.doesNotMatch(sql, /DROP CONSTRAINT properties_legacy_detail_deal_type_key/i);
  assert.match(sql, /discovered_at TIMESTAMPTZ NOT NULL/i);
  assert.match(sql, /parse_warnings TEXT\[\] NOT NULL/i);
  assert.match(sql, /property_id UUID REFERENCES properties\(id\) ON DELETE SET NULL/i);
});

test("lifecycle state uses inactive rather than a new delisted enum", () => {
  assert.doesNotMatch(sql, /ALTER TYPE property_status ADD VALUE ['"]delisted/i);
  assert.match(sql, /consecutive_absent_healthy_runs/i);
});

test("canonical property numbers remove whitespace with PostgreSQL's whitespace pattern", () => {
  assert.match(sql, /regexp_replace\(trim\(legacy_property_no\), '\\s\+', '', 'g'\)/i);
  assert.doesNotMatch(sql, /regexp_replace\(trim\(legacy_property_no\), '\\\\s\+', '', 'g'\)/i);
});
