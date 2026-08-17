import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "bun:test";

import { createYouTubeClient } from "./youtube-client.server";
import { runYouTubeSync } from "./youtube-sync.server";
import { canonicalYouTubeUrl } from "./youtube-reconciliation";
import {
  YOUTUBE_LEASE_RENEWAL_MS,
  YouTubeSyncError,
  type YouTubeVideo,
} from "./youtube-sync.types";

const channelId = "UCTwcj9hcQoKVpKEZY-ZgnwA";
const video: YouTubeVideo = {
  videoId: "AAAAAAAAAAA",
  title: "Latest title",
  description: "YouTube description",
  publishedAt: "2026-08-01T00:00:00.000Z",
  canonicalUrl: canonicalYouTubeUrl("AAAAAAAAAAA"),
};

function clock(values: string[]) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}

test("contention skips cron without calling YouTube", async () => {
  let fetched = false;
  const result = await runYouTubeSync(
    { mode: "incremental", trigger: "cron" },
    {
      channelId,
      owner: () => "11111111-1111-4111-8111-111111111111",
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      client: {
        listUploads: async () => {
          fetched = true;
          return { videos: [], pages: 0, boundaryFound: false };
        },
      },
      repository: {
        acquireLease: async () => null,
        renewLease: async () => true,
        releaseLease: async () => {},
        listManualCandidates: async () => [],
        applySnapshot: async () => ({
          inserted: 0,
          adopted: 0,
          updated: 0,
          restored: 0,
          unavailable: 0,
        }),
      },
    },
  );
  assert.deepEqual(result, { status: "skipped", reason: "sync_in_progress" });
  assert.equal(fetched, false);
});

test("incremental mode uses the saved boundary, renews, adopts, and summarizes", async () => {
  const events: string[] = [];
  const logs: Array<Record<string, unknown>> = [];
  let boundary: string | null | undefined;
  const result = await runYouTubeSync(
    { mode: "incremental", trigger: "staff" },
    {
      channelId,
      owner: () => "11111111-1111-4111-8111-111111111111",
      logger: {
        info: (entry) => logs.push(entry),
        error: (entry) => logs.push(entry),
      },
      now: clock([
        "2026-08-17T00:00:00.000Z",
        "2026-08-17T00:00:01.000Z",
        "2026-08-17T00:00:02.000Z",
        "2026-08-17T00:00:03.000Z",
        "2026-08-17T00:00:04.000Z",
      ]),
      client: {
        listUploads: async (input) => {
          boundary = input.boundaryVideoId;
          await input.onPage?.({ pageNumber: 1, itemCount: 1 });
          return { videos: [video], pages: 1, boundaryFound: true };
        },
      },
      repository: {
        acquireLease: async () => ({
          channelId,
          owner: "11111111-1111-4111-8111-111111111111",
          lastIncrementalVideoId: "BBBBBBBBBBB",
          lastFullPeriod: "2026-07-01",
        }),
        renewLease: async () => {
          events.push("renew");
          return true;
        },
        releaseLease: async () => {
          events.push("release");
        },
        listManualCandidates: async () => [
          {
            id: "22222222-2222-4222-8222-222222222222",
            videoUrl: "https://youtu.be/AAAAAAAAAAA",
          },
        ],
        applySnapshot: async (input) => {
          events.push(`apply:${input.videos[0].adoptionId}`);
          assert.equal(input.newestVideoId, "AAAAAAAAAAA");
          assert.equal(input.period, null);
          return { inserted: 0, adopted: 1, updated: 0, restored: 0, unavailable: 0 };
        },
      },
    },
  );

  assert.equal(boundary, "BBBBBBBBBBB");
  assert.deepEqual(events, [
    "renew",
    "renew",
    "apply:22222222-2222-4222-8222-222222222222",
    "release",
  ]);
  assert.equal(result.status, "completed");
  if (result.status === "completed") {
    assert.equal(result.summary.adopted, 1);
    assert.equal(result.summary.fetched, 1);
    assert.equal(result.summary.period, null);
  }
  assert.equal(logs.length, 1);
  assert.equal(logs[0].event, "youtube_sync_completed");
  assert.doesNotMatch(JSON.stringify(logs), /description|apiKey|authorization/i);
});

