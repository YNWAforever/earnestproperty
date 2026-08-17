import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "bun:test";

import { createYouTubeSyncRepository } from "./youtube-repository.server";

const channelId = "UCTwcj9hcQoKVpKEZY-ZgnwA";
const owner = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-08-17T00:00:00.000Z");

test("lease acquisition is an atomic expired-or-empty claim", async () => {
  const calls: Array<{ statement: string; params: unknown[] }> = [];
  const repository = createYouTubeSyncRepository({
    queryRows: async (statement, params = []) => {
      calls.push({ statement, params });
      return [
        {
          channel_id: channelId,
          last_incremental_video_id: "AAAAAAAAAAA",
          last_full_period: "2026-07-01",
        },
      ];
    },
  });
  const lease = await repository.acquireLease({ channelId, owner, now });
  assert.equal(lease?.lastIncrementalVideoId, "AAAAAAAAAAA");
  assert.match(calls[0].statement, /ON CONFLICT \(channel_id\) DO UPDATE/i);
  assert.match(calls[0].statement, /lease_expires_at <= \$3::timestamptz/i);
  assert.equal(calls[0].params[1], owner);
});

test("renew and release require the same token", async () => {
  const statements: string[] = [];
  const repository = createYouTubeSyncRepository({
    queryRows: async (statement) => {
      statements.push(statement);
      return [{ renewed: true }];
    },
  });
  assert.equal(await repository.renewLease({ channelId, owner, now }), true);
  await repository.releaseLease({ channelId, owner, now });
  assert.match(statements[0], /lease_owner = \$2::uuid/);
  assert.match(statements[0], /lease_expires_at > \$3::timestamptz/);
  assert.match(statements[1], /lease_owner = \$2::uuid/);
});

test("repository source keeps writes set-based, guarded, reversible, and description-safe", () => {
  const source = readFileSync(new URL("./youtube-repository.server.ts", import.meta.url), "utf8");
  assert.match(source, /jsonb_to_recordset/);
  assert.match(source, /ON CONFLICT \(youtube_video_id\)/);
  assert.match(source, /COALESCE\(target\.description, incoming\.description\)/);
  assert.match(source, /youtube_missing_full_runs \+ 1/);
  assert.match(source, /last_full_period IS DISTINCT FROM/);
  assert.match(source, /lease_owner = \$2::uuid/);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+cms_videos/i);
});

test("a lost lease is reported instead of accepting zero guarded writes", async () => {
  const repository = createYouTubeSyncRepository({
    queryRows: async () => [
      {
        lease_ok: false,
        state_updates: 0,
        inserted: 0,
        adopted: 0,
        updated: 0,
        restored: 0,
        unavailable: 0,
      },
    ],
  });
  await assert.rejects(
    () =>
      repository.applySnapshot({
        channelId,
        owner,
        mode: "incremental",
        videos: [],
        newestVideoId: null,
        completedAt: now,
        period: null,
      }),
    (error) => error instanceof Error && "code" in error && error.code === "youtube_lease_lost",
  );
});
