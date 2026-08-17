import assert from "node:assert/strict";
import { test } from "bun:test";

import { createYouTubeClient, readYouTubeSyncConfig } from "./youtube-client.server";

const channelId = "UCTwcj9hcQoKVpKEZY-ZgnwA";
const apiKey = "test-key-never-log";

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function channelResponse() {
  return json({
    items: [
      {
        id: channelId,
        contentDetails: { relatedPlaylists: { uploads: "CANONICAL_UPLOADS_PLAYLIST" } },
      },
    ],
  });
}

function playlistItem(videoId: string, title = videoId, owner = channelId) {
  return {
    snippet: {
      channelId,
      videoOwnerChannelId: owner,
      title,
      description: `${title} description`,
      publishedAt: "2026-08-01T00:00:00.000Z",
      resourceId: { videoId },
    },
    contentDetails: { videoId, videoPublishedAt: "2026-08-01T00:00:00.000Z" },
  };
}

function queuedFetch(responses: Response[]) {
  const urls: string[] = [];
  const fetchImpl = Object.assign(
    async (input: string | URL | Request) => {
      urls.push(String(input));
      const response = responses.shift();
      assert.ok(response, `unexpected fetch: ${String(input)}`);
      return response;
    },
    { preconnect: fetch.preconnect },
  ) satisfies typeof fetch;
  return { fetchImpl, urls };
}

test("configuration fails closed when the server-only key is missing", () => {
  assert.throws(
    () => readYouTubeSyncConfig({}),
    (error) => error instanceof Error && "code" in error && error.code === "youtube_auth_failed",
  );
});

test("client resolves the canonical uploads playlist and exhausts pages", async () => {
  const fake = queuedFetch([
    channelResponse(),
    json({ items: [playlistItem("AAAAAAAAAAA")], nextPageToken: "page-2" }),
    json({ items: [playlistItem("BBBBBBBBBBB")] }),
  ]);
  const pages: number[] = [];
  const client = createYouTubeClient({ apiKey, channelId, fetchImpl: fake.fetchImpl });
  const result = await client.listUploads({
    boundaryVideoId: null,
    onPage: async ({ pageNumber }) => {
      pages.push(pageNumber);
    },
  });

  assert.deepEqual(
    result.videos.map((item) => item.videoId),
    ["AAAAAAAAAAA", "BBBBBBBBBBB"],
  );
  assert.deepEqual(pages, [1, 2]);
  assert.equal(result.boundaryFound, false);
  assert.match(fake.urls[0], /youtube\/v3\/channels/);
  assert.match(fake.urls[0], /part=contentDetails/);
  assert.match(fake.urls[1], /playlistId=CANONICAL_UPLOADS_PLAYLIST/);
  assert.match(fake.urls[1], /maxResults=50/);
  assert.doesNotMatch(fake.urls.join("\n"), /UUtwcj9hcQoKVpKEZY-ZgnwA/);
});

test("incremental pagination includes the prior boundary and stops", async () => {
  const fake = queuedFetch([
    channelResponse(),
    json({
      items: [
        playlistItem("CCCCCCCCCCC"),
        playlistItem("BBBBBBBBBBB"),
        playlistItem("AAAAAAAAAAA"),
      ],
      nextPageToken: "older-page",
    }),
  ]);
  const client = createYouTubeClient({ apiKey, channelId, fetchImpl: fake.fetchImpl });
  const result = await client.listUploads({ boundaryVideoId: "BBBBBBBBBBB" });

  assert.deepEqual(
    result.videos.map((item) => item.videoId),
    ["CCCCCCCCCCC", "BBBBBBBBBBB"],
  );
  assert.equal(result.boundaryFound, true);
  assert.equal(result.pages, 1);
  assert.equal(fake.urls.length, 2);
});

test("a missing boundary falls back to a complete traversal", async () => {
  const fake = queuedFetch([
    channelResponse(),
    json({ items: [playlistItem("CCCCCCCCCCC")], nextPageToken: "older-page" }),
    json({ items: [playlistItem("BBBBBBBBBBB")] }),
  ]);
  const client = createYouTubeClient({ apiKey, channelId, fetchImpl: fake.fetchImpl });
  const result = await client.listUploads({ boundaryVideoId: "ZZZZZZZZZZZ" });
  assert.equal(result.boundaryFound, false);
  assert.equal(result.pages, 2);
  assert.equal(result.videos.length, 2);
});

