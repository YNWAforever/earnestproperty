import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const channelId = "UCTwcj9hcQoKVpKEZY-ZgnwA";
const videoIds = ["AAAAAAAAAAA", "BBBBBBBBBBB", "CCCCCCCCCCC"];
const manualUrl = "https://youtu.be/AAAAAAAAAAA";
const nullDescriptionManualUrl = "https://youtube.com/watch?v=CCCCCCCCCCC";

function video(videoId, title) {
  return {
    videoId,
    title,
    description: `${title} YouTube description`,
    publishedAt: "2026-08-01T00:00:00.000Z",
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function fakeClient(videos, pages = 1) {
  return {
    async listUploads(input) {
      for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
        await input.onPage?.({ pageNumber, itemCount: pageNumber === pages ? videos.length : 0 });
      }
      return { videos, pages, boundaryFound: false };
    },
  };
}

function fixedNow(value) {
  return () => new Date(value);
}

const controlledTimers = {
  setInterval() {
    return Symbol("controlled YouTube sync timer");
  },
  clearInterval() {},
};

const silentLogger = {
  info() {},
  error() {},
};

test(
  "fake YouTube plus controlled time proves the disposable database lifecycle and rollback",
  { skip: !testDatabaseUrl },
  async () => {
    assert.ok(testDatabaseUrl);

    const migrationEnv = {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
      DATABASE_URL_UNPOOLED: "",
    };
    delete migrationEnv.UNPOOLED_DATABASE_URL;
    const migration = spawnSync(process.execPath, ["scripts/neon/apply-migrations.mjs"], {
      env: migrationEnv,
      encoding: "utf8",
    });
    assert.equal(migration.status, 0, "Disposable test database migration failed.");

    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousDatabaseUrlUnpooled = process.env.DATABASE_URL_UNPOOLED;
    const previousUnpooledDatabaseUrl = process.env.UNPOOLED_DATABASE_URL;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DATABASE_URL_UNPOOLED = "";
    delete process.env.UNPOOLED_DATABASE_URL;

    let cleanup = async () => {};

    try {
      const { queryRows } = await import("../neon/db.server.ts");
      const { createYouTubeSyncRepository } = await import("./youtube-repository.server.ts");
      const { runYouTubeSync } = await import("./youtube-sync.server.ts");
      cleanup = async () => {
        await queryRows(
          `DELETE FROM cms_videos
           WHERE youtube_video_id = ANY($1::text[]) OR video_url = ANY($2::text[])`,
          [videoIds, [manualUrl, nullDescriptionManualUrl]],
        );
        await queryRows("DELETE FROM youtube_sync_state WHERE channel_id = $1", [channelId]);
      };

      await cleanup();

      const unrelatedManagedRows = await queryRows(
        `SELECT id
         FROM cms_videos
         WHERE youtube_managed = true
           AND (youtube_video_id IS NULL OR NOT (youtube_video_id = ANY($1::text[])))
         LIMIT 1`,
        [videoIds],
      );
      assert.equal(
        unrelatedManagedRows.length,
        0,
        "Disposable database contains unrelated YouTube-managed rows.",
      );

      const manualRows = await queryRows(
        `INSERT INTO cms_videos
           (title, video_url, description, sort_order, published)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id::text AS id`,
        ["Manual title", manualUrl, "Staff description", 7, false],
      );
      const manualId = manualRows[0].id;
      const nullDescriptionRows = await queryRows(
        `INSERT INTO cms_videos
           (title, video_url, description, sort_order, published)
         VALUES ($1, $2, NULL, $3, $4)
         RETURNING id::text AS id`,
        ["Null-description manual title", nullDescriptionManualUrl, 9, true],
      );
      const nullDescriptionManualId = nullDescriptionRows[0].id;

      const initial = await runYouTubeSync(
        { mode: "incremental", trigger: "staff" },
        {
          channelId,
          now: fixedNow("2026-08-02T00:00:00.000Z"),
          client: fakeClient(
            [
              video("AAAAAAAAAAA", "Adopted title"),
              video("BBBBBBBBBBB", "Inserted title"),
              video("CCCCCCCCCCC", "First adopted description"),
            ],
            2,
          ),
          repository: createYouTubeSyncRepository({ queryRows }),
          timers: controlledTimers,
          logger: silentLogger,
        },
      );
      assert.equal(initial.status, "completed");
      assert.equal(initial.summary.adopted, 2);
      assert.equal(initial.summary.inserted, 1);

      let adopted = await queryRows(
        `SELECT id::text AS id, title, video_url, description, sort_order, published,
                youtube_managed, youtube_available, youtube_missing_full_runs
         FROM cms_videos WHERE youtube_video_id = 'AAAAAAAAAAA'`,
      );
      assert.equal(adopted[0].id, manualId);
      assert.equal(adopted[0].title, "Adopted title");
      assert.equal(adopted[0].video_url, "https://www.youtube.com/watch?v=AAAAAAAAAAA");
      assert.equal(adopted[0].description, "Staff description");
      assert.equal(adopted[0].sort_order, 7);
      assert.equal(adopted[0].published, false);
      assert.equal(adopted[0].youtube_managed, true);
      assert.equal(adopted[0].youtube_available, true);
      assert.equal(adopted[0].youtube_missing_full_runs, 0);

      let nullDescriptionAdopted = await queryRows(
        `SELECT id::text AS id, description, sort_order, published
         FROM cms_videos WHERE youtube_video_id = 'CCCCCCCCCCC'`,
      );
      assert.equal(nullDescriptionAdopted[0].id, nullDescriptionManualId);
      assert.equal(
        nullDescriptionAdopted[0].description,
        "First adopted description YouTube description",
      );
      assert.equal(nullDescriptionAdopted[0].sort_order, 9);
      assert.equal(nullDescriptionAdopted[0].published, true);

      const incremental = await runYouTubeSync(
        { mode: "incremental", trigger: "cron" },
        {
          channelId,
          now: fixedNow("2026-08-03T00:00:00.000Z"),
          client: fakeClient([
            video("AAAAAAAAAAA", "Incrementally refreshed adopted title"),
            video("BBBBBBBBBBB", "Incrementally refreshed inserted title"),
            video("CCCCCCCCCCC", "Incrementally changed description"),
          ]),
          repository: createYouTubeSyncRepository({ queryRows }),
          timers: controlledTimers,
          logger: silentLogger,
        },
      );
      assert.equal(incremental.status, "completed");
      assert.equal(incremental.summary.updated, 3);
      assert.equal(
        (await queryRows("SELECT title FROM cms_videos WHERE youtube_video_id = 'BBBBBBBBBBB'"))[0]
          .title,
        "Incrementally refreshed inserted title",
      );

      const augustFull = {
        channelId,
        now: fixedNow("2026-08-03T21:00:00.000Z"),
        client: fakeClient([
          video("AAAAAAAAAAA", "August title"),
          video("CCCCCCCCCCC", "Changed upstream description"),
        ]),
        timers: controlledTimers,
        logger: silentLogger,
      };
      await runYouTubeSync(
        { mode: "full", trigger: "cron" },
        { ...augustFull, repository: createYouTubeSyncRepository({ queryRows }) },
      );
      await runYouTubeSync(
        { mode: "full", trigger: "staff" },
        { ...augustFull, repository: createYouTubeSyncRepository({ queryRows }) },
      );
      let missing = await queryRows(
        `SELECT youtube_missing_full_runs, youtube_available
         FROM cms_videos WHERE youtube_video_id = 'BBBBBBBBBBB'`,
      );
      assert.equal(missing[0].youtube_missing_full_runs, 1);
      assert.equal(missing[0].youtube_available, true);
      nullDescriptionAdopted = await queryRows(
        `SELECT description FROM cms_videos WHERE youtube_video_id = 'CCCCCCCCCCC'`,
      );
      assert.equal(
        nullDescriptionAdopted[0].description,
        "First adopted description YouTube description",
      );

      await runYouTubeSync(
        { mode: "full", trigger: "cron" },
        {
          channelId,
          now: fixedNow("2026-09-02T21:00:00.000Z"),
          client: fakeClient([
            video("AAAAAAAAAAA", "September title"),
            video("CCCCCCCCCCC", "September upstream description"),
          ]),
          repository: createYouTubeSyncRepository({ queryRows }),
          timers: controlledTimers,
          logger: silentLogger,
        },
      );
      missing = await queryRows(
        `SELECT youtube_missing_full_runs, youtube_available
         FROM cms_videos WHERE youtube_video_id = 'BBBBBBBBBBB'`,
      );
      assert.equal(missing[0].youtube_missing_full_runs, 2);
      assert.equal(missing[0].youtube_available, false);

      const restored = await runYouTubeSync(
        { mode: "full", trigger: "staff" },
        {
          channelId,
          now: fixedNow("2026-10-02T21:00:00.000Z"),
          client: fakeClient([
            video("AAAAAAAAAAA", "October title"),
            video("BBBBBBBBBBB", "Returned title"),
            video("CCCCCCCCCCC", "October upstream description"),
          ]),
          repository: createYouTubeSyncRepository({ queryRows }),
          timers: controlledTimers,
          logger: silentLogger,
        },
      );
      assert.equal(restored.status, "completed");
      assert.equal(restored.summary.restored, 1);
      missing = await queryRows(
        `SELECT youtube_missing_full_runs, youtube_available
         FROM cms_videos WHERE youtube_video_id = 'BBBBBBBBBBB'`,
      );
      assert.equal(missing[0].youtube_missing_full_runs, 0);
      assert.equal(missing[0].youtube_available, true);

      adopted = await queryRows(
        `SELECT description, sort_order, published
         FROM cms_videos WHERE youtube_video_id = 'AAAAAAAAAAA'`,
      );
      assert.equal(adopted[0].description, "Staff description");
      assert.equal(adopted[0].sort_order, 7);
      assert.equal(adopted[0].published, false);

      const visible = await queryRows(
        `SELECT youtube_video_id
         FROM cms_videos
         WHERE published = true
           AND (youtube_managed = false OR youtube_available = true)
           AND youtube_video_id = ANY($1::text[])
         ORDER BY sort_order ASC, COALESCE(youtube_published_at, created_at) DESC`,
        [videoIds],
      );
      assert.deepEqual(
        visible.map((row) => row.youtube_video_id),
        ["CCCCCCCCCCC", "BBBBBBBBBBB"],
      );

      await queryRows("DELETE FROM cms_videos WHERE youtube_video_id = $1", ["CCCCCCCCCCC"]);
      const repository = createYouTubeSyncRepository({ queryRows });
      const rollbackOwner = crypto.randomUUID();
      const rollbackNow = new Date("2026-10-03T00:00:00.000Z");
      assert.ok(
        await repository.acquireLease({ channelId, owner: rollbackOwner, now: rollbackNow }),
      );
      try {
        const stateBefore = await queryRows(
          `SELECT last_incremental_video_id, last_full_period::text AS last_full_period
           FROM youtube_sync_state WHERE channel_id = $1`,
          [channelId],
        );
        const existingBefore = await queryRows(
          `SELECT title FROM cms_videos WHERE youtube_video_id = 'BBBBBBBBBBB'`,
        );
        await assert.rejects(() =>
          repository.applySnapshot({
            channelId,
            owner: rollbackOwner,
            mode: "incremental",
            completedAt: rollbackNow,
            newestVideoId: "CCCCCCCCCCC",
            period: null,
            videos: [
              {
                ...video("CCCCCCCCCCC", "Rollback sentinel"),
                adoptionId: null,
                expectedManualUrl: null,
              },
              {
                ...video("BBBBBBBBBBB", "Invalid rollback row"),
                title: null,
                adoptionId: null,
                expectedManualUrl: null,
              },
            ],
          }),
        );
        const stateAfter = await queryRows(
          `SELECT last_incremental_video_id, last_full_period::text AS last_full_period
           FROM youtube_sync_state WHERE channel_id = $1`,
          [channelId],
        );
        assert.deepEqual(stateAfter, stateBefore);
        assert.deepEqual(
          await queryRows(`SELECT title FROM cms_videos WHERE youtube_video_id = 'BBBBBBBBBBB'`),
          existingBefore,
        );
        assert.equal(
          (await queryRows("SELECT id FROM cms_videos WHERE youtube_video_id = 'CCCCCCCCCCC'"))
            .length,
          0,
        );
      } finally {
        await repository.releaseLease({ channelId, owner: rollbackOwner, now: rollbackNow });
      }
    } finally {
      try {
        await cleanup();
      } finally {
        if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previousDatabaseUrl;
        if (previousDatabaseUrlUnpooled === undefined) delete process.env.DATABASE_URL_UNPOOLED;
        else process.env.DATABASE_URL_UNPOOLED = previousDatabaseUrlUnpooled;
        if (previousUnpooledDatabaseUrl === undefined) delete process.env.UNPOOLED_DATABASE_URL;
        else process.env.UNPOOLED_DATABASE_URL = previousUnpooledDatabaseUrl;
      }
    }
  },
);