test("provider failure releases the lease and never applies a snapshot", async () => {
  const events: string[] = [];
  await assert.rejects(
    () =>
      runYouTubeSync(
        { mode: "full", trigger: "cron" },
        {
          channelId,
          owner: () => "11111111-1111-4111-8111-111111111111",
          now: () => new Date("2026-09-01T21:00:00.000Z"),
          client: {
            listUploads: async () => {
              throw new YouTubeSyncError(
                "youtube_unavailable",
                "YouTube is temporarily unavailable.",
                true,
              );
            },
          },
          repository: {
            acquireLease: async () => ({
              channelId,
              owner: "11111111-1111-4111-8111-111111111111",
              lastIncrementalVideoId: null,
              lastFullPeriod: null,
            }),
            renewLease: async () => true,
            releaseLease: async () => {
              events.push("release");
            },
            listManualCandidates: async () => [],
            applySnapshot: async () => {
              events.push("apply");
              return { inserted: 0, adopted: 0, updated: 0, restored: 0, unavailable: 0 };
            },
          },
        },
      ),
    (error) => error instanceof Error && "code" in error && error.code === "youtube_unavailable",
  );
  assert.deepEqual(events, ["release"]);
});

test("malformed provider envelopes never reach snapshot reconciliation", async () => {
  let applies = 0;

  for (const playlistPage of [
    {
      items: [
        {
          snippet: {
            channelId,
            videoOwnerChannelId: channelId,
            title: "Latest title",
            description: "YouTube description",
            publishedAt: "0",
            resourceId: { videoId: "AAAAAAAAAAA" },
          },
          contentDetails: { videoId: "AAAAAAAAAAA", videoPublishedAt: "0" },
        },
      ],
    },
    { items: [], nextPageToken: 1 },
  ]) {
    const responses = [
      {
        items: [
          {
            id: channelId,
            contentDetails: { relatedPlaylists: { uploads: "CANONICAL_UPLOADS_PLAYLIST" } },
          },
        ],
      },
      playlistPage,
    ];
    const fetchImpl = Object.assign(
      async () => new Response(JSON.stringify(responses.shift()), { status: 200 }),
      { preconnect: fetch.preconnect },
    ) as typeof fetch;

    await assert.rejects(
      () =>
        runYouTubeSync(
          { mode: "full", trigger: "cron" },
          {
            channelId,
            owner: () => "11111111-1111-4111-8111-111111111111",
            now: () => new Date("2026-08-17T00:00:00.000Z"),
            client: createYouTubeClient({ apiKey: "test-key-never-log", channelId, fetchImpl }),
            repository: {
              acquireLease: async () => ({
                channelId,
                owner: "11111111-1111-4111-8111-111111111111",
                lastIncrementalVideoId: null,
                lastFullPeriod: null,
              }),
              renewLease: async () => true,
              releaseLease: async () => {},
              listManualCandidates: async () => [],
              applySnapshot: async () => {
                applies += 1;
                return { inserted: 0, adopted: 0, updated: 0, restored: 0, unavailable: 0 };
              },
            },
            logger: { info: () => {}, error: () => {} },
          },
        ),
      (error) =>
        error instanceof Error && "code" in error && error.code === "youtube_invalid_snapshot",
    );
  }

  assert.equal(applies, 0);
});

test("full mode uses no boundary and passes the Hong Kong month period", async () => {
  let appliedPeriod: string | null = null;
  await runYouTubeSync(
    { mode: "full", trigger: "cron" },
    {
      channelId,
      owner: () => "11111111-1111-4111-8111-111111111111",
      now: () => new Date("2026-08-31T21:00:00.000Z"),
      client: {
        listUploads: async (input) => {
          assert.equal(input.boundaryVideoId, null);
          return { videos: [video], pages: 1, boundaryFound: false };
        },
      },
      repository: {
        acquireLease: async () => ({
          channelId,
          owner: "11111111-1111-4111-8111-111111111111",
          lastIncrementalVideoId: "BBBBBBBBBBB",
          lastFullPeriod: "2026-08-01",
        }),
        renewLease: async () => true,
        releaseLease: async () => {},
        listManualCandidates: async () => [],
        applySnapshot: async (input) => {
          appliedPeriod = input.period;
          return { inserted: 1, adopted: 0, updated: 0, restored: 0, unavailable: 0 };
        },
      },
    },
  );
  assert.equal(appliedPeriod, "2026-09-01");
});

test("orchestrator keeps a three-minute background lease heartbeat", () => {
  const source = readFileSync(new URL("./youtube-sync.server.ts", import.meta.url), "utf8");
  assert.match(source, /setInterval/);
  assert.match(source, /YOUTUBE_LEASE_RENEWAL_MS/);
  assert.match(source, /heartbeat\.checkpoint\(\)/);
  assert.match(source, /heartbeat\.stop\(\)/);
});