test("repeated tokens and wrong-channel items invalidate the whole snapshot", async () => {
  const repeated = queuedFetch([
    channelResponse(),
    json({ items: [playlistItem("AAAAAAAAAAA")], nextPageToken: "repeat" }),
    json({ items: [playlistItem("BBBBBBBBBBB")], nextPageToken: "repeat" }),
  ]);
  await assert.rejects(
    () => createYouTubeClient({ apiKey, channelId, fetchImpl: repeated.fetchImpl }).listUploads({}),
    (error) =>
      error instanceof Error && "code" in error && error.code === "youtube_invalid_snapshot",
  );

  const wrongChannel = queuedFetch([
    channelResponse(),
    json({ items: [playlistItem("AAAAAAAAAAA", "Wrong", "UCwrongwrongwrongwrongwrong")] }),
  ]);
  await assert.rejects(
    () =>
      createYouTubeClient({ apiKey, channelId, fetchImpl: wrongChannel.fetchImpl }).listUploads({}),
    (error) =>
      error instanceof Error && "code" in error && error.code === "youtube_invalid_snapshot",
  );
});

test("429 and 5xx responses retry three additional times but quota 403 does not", async () => {
  const sleeps: number[] = [];
  const transient = queuedFetch([
    json({ error: { errors: [{ reason: "backendError" }] } }, 500),
    json({ error: { errors: [{ reason: "backendError" }] } }, 500),
    json({ error: { errors: [{ reason: "backendError" }] } }, 500),
    channelResponse(),
    json({ items: [] }),
  ]);
  const client = createYouTubeClient({
    apiKey,
    channelId,
    fetchImpl: transient.fetchImpl,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    random: () => 0,
  });
  await client.listUploads({});
  assert.deepEqual(sleeps, [500, 1000, 2000]);

  const quota = queuedFetch([json({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403)]);
  await assert.rejects(
    () => createYouTubeClient({ apiKey, channelId, fetchImpl: quota.fetchImpl }).listUploads({}),
    (error) => {
      assert.equal(
        error instanceof Error && "code" in error && error.code,
        "youtube_quota_exhausted",
      );
      assert.doesNotMatch(
        error instanceof Error ? error.message : String(error),
        /test-key-never-log/,
      );
      return true;
    },
  );
  assert.equal(quota.urls.length, 1);
});

test("malformed playlist pages fail before the page callback", async () => {
  const fake = queuedFetch([channelResponse(), json({ nextPageToken: "page-2" })]);
  let pageCallbacks = 0;
  await assert.rejects(
    () =>
      createYouTubeClient({ apiKey, channelId, fetchImpl: fake.fetchImpl }).listUploads({
        onPage: async () => {
          pageCallbacks += 1;
        },
      }),
    (error) =>
      error instanceof Error && "code" in error && error.code === "youtube_invalid_snapshot",
  );
  assert.equal(pageCallbacks, 0);
});

test("non-JSON provider snapshots are classified as invalid", async () => {
  const fake = queuedFetch([new Response("not JSON", { status: 200 })]);
  await assert.rejects(
    () => createYouTubeClient({ apiKey, channelId, fetchImpl: fake.fetchImpl }).listUploads({}),
    (error) =>
      error instanceof Error && "code" in error && error.code === "youtube_invalid_snapshot",
  );
});

test("mismatched identity and invalid publication timestamps invalidate the snapshot", async () => {
  const mismatchedItem = playlistItem("AAAAAAAAAAA");
  mismatchedItem.snippet.resourceId.videoId = "BBBBBBBBBBB";
  const mismatch = queuedFetch([channelResponse(), json({ items: [mismatchedItem] })]);
  await assert.rejects(
    () => createYouTubeClient({ apiKey, channelId, fetchImpl: mismatch.fetchImpl }).listUploads({}),
    (error) =>
      error instanceof Error && "code" in error && error.code === "youtube_invalid_snapshot",
  );

  const invalidDateItem = playlistItem("AAAAAAAAAAA");
  invalidDateItem.contentDetails.videoPublishedAt = "not-a-date";
  const invalidDate = queuedFetch([channelResponse(), json({ items: [invalidDateItem] })]);
  await assert.rejects(
    () =>
      createYouTubeClient({ apiKey, channelId, fetchImpl: invalidDate.fetchImpl }).listUploads({}),
    (error) =>
      error instanceof Error && "code" in error && error.code === "youtube_invalid_snapshot",
  );
});

test("non-transient key failures are classified once without exposing the key", async () => {
  const fake = queuedFetch([json({ error: { errors: [{ reason: "keyInvalid" }] } }, 403)]);
  await assert.rejects(
    () => createYouTubeClient({ apiKey, channelId, fetchImpl: fake.fetchImpl }).listUploads({}),
    (error) => {
      assert.equal(error instanceof Error && "code" in error && error.code, "youtube_auth_failed");
      assert.doesNotMatch(
        error instanceof Error ? error.message : String(error),
        /test-key-never-log/,
      );
      return true;
    },
  );
  assert.equal(fake.urls.length, 1);
});
