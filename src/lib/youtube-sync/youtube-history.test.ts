import assert from "node:assert/strict";
import { test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import { createYouTubeSyncHistory } from "./youtube-history.server";
import { runYouTubeSync } from "./youtube-sync.server";
import { YOUTUBE_CHANNEL_ID, YouTubeSyncError } from "./youtube-sync.types";

test("run records distinguish failed attempts, success, partial commit and interrupted runs", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE ops_audit_logs (
        id uuid DEFAULT gen_random_uuid(), actor_staff_id uuid, permission text, action text,
        resource_type text, resource_id text, outcome text, request_id uuid, metadata jsonb,
        created_at timestamptz DEFAULT clock_timestamp()
      );
      CREATE TABLE youtube_sync_state (
        channel_id text, lease_owner uuid, lease_expires_at timestamptz
      );
    `);
    const history = createYouTubeSyncHistory(
      async (sql, params = []) => (await db.query<Record<string, unknown>>(sql, params)).rows,
    );
    assert.equal((await history.readStatus()).status, "never");
    const channelId = YOUTUBE_CHANNEL_ID;
    const now = new Date("2026-10-16T00:00:00Z");
    let run = 0;
    let providerFailure = false;
    let cleanupFailure = false;
    let applied = 0;
    const repository = {
      acquireLease: async () => ({
        channelId,
        owner: "11111111-1111-4111-8111-111111111111",
        lastIncrementalVideoId: null,
        lastFullPeriod: null,
      }),
      renewLease: async () => true,
      releaseLease: async () => {
        if (cleanupFailure) throw new Error("secret must never appear");
      },
      listManualCandidates: async () => [],
      applySnapshot: async () => {
        applied++;
        return { inserted: 1, adopted: 0, updated: 0, restored: 0, unavailable: 0 };
      },
    };
    const execute = () =>
      runYouTubeSync(
        { mode: "incremental", trigger: "cron" },
        {
          now: () => new Date(now.getTime() + run * 1000),
          owner: () => `${String(++run).padStart(8, "0")}-1111-4111-8111-111111111111`,
          history,
          repository,
          client: {
            listUploads: async () => {
              if (providerFailure)
                throw new YouTubeSyncError("youtube_quota_exhausted", "secret API key");
              return { videos: [], pages: 1, boundaryFound: false };
            },
          },
          logger: { info() {}, error() {} },
        },
      );
    await execute();
    const success = await history.readStatus();
    assert.equal(success.status, "completed");
    assert.equal(success.inserted, 1);
    assert.equal(success.failed, 0);
    assert.ok(success.lastSuccess);
    providerFailure = true;
    await assert.rejects(execute);
    const failed = await history.readStatus();
    assert.equal(failed.status, "failed");
    assert.equal(failed.failed, null, "unknown number of failed videos must stay unknown");
    assert.equal(failed.code, "youtube_quota_exhausted");
    assert.equal(failed.lastSuccess, success.lastSuccess);
    assert.equal(applied, 1, "failed provider read must not commit anything");
    providerFailure = false;
    cleanupFailure = true;
    await assert.rejects(execute);
    const partial = await history.readStatus();
    assert.equal(partial.status, "partial");
    assert.equal(partial.inserted, 1);
    assert.equal(partial.lastSuccess, success.lastSuccess);
    assert.doesNotMatch(
      JSON.stringify((await db.query("SELECT metadata FROM ops_audit_logs")).rows),
      /secret|API key/,
    );
    await history.started({
      runId: "99999999-1111-4111-8111-111111111111",
      channelId,
      startedAt: new Date(),
      mode: "incremental",
      trigger: "cron",
    });
    assert.equal((await history.readStatus()).status, "interrupted");
  } finally {
    await db.close();
  }
});