test("a failed page renewal loses the lease before reads or writes", async () => {
  let manualReads = 0;
  let applies = 0;
  let releases = 0;
  await assert.rejects(
    () =>
      runYouTubeSync(
        { mode: "incremental", trigger: "cron" },
        {
          channelId,
          owner: () => "11111111-1111-4111-8111-111111111111",
          now: () => new Date("2026-08-17T00:00:00.000Z"),
          client: {
            listUploads: async (input) => {
              await input.onPage?.({ pageNumber: 1, itemCount: 1 });
              return { videos: [video], pages: 1, boundaryFound: false };
            },
          },
          repository: {
            acquireLease: async () => ({
              channelId,
              owner: "11111111-1111-4111-8111-111111111111",
              lastIncrementalVideoId: null,
              lastFullPeriod: null,
            }),
            renewLease: async () => false,
            releaseLease: async () => {
              releases += 1;
            },
            listManualCandidates: async () => {
              manualReads += 1;
              return [];
            },
            applySnapshot: async () => {
              applies += 1;
              return { inserted: 0, adopted: 0, updated: 0, restored: 0, unavailable: 0 };
            },
          },
        },
      ),
    (error) => error instanceof Error && "code" in error && error.code === "youtube_lease_lost",
  );
  assert.equal(manualReads, 0);
  assert.equal(applies, 0);
  assert.equal(releases, 1);
});

test("duplicate manual matches fail preflight and release without applying", async () => {
  let applies = 0;
  let releases = 0;
  await assert.rejects(
    () =>
      runYouTubeSync(
        { mode: "incremental", trigger: "staff" },
        {
          channelId,
          owner: () => "11111111-1111-4111-8111-111111111111",
          now: () => new Date("2026-08-17T00:00:00.000Z"),
          client: {
            listUploads: async () => ({ videos: [video], pages: 1, boundaryFound: false }),
          },
          repository: {
            acquireLease: async () => ({
              channelId,
              owner: "11111111-1111-4111-8111-111111111111",
              lastIncrementalVideoId: null,
              lastFullPeriod: null,
            }),
            renewLease: async () => true,
            releaseLease: async () => {
              releases += 1;
            },
            listManualCandidates: async () => [
              {
                id: "22222222-2222-4222-8222-222222222222",
                videoUrl: "https://youtu.be/AAAAAAAAAAA",
              },
              {
                id: "33333333-3333-4333-8333-333333333333",
                videoUrl: "https://youtube.com/watch?v=AAAAAAAAAAA",
              },
            ],
            applySnapshot: async () => {
              applies += 1;
              return { inserted: 0, adopted: 0, updated: 0, restored: 0, unavailable: 0 };
            },
          },
        },
      ),
    (error) =>
      error instanceof Error && "code" in error && error.code === "youtube_invalid_snapshot",
  );
  assert.equal(applies, 0);
  assert.equal(releases, 1);
});

test("a release failure does not mask the primary provider error", async () => {
  const providerError = new YouTubeSyncError(
    "youtube_unavailable",
    "YouTube is temporarily unavailable.",
    true,
  );
  await assert.rejects(
    () =>
      runYouTubeSync(
        { mode: "full", trigger: "cron" },
        {
          channelId,
          owner: () => "11111111-1111-4111-8111-111111111111",
          now: () => new Date("2026-09-01T21:00:00.000Z"),
          client: {
            listUploads: async () => {
              throw providerError;
            },
          },
          repository: {
            acquireLease: async () => ({
              channelId,
              owner: "11111111-1111-4111-8111-111111111111",
              lastIncrementalVideoId: null,
              lastFullPeriod: null,
            }),
            renewLease: async () => true,
            releaseLease: async () => {
              throw new Error("database release failed");
            },
            listManualCandidates: async () => [],
            applySnapshot: async () => ({
              inserted: 0,
              adopted: 0,
              updated: 0,
              restored: 0,
              unavailable: 0,
            }),
          },
        },
      ),
    (error) => error === providerError,
  );
});

test("a background renewal loss aborts at the next page checkpoint", async () => {
  let heartbeatTick: (() => void) | undefined;
  let renewalCount = 0;
  let manualReads = 0;
  let applies = 0;
  let releases = 0;
  let cleared = false;

  await assert.rejects(
    () =>
      runYouTubeSync(
        { mode: "incremental", trigger: "cron" },
        {
          channelId,
          owner: () => "11111111-1111-4111-8111-111111111111",
          now: () => new Date("2026-08-17T00:00:00.000Z"),
          timers: {
            setInterval: (callback, milliseconds) => {
              assert.equal(milliseconds, YOUTUBE_LEASE_RENEWAL_MS);
              heartbeatTick = callback;
              return Symbol("heartbeat");
            },
            clearInterval: () => {
              cleared = true;
            },
          },
          client: {
            listUploads: async (input) => {
              await input.onPage?.({ pageNumber: 1, itemCount: 1 });
              heartbeatTick?.();
              await input.onPage?.({ pageNumber: 2, itemCount: 1 });
              return { videos: [video], pages: 2, boundaryFound: false };
            },
          },
          repository: {
            acquireLease: async () => ({
              channelId,
              owner: "11111111-1111-4111-8111-111111111111",
              lastIncrementalVideoId: null,
              lastFullPeriod: null,
            }),
            renewLease: async () => {
              renewalCount += 1;
              return renewalCount === 1;
            },
            releaseLease: async () => {
              releases += 1;
            },
            listManualCandidates: async () => {
              manualReads += 1;
              return [];
            },
            applySnapshot: async () => {
              applies += 1;
              return { inserted: 0, adopted: 0, updated: 0, restored: 0, unavailable: 0 };
            },
          },
        },
      ),
    (error) => error instanceof Error && "code" in error && error.code === "youtube_lease_lost",
  );

  assert.equal(renewalCount, 2);
  assert.equal(manualReads, 0);
  assert.equal(applies, 0);
  assert.equal(releases, 1);
  assert.equal(cleared, true);
});

