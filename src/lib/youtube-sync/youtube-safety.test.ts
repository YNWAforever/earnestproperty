import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { createYouTubeSyncRepository } from "./youtube-repository.server";

// No URL, environment, network client or disk: each case owns an in-memory DB.
test("atomic lease, reruns, no-op writes and temporary omissions are safe", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE cms_videos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL,
        video_url text NOT NULL, description text,
        sort_order integer, published boolean, created_at timestamptz, updated_at timestamptz
      );
    `);
    await db.exec(
      readFileSync(
        new URL(
          "../../../neon/migrations/20260817130000_youtube_channel_sync.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const repository = createYouTubeSyncRepository({
      queryRows: async (sql, params = []) =>
        (await db.query<Record<string, unknown>>(sql, params)).rows,
    });
    const now = new Date("2026-10-16T00:00:00Z");
    const channelId = "UCTwcj9hcQoKVpKEZY-ZgnwA";
    const owner = "11111111-1111-4111-8111-111111111111";
    const claims = await Promise.all([
      repository.acquireLease({ channelId, owner, now }),
      repository.acquireLease({ channelId, owner: "22222222-2222-4222-8222-222222222222", now }),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    const videos = ["VIDEO000001", "SHORTS00001"].map((videoId, index) => ({
      videoId,
      title: videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      description: "synthetic",
      publishedAt: `2026-10-${15 - index}T00:00:00.000Z`,
      adoptionId: null,
      expectedManualUrl: null,
    }));
    const input = {
      channelId,
      owner: claims.find(Boolean)!.owner,
      mode: "incremental" as const,
      videos,
      newestVideoId: videos[0].videoId,
      completedAt: now,
      period: null,
    };
    assert.equal((await repository.applySnapshot(input)).inserted, 2);
    const before = (await db.query("SELECT * FROM cms_videos ORDER BY youtube_video_id")).rows;
    const again = await repository.applySnapshot({
      ...input,
      completedAt: new Date(now.getTime() + 1000),
    });
    assert.equal(again.inserted, 0);
    assert.equal(again.updated, 0, "unchanged imports must not rewrite the catalogue");
    assert.deepEqual(
      (await db.query("SELECT * FROM cms_videos ORDER BY youtube_video_id")).rows,
      before,
    );
    await repository.applySnapshot({ ...input, videos: [videos[0]] });
    assert.equal(
      (await db.query("SELECT * FROM cms_videos WHERE youtube_available = true")).rows.length,
      2,
    );
    assert.equal((await db.query("SELECT * FROM cms_videos")).rows.length, 2);
    const ordered = (
      await db.query<{ youtube_video_id: string }>(`
      SELECT youtube_video_id FROM cms_videos WHERE published = true
        AND (youtube_managed = false OR youtube_available = true)
      ORDER BY sort_order ASC, COALESCE(youtube_published_at, created_at) DESC
    `)
    ).rows;
    assert.deepEqual(
      ordered.map((row) => row.youtube_video_id),
      ["VIDEO000001", "SHORTS00001"],
    );
    // The same actual SQL still performs full absence accounting only once per month.
    const full = { ...input, mode: "full" as const, videos: [videos[0]], period: "2026-10-01" };
    await repository.applySnapshot(full);
    await repository.applySnapshot(full);
    let missing = (
      await db.query<{ youtube_missing_full_runs: number; youtube_available: boolean }>(
        "SELECT youtube_missing_full_runs,youtube_available FROM cms_videos WHERE youtube_video_id='SHORTS00001'",
      )
    ).rows[0];
    assert.equal(missing.youtube_missing_full_runs, 1);
    assert.equal(missing.youtube_available, true);
    await repository.applySnapshot({ ...full, period: "2026-11-01" });
    missing = (
      await db.query<typeof missing>(
        "SELECT youtube_missing_full_runs,youtube_available FROM cms_videos WHERE youtube_video_id='SHORTS00001'",
      )
    ).rows[0];
    assert.equal(missing.youtube_missing_full_runs, 2);
    assert.equal(missing.youtube_available, false);
    const restored = await repository.applySnapshot(input);
    assert.equal(restored.restored, 1);
    assert.equal(restored.updated, 1);
    // A failed set-based mutation rolls every row and the checkpoint back.
    const stateBefore = (await db.query("SELECT * FROM youtube_sync_state")).rows;
    const catalogueBefore = (await db.query("SELECT * FROM cms_videos ORDER BY youtube_video_id"))
      .rows;
    await assert.rejects(() =>
      repository.applySnapshot({
        ...input,
        newestVideoId: "INVALID0001",
        videos: [
          { ...videos[0], title: "Should roll back" },
          { ...videos[1], title: null as unknown as string },
        ],
      }),
    );
    assert.deepEqual((await db.query("SELECT * FROM youtube_sync_state")).rows, stateBefore);
    assert.deepEqual(
      (await db.query("SELECT * FROM cms_videos ORDER BY youtube_video_id")).rows,
      catalogueBefore,
    );
  } finally {
    await db.close();
  }
});
