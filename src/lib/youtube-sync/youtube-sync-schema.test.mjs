import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { MIGRATION_VERSIONS } from "../control-plane/migration-versions.js";

const version = "20260817130000_youtube_channel_sync.sql";
const sql = readFileSync(new URL(`../../../neon/migrations/${version}`, import.meta.url), "utf8");

test("YouTube synchronization migration is registered", () => {
  assert.ok(MIGRATION_VERSIONS.includes(version));
});

test("cms_videos gains stable YouTube identity and availability state", () => {
  for (const column of [
    "youtube_video_id text",
    "youtube_published_at timestamptz",
    "youtube_managed boolean",
    "youtube_available boolean",
    "youtube_last_seen_at timestamptz",
    "youtube_missing_full_runs smallint",
  ]) {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`, "i"), column);
  }
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS cms_videos_youtube_video_id_key/i);
  assert.match(sql, /WHERE youtube_video_id IS NOT NULL/i);
  assert.match(sql, /youtube_missing_full_runs >= 0/i);
});

test("sync state stores one tokenized lease and both completion boundaries per channel", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS youtube_sync_state/i);
  assert.match(sql, /channel_id text PRIMARY KEY/i);
  assert.match(sql, /lease_owner uuid/i);
  assert.match(sql, /lease_expires_at timestamptz/i);
  assert.match(sql, /last_incremental_video_id text/i);
  assert.match(sql, /last_incremental_completed_at timestamptz/i);
  assert.match(sql, /last_full_completed_at timestamptz/i);
  assert.match(sql, /last_full_period date/i);
});

test("migration is additive and never deletes video rows", () => {
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+cms_videos/i);
  assert.doesNotMatch(sql, /DROP\s+TABLE\s+cms_videos/i);
  assert.match(sql, /youtube_managed boolean NOT NULL DEFAULT false/i);
  assert.match(sql, /youtube_available boolean NOT NULL DEFAULT true/i);
});