test("the default owner creates a valid UUID for lease acquisition", async () => {
  let acquiredOwner = "";

  await runYouTubeSync(
    { mode: "incremental", trigger: "cron" },
    {
      channelId,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      timers: {
        setInterval: () => Symbol("heartbeat"),
        clearInterval: () => {},
      },
      logger: {
        info: () => {},
        error: () => {},
      },
      client: {
        listUploads: async () => ({ videos: [], pages: 0, boundaryFound: false }),
      },
      repository: {
        acquireLease: async (input) => {
          acquiredOwner = input.owner;
          return {
            channelId,
            owner: input.owner,
            lastIncrementalVideoId: null,
            lastFullPeriod: null,
          };
        },
        renewLease: async () => true,
        releaseLease: async () => {},
        listManualCandidates: async () => [],
        applySnapshot: async () => ({
          inserted: 0,
          adopted: 0,
          updated: 0,
          restored: 0,
          unavailable: 0,
        }),
      },
    },
  );

  assert.match(
    acquiredOwner,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});

test("timer startup failure releases the acquired matching lease", async () => {
  const owner = "11111111-1111-4111-8111-111111111111";
  const startupError = new Error("timer startup failed");
  let releases = 0;

  await assert.rejects(
    () =>
      runYouTubeSync(
        { mode: "incremental", trigger: "cron" },
        {
          channelId,
          owner: () => owner,
          now: () => new Date("2026-08-17T00:00:00.000Z"),
          timers: {
            setInterval: () => {
              throw startupError;
            },
            clearInterval: () => {},
          },
          logger: {
            info: () => {},
            error: () => {},
          },
          client: {
            listUploads: async () => ({ videos: [], pages: 0, boundaryFound: false }),
          },
          repository: {
            acquireLease: async () => ({
              channelId,
              owner,
              lastIncrementalVideoId: null,
              lastFullPeriod: null,
            }),
            renewLease: async () => true,
            releaseLease: async (input) => {
              assert.equal(input.channelId, channelId);
              assert.equal(input.owner, owner);
              releases += 1;
            },
            listManualCandidates: async () => [],
            applySnapshot: async () => ({
              inserted: 0,
              adopted: 0,
              updated: 0,
              restored: 0,
              unavailable: 0,
            }),
          },
        },
      ),
    (error) => error === startupError,
  );

  assert.equal(releases, 1);
});

test("completion whitelists mutation counts from the repository boundary", async () => {
  const owner = "11111111-1111-4111-8111-111111111111";
  const logs: Array<Record<string, unknown>> = [];
  const result = await runYouTubeSync(
    { mode: "incremental", trigger: "staff" },
    {
      channelId,
      owner: () => owner,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      timers: {
        setInterval: () => Symbol("heartbeat"),
        clearInterval: () => {},
      },
      logger: {
        info: (entry) => logs.push(entry),
        error: (entry) => logs.push(entry),
      },
      client: {
        listUploads: async () => ({ videos: [video], pages: 1, boundaryFound: false }),
      },
      repository: {
        acquireLease: async () => ({
          channelId,
          owner,
          lastIncrementalVideoId: null,
          lastFullPeriod: null,
        }),
        renewLease: async () => true,
        releaseLease: async () => {},
        listManualCandidates: async () => [],
        applySnapshot: async () => ({
          inserted: 1,
          adopted: 0,
          updated: 0,
          restored: 0,
          unavailable: 0,
          description: "must not cross the orchestration boundary",
        }),
      },
    },
  );

  assert.equal(result.status, "completed");
  if (result.status === "completed") {
    assert.equal(result.summary.inserted, 1);
    assert.equal("description" in result.summary, false);
  }
  assert.equal(logs.length, 1);
  assert.equal(logs[0].event, "youtube_sync_completed");
  assert.equal("description" in logs[0], false);
  assert.doesNotMatch(JSON.stringify(logs), /must not cross/i);
});
