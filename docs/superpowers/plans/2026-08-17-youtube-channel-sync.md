# YouTube Official Channel Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize every upload from Earnest Property's official YouTube channel into the Neon-backed `cms_videos` catalog through daily incremental, monthly full-reconciliation, and authenticated staff-triggered runs without overwriting staff editorial choices.

**Architecture:** A typed YouTube client resolves the channel's canonical uploads playlist and emits validated pages. A pure reconciliation module determines manual-row adoption, a Neon repository owns the tokenized lease and set-based atomic writes, and a thin orchestrator coordinates them. TanStack route adapters provide cron GET and staff POST authorization; public reads retain the existing shape while adding source-availability filtering and YouTube-aware ordering.

**Tech Stack:** TypeScript 5.8, TanStack Start and Router file routes, Zod 3, Bun tests for TypeScript behavior, Node 22 `node:test` contract/integration tests, `@neondatabase/serverless` 1.1 HTTP queries and transaction semantics, Neon Postgres migrations, YouTube Data API v3, and programmatic Vercel configuration in `vercel.ts`.

## Global Constraints

- Treat `docs/superpowers/specs/2026-08-17-youtube-channel-sync-design.md` as the approved behavior contract.
- Build from the committed Neon baseline. The active checkout contains unrelated user work; implementation should begin with `superpowers:using-git-worktrees` or otherwise preserve and explicitly stage only task-owned paths.
- The channel is fixed to `UCTwcj9hcQoKVpKEZY-ZgnwA` (`@晉誠地產-EarnestProperty`). It is non-secret configuration, not request input.
- Use YouTube Data API v3 for both incremental and full modes. Do not add RSS, push notifications, derived `UU` playlist IDs, duration requests, or Shorts classification.
- Resolve `contentDetails.relatedPlaylists.uploads` through `channels.list`, then page `playlistItems.list` with `maxResults=50`.
- New uploads use `published = true`, `youtube_available = true`, and `sort_order = 1000`.
- Synchronization never changes an existing row's UUID, `sort_order`, `published`, or non-null `description`.
- A matching manual row is adopted in place. Multiple manual rows normalizing to the same incoming ID fail preflight before video writes.
- Incremental runs never increment absence counters or mark rows unavailable.
- A managed video becomes unavailable only after it is absent from two distinct successful monthly full reconciliations. A second full run in the same Hong Kong month cannot increment the counter.
- Full reconciliation validates every provider page before one atomic database mutation. Failed or partial snapshots perform no absence mutation.
- Never delete a `cms_videos` row. Returning videos reset their miss count and availability without changing staff publication intent.
- Public official-channel reads require `published = true AND (youtube_managed = false OR youtube_available = true)` and order by `sort_order ASC, COALESCE(youtube_published_at, created_at) DESC`.
- The lease lasts 15 minutes, renews after every validated provider page, immediately before database mutation, and at least every three minutes during other active work.
- Retry HTTP 429 and 5xx failures no more than three additional times after the initial request. Honor `Retry-After`; use exponential backoff plus jitter. Do not repeatedly retry non-transient 403 responses.
- Cron GET uses `Authorization: Bearer ${CRON_SECRET}`. Staff POST uses the existing `cms.publish` permission, which is limited to manager/admin roles.
- Keep `/videos` layout, listing videos, MLS synchronization, and every production mutation out of implementation scope.
- Never log or return API keys, database URLs, authorization headers, raw provider bodies, or video descriptions.
- CI and ordinary local tests use fakes only. A disposable database integration run is separately gated by `TEST_DATABASE_URL`; live YouTube and production Neon are never test dependencies.
- Production migration, API-key installation, deployment, cron activation, and first live backfill each remain separate approval gates.

---

## File Structure

### Persistence and public reads

- Create `neon/migrations/20260817130000_youtube_channel_sync.sql` — `cms_videos` sync columns, indexes, constraints, and per-channel lease/state table.
- Modify `src/lib/control-plane/migration-versions.js` — register the migration in deployment order.
- Create `src/lib/youtube-sync/youtube-sync-schema.test.mjs` — schema and manifest contracts.
- Modify `src/lib/neon/public-data.server.ts` — source-availability filter and YouTube publication-date ordering without changing the public return shape.

### Domain, provider, repository, and orchestration

- Create `src/lib/youtube-sync/youtube-sync.types.ts` — fixed configuration, provider/result types, summaries, and safe error class.
- Create `src/lib/youtube-sync/youtube-reconciliation.ts` — canonical URL, Hong Kong period, snapshot validation, and manual adoption planning.
- Create `src/lib/youtube-sync/youtube-reconciliation.test.ts` — pure reconciliation tests.
- Create `src/lib/youtube-sync/youtube-client.server.ts` — YouTube API lookup, pagination, validation, and retry policy.
- Create `src/lib/youtube-sync/youtube-client.test.ts` — fake-fetch provider tests.
- Create `src/lib/youtube-sync/youtube-repository.server.ts` — tokenized lease plus set-based incremental/full writes.
- Create `src/lib/youtube-sync/youtube-repository.test.ts` — repository-port and SQL safety tests.
- Create `src/lib/youtube-sync/youtube-sync.server.ts` — mode/trigger orchestration and summary generation.
- Create `src/lib/youtube-sync/youtube-sync.test.ts` — fake-port lifecycle tests.

### HTTP, scheduling, and verification

- Create `src/lib/youtube-sync/youtube-http.server.ts` — cron/staff handlers, safe response mapping, and staff audit writes.
- Create `src/lib/youtube-sync/youtube-http.test.ts` — HTTP policy tests with injected dependencies.
- Create `src/routes/api.youtube-sync.ts` — daily GET and staff POST file route.
- Create `src/routes/api.youtube-sync.full.ts` — monthly GET file route.
- Create `src/routes/api.youtube-sync.test.mjs` — route, generated-tree, cron, public-query, and secret contracts.
- Regenerate `src/routeTree.gen.ts` through the normal TanStack build; never hand-edit it.
- Modify `vercel.ts` — retain all existing jobs and add the daily/monthly YouTube schedules.
- Modify `.env.example` — document the server-only API key without adding a value.
- Modify `package.json` — add focused deterministic and disposable-database test scripts without changing existing scripts.
- Create `src/lib/youtube-sync/youtube-sync.integration.test.mjs` — fake-provider, controlled-clock, isolated-Neon lifecycle proof.

---

### Task 1: Add the YouTube Synchronization Schema

**Files:**

- Create: `neon/migrations/20260817130000_youtube_channel_sync.sql`
- Modify: `src/lib/control-plane/migration-versions.js`
- Create: `src/lib/youtube-sync/youtube-sync-schema.test.mjs`

**Interfaces:**

- Consumes: the existing `cms_videos` table and `app_migrations` manifest convention.
- Produces: YouTube identity/availability metadata, the `youtube_sync_state` lease and boundary row, and indexes consumed by repository and public-read tasks.

- [ ] **Step 1: Write the failing schema contract test**

Create `src/lib/youtube-sync/youtube-sync-schema.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the schema tests and verify red**

Run:

```powershell
node --test src/lib/youtube-sync/youtube-sync-schema.test.mjs
```

Expected: FAIL because the migration does not exist and the manifest does not contain its filename.

- [ ] **Step 3: Create the additive migration**

Create `neon/migrations/20260817130000_youtube_channel_sync.sql`:

```sql
ALTER TABLE cms_videos
  ADD COLUMN IF NOT EXISTS youtube_video_id text,
  ADD COLUMN IF NOT EXISTS youtube_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS youtube_managed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS youtube_available boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS youtube_last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS youtube_missing_full_runs smallint NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS cms_videos_youtube_video_id_key
  ON cms_videos (youtube_video_id)
  WHERE youtube_video_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cms_videos_youtube_missing_full_runs_check'
      AND conrelid = 'cms_videos'::regclass
  ) THEN
    ALTER TABLE cms_videos
      ADD CONSTRAINT cms_videos_youtube_missing_full_runs_check
      CHECK (youtube_missing_full_runs >= 0);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS cms_videos_public_youtube_order_idx
  ON cms_videos (sort_order ASC, (COALESCE(youtube_published_at, created_at)) DESC)
  WHERE published = true
    AND (youtube_managed = false OR youtube_available = true);

CREATE TABLE IF NOT EXISTS youtube_sync_state (
  channel_id text PRIMARY KEY,
  lease_owner uuid,
  lease_expires_at timestamptz,
  last_incremental_video_id text,
  last_incremental_completed_at timestamptz,
  last_full_completed_at timestamptz,
  last_full_period date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS youtube_sync_state_lease_expiry_idx
  ON youtube_sync_state (lease_expires_at)
  WHERE lease_owner IS NOT NULL;
```

- [ ] **Step 4: Register the migration**

Append this exact entry after `20260816120000_staff_identity_actions.sql` in `MIGRATION_VERSIONS`:

```js
"20260817130000_youtube_channel_sync.sql",
```

If another approved implementation has added a lexicographically earlier migration, keep the entire list sorted rather than moving or deleting that entry.

- [ ] **Step 5: Run schema and manifest tests**

Run:

```powershell
node --test src/lib/youtube-sync/youtube-sync-schema.test.mjs src/lib/control-plane/migration-versions.test.mjs
```

Expected: PASS with both files reported and zero failed tests.

- [ ] **Step 6: Commit the schema slice**

```powershell
git add neon/migrations/20260817130000_youtube_channel_sync.sql src/lib/control-plane/migration-versions.js src/lib/youtube-sync/youtube-sync-schema.test.mjs
git commit -m "feat: add YouTube sync schema"
```

---

### Task 2: Define Synchronization Contracts and Pure Reconciliation

**Files:**

- Create: `src/lib/youtube-sync/youtube-sync.types.ts`
- Create: `src/lib/youtube-sync/youtube-reconciliation.ts`
- Create: `src/lib/youtube-sync/youtube-reconciliation.test.ts`

**Interfaces:**

- Consumes: `getYouTubeVideoId(value)` from `src/lib/youtube-video-url.js`.
- Produces: `YouTubeVideo`, `YouTubeSyncMode`, `YouTubeSyncTrigger`, `YouTubeSyncSummary`, `YouTubeSyncError`, `validateYouTubeSnapshot`, `planManualAdoptions`, `canonicalYouTubeUrl`, and `hongKongMonthPeriod` for every later task.

- [ ] **Step 1: Write the failing reconciliation tests**

Create `src/lib/youtube-sync/youtube-reconciliation.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "bun:test";

import {
  canonicalYouTubeUrl,
  hongKongMonthPeriod,
  planManualAdoptions,
  validateYouTubeSnapshot,
} from "./youtube-reconciliation";
import type { YouTubeVideo } from "./youtube-sync.types";

function video(videoId: string, title = videoId): YouTubeVideo {
  return {
    videoId,
    title,
    description: `${title} description`,
    publishedAt: "2026-08-01T00:00:00.000Z",
    canonicalUrl: canonicalYouTubeUrl(videoId),
  };
}

test("canonical watch URLs and Hong Kong periods are deterministic", () => {
  assert.equal(canonicalYouTubeUrl("AAAAAAAAAAA"), "https://www.youtube.com/watch?v=AAAAAAAAAAA");
  assert.equal(hongKongMonthPeriod(new Date("2026-08-31T16:30:00.000Z")), "2026-09-01");
});

test("manual URL variants are adopted in place", () => {
  const [planned] = planManualAdoptions([video("AAAAAAAAAAA")], [
    { id: "11111111-1111-4111-8111-111111111111", videoUrl: "https://youtu.be/AAAAAAAAAAA" },
  ]);
  assert.equal(planned.adoptionId, "11111111-1111-4111-8111-111111111111");
  assert.equal(planned.expectedManualUrl, "https://youtu.be/AAAAAAAAAAA");
});

test("unmatched uploads remain inserts", () => {
  const [planned] = planManualAdoptions([video("BBBBBBBBBBB")], [
    { id: "11111111-1111-4111-8111-111111111111", videoUrl: "https://youtu.be/AAAAAAAAAAA" },
  ]);
  assert.equal(planned.adoptionId, null);
  assert.equal(planned.expectedManualUrl, null);
});

test("two manual rows matching one incoming upload fail before writes", () => {
  assert.throws(
    () =>
      planManualAdoptions([video("AAAAAAAAAAA")], [
        { id: "11111111-1111-4111-8111-111111111111", videoUrl: "https://youtu.be/AAAAAAAAAAA" },
        {
          id: "22222222-2222-4222-8222-222222222222",
          videoUrl: "https://youtube.com/watch?v=AAAAAAAAAAA",
        },
      ]),
    (error) => error instanceof Error && "code" in error && error.code === "youtube_invalid_snapshot",
  );
});

test("snapshot validation rejects duplicate and malformed video IDs", () => {
  assert.throws(
    () => validateYouTubeSnapshot([video("AAAAAAAAAAA"), video("AAAAAAAAAAA")]),
    /invalid YouTube snapshot/i,
  );
  assert.throws(() => validateYouTubeSnapshot([video("short")]), /invalid YouTube snapshot/i);
});
```

- [ ] **Step 2: Run the reconciliation test and verify red**

Run:

```powershell
bun test src/lib/youtube-sync/youtube-reconciliation.test.ts
```

Expected: FAIL because the domain modules do not exist.

- [ ] **Step 3: Add the shared synchronization contracts**

Create `src/lib/youtube-sync/youtube-sync.types.ts`:

```ts
export const YOUTUBE_CHANNEL_ID = "UCTwcj9hcQoKVpKEZY-ZgnwA" as const;
export const YOUTUBE_LEASE_MS = 15 * 60 * 1_000;
export const YOUTUBE_LEASE_RENEWAL_MS = 3 * 60 * 1_000;

export type YouTubeSyncMode = "incremental" | "full";
export type YouTubeSyncTrigger = "cron" | "staff";

export type YouTubeProviderErrorCode =
  | "youtube_quota_exhausted"
  | "youtube_auth_failed"
  | "youtube_rate_limited"
  | "youtube_unavailable"
  | "youtube_invalid_snapshot";

export type YouTubeSyncErrorCode =
  | YouTubeProviderErrorCode
  | "youtube_sync_in_progress"
  | "youtube_lease_lost"
  | "youtube_validation_error";

export class YouTubeSyncError extends Error {
  readonly code: YouTubeSyncErrorCode;
  readonly retryable: boolean;

  constructor(code: YouTubeSyncErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "YouTubeSyncError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type YouTubeVideo = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  canonicalUrl: string;
};

export type PlannedYouTubeVideo = YouTubeVideo & {
  adoptionId: string | null;
  expectedManualUrl: string | null;
};

export type ManualVideoCandidate = {
  id: string;
  videoUrl: string;
};

export type YouTubePageProgress = {
  pageNumber: number;
  itemCount: number;
};

export type YouTubeFetchResult = {
  videos: YouTubeVideo[];
  pages: number;
  boundaryFound: boolean;
};

export type YouTubeMutationSummary = {
  inserted: number;
  adopted: number;
  updated: number;
  restored: number;
  unavailable: number;
};

export type YouTubeSyncSummary = YouTubeMutationSummary & {
  mode: YouTubeSyncMode;
  trigger: YouTubeSyncTrigger;
  pages: number;
  fetched: number;
  elapsedMs: number;
  period: string | null;
};

export type YouTubeSyncOutcome =
  | { status: "completed"; summary: YouTubeSyncSummary }
  | { status: "skipped"; reason: "sync_in_progress" };
```

- [ ] **Step 4: Implement the pure reconciliation module**

Create `src/lib/youtube-sync/youtube-reconciliation.ts`:

```ts
import { getYouTubeVideoId } from "@/lib/youtube-video-url.js";

import {
  YouTubeSyncError,
  type ManualVideoCandidate,
  type PlannedYouTubeVideo,
  type YouTubeVideo,
} from "./youtube-sync.types";

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function canonicalYouTubeUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function hongKongMonthPeriod(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) {
    throw new YouTubeSyncError("youtube_validation_error", "Hong Kong period could not be calculated.");
  }
  return `${year}-${month}-01`;
}

export function validateYouTubeSnapshot(videos: readonly YouTubeVideo[]) {
  const seen = new Set<string>();
  for (const item of videos) {
    const validDate = Number.isFinite(Date.parse(item.publishedAt));
    if (
      !VIDEO_ID_PATTERN.test(item.videoId) ||
      !item.title.trim() ||
      !validDate ||
      item.canonicalUrl !== canonicalYouTubeUrl(item.videoId) ||
      seen.has(item.videoId)
    ) {
      throw new YouTubeSyncError(
        "youtube_invalid_snapshot",
        "The provider returned an invalid YouTube snapshot.",
      );
    }
    seen.add(item.videoId);
  }
  return [...videos];
}

export function planManualAdoptions(
  videos: readonly YouTubeVideo[],
  manualRows: readonly ManualVideoCandidate[],
): PlannedYouTubeVideo[] {
  const validated = validateYouTubeSnapshot(videos);
  const candidatesByVideo = new Map<string, ManualVideoCandidate[]>();

  for (const row of manualRows) {
    const videoId = getYouTubeVideoId(row.videoUrl);
    if (!videoId) continue;
    const candidates = candidatesByVideo.get(videoId) ?? [];
    candidates.push(row);
    candidatesByVideo.set(videoId, candidates);
  }

  return validated.map((item) => {
    const candidates = candidatesByVideo.get(item.videoId) ?? [];
    if (candidates.length > 1) {
      throw new YouTubeSyncError(
        "youtube_invalid_snapshot",
        "Multiple manual rows match one incoming YouTube video.",
      );
    }
    const candidate = candidates[0];
    return {
      ...item,
      adoptionId: candidate?.id ?? null,
      expectedManualUrl: candidate?.videoUrl ?? null,
    };
  });
}
```

- [ ] **Step 5: Run reconciliation tests and type-check the files**

Run:

```powershell
bun test src/lib/youtube-sync/youtube-reconciliation.test.ts
.\node_modules\.bin\tsc.cmd --noEmit
```

Expected: the reconciliation suite passes and TypeScript reports zero errors.

- [ ] **Step 6: Commit the domain slice**

```powershell
git add src/lib/youtube-sync/youtube-sync.types.ts src/lib/youtube-sync/youtube-reconciliation.ts src/lib/youtube-sync/youtube-reconciliation.test.ts
git commit -m "feat: define YouTube reconciliation contracts"
```

---

### Task 3: Build the Validated, Retrying YouTube Data API Client

**Files:**

- Create: `src/lib/youtube-sync/youtube-client.server.ts`
- Create: `src/lib/youtube-sync/youtube-client.test.ts`

**Interfaces:**

- Consumes: `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID`, `canonicalYouTubeUrl`, and the shared provider types.
- Produces: `readYouTubeSyncConfig(env)` and `createYouTubeClient(deps).listUploads(input)`, where `input` accepts `boundaryVideoId` and an async `onPage` lease-renewal callback.

- [ ] **Step 1: Write fake-fetch provider tests**

Create `src/lib/youtube-sync/youtube-client.test.ts` with deterministic response queues:

```ts
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
  const fetchImpl: typeof fetch = async (input) => {
    urls.push(String(input));
    const response = responses.shift();
    assert.ok(response, `unexpected fetch: ${String(input)}`);
    return response;
  };
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

  assert.deepEqual(result.videos.map((item) => item.videoId), ["AAAAAAAAAAA", "BBBBBBBBBBB"]);
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

  assert.deepEqual(result.videos.map((item) => item.videoId), ["CCCCCCCCCCC", "BBBBBBBBBBB"]);
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
    (error) => error instanceof Error && "code" in error && error.code === "youtube_invalid_snapshot",
  );

  const wrongChannel = queuedFetch([
    channelResponse(),
    json({ items: [playlistItem("AAAAAAAAAAA", "Wrong", "UCwrongwrongwrongwrongwrong") ] }),
  ]);
  await assert.rejects(
    () => createYouTubeClient({ apiKey, channelId, fetchImpl: wrongChannel.fetchImpl }).listUploads({}),
    (error) => error instanceof Error && "code" in error && error.code === "youtube_invalid_snapshot",
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
    sleep: async (milliseconds) => sleeps.push(milliseconds),
    random: () => 0,
  });
  await client.listUploads({});
  assert.deepEqual(sleeps, [500, 1000, 2000]);

  const quota = queuedFetch([
    json({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403),
  ]);
  await assert.rejects(
    () => createYouTubeClient({ apiKey, channelId, fetchImpl: quota.fetchImpl }).listUploads({}),
    (error) => {
      assert.equal(error instanceof Error && "code" in error && error.code, "youtube_quota_exhausted");
      assert.doesNotMatch(error instanceof Error ? error.message : String(error), /test-key-never-log/);
      return true;
    },
  );
  assert.equal(quota.urls.length, 1);
});
```

- [ ] **Step 2: Run provider tests and verify red**

Run:

```powershell
bun test src/lib/youtube-sync/youtube-client.test.ts
```

Expected: FAIL because `youtube-client.server.ts` does not exist.

- [ ] **Step 3: Implement configuration, request retrying, and error classification**

Create `src/lib/youtube-sync/youtube-client.server.ts`. Start with this exact server-only boundary and dependency shape:

```ts
import "@tanstack/react-start/server-only";

import { canonicalYouTubeUrl } from "./youtube-reconciliation";
import {
  YOUTUBE_CHANNEL_ID,
  YouTubeSyncError,
  type YouTubeFetchResult,
  type YouTubePageProgress,
  type YouTubeProviderErrorCode,
  type YouTubeVideo,
} from "./youtube-sync.types";

const API_ROOT = "https://www.googleapis.com/youtube/v3";
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 500;

type FetchLike = typeof fetch;
type Sleep = (milliseconds: number) => Promise<void>;

type YouTubeClientDependencies = {
  apiKey: string;
  channelId?: string;
  fetchImpl?: FetchLike;
  sleep?: Sleep;
  random?: () => number;
};

type ListUploadsInput = {
  boundaryVideoId?: string | null;
  onPage?: (progress: YouTubePageProgress) => Promise<void>;
};

export function readYouTubeSyncConfig(env: Record<string, string | undefined> = process.env) {
  const apiKey = env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    throw new YouTubeSyncError(
      "youtube_auth_failed",
      "YouTube synchronization is not configured.",
    );
  }
  return { apiKey, channelId: YOUTUBE_CHANNEL_ID };
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function providerReason(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const error = "error" in body && body.error && typeof body.error === "object" ? body.error : null;
  const errors = error && "errors" in error && Array.isArray(error.errors) ? error.errors : [];
  const first = errors[0];
  return first && typeof first === "object" && "reason" in first ? String(first.reason) : "";
}

function classifyProviderError(status: number, reason: string): YouTubeProviderErrorCode {
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
    return "youtube_quota_exhausted";
  }
  if (status === 429 || reason === "userRateLimitExceeded" || reason === "rateLimitExceeded") {
    return "youtube_rate_limited";
  }
  if (
    status === 401 ||
    reason === "keyInvalid" ||
    reason === "accessNotConfigured" ||
    reason === "forbidden"
  ) {
    return "youtube_auth_failed";
  }
  return "youtube_unavailable";
}

function retryAfterMilliseconds(response: Response) {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}
```

Add a private `requestJson(url)` closure inside `createYouTubeClient`. It must perform exactly four total attempts, parse only JSON-shaped error metadata, retry only network failures, 429, and 5xx, and never include `url`, `apiKey`, raw response text, or headers in an exception:

```ts
async function requestJson(
  url: URL,
  dependencies: Required<Pick<YouTubeClientDependencies, "fetchImpl" | "sleep" | "random">>,
) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await dependencies.fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    } catch {
      if (attempt + 1 === MAX_ATTEMPTS) {
        throw new YouTubeSyncError(
          "youtube_unavailable",
          "YouTube is temporarily unavailable.",
          true,
        );
      }
      await dependencies.sleep(BASE_BACKOFF_MS * 2 ** attempt + Math.floor(dependencies.random() * 250));
      continue;
    }

    const body = await response.json().catch(() => null);
    if (response.ok) return body;

    const reason = providerReason(body);
    const code = classifyProviderError(response.status, reason);
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt + 1 === MAX_ATTEMPTS) {
      throw new YouTubeSyncError(code, "YouTube could not complete the synchronization request.", retryable);
    }
    const retryAfter = retryAfterMilliseconds(response);
    const backoff = BASE_BACKOFF_MS * 2 ** attempt + Math.floor(dependencies.random() * 250);
    await dependencies.sleep(retryAfter ?? backoff);
  }
  throw new YouTubeSyncError("youtube_unavailable", "YouTube is temporarily unavailable.", true);
}
```

- [ ] **Step 4: Implement canonical playlist lookup and validated pagination**

Complete `createYouTubeClient` with these invariants:

```ts
export function createYouTubeClient(input: YouTubeClientDependencies) {
  const apiKey = input.apiKey.trim();
  const channelId = input.channelId ?? YOUTUBE_CHANNEL_ID;
  if (!apiKey || !/^UC[A-Za-z0-9_-]{22}$/.test(channelId)) {
    throw new YouTubeSyncError("youtube_auth_failed", "YouTube synchronization is not configured.");
  }
  const dependencies = {
    fetchImpl: input.fetchImpl ?? fetch,
    sleep: input.sleep ?? defaultSleep,
    random: input.random ?? Math.random,
  };

  async function uploadsPlaylistId() {
    const url = new URL(`${API_ROOT}/channels`);
    url.searchParams.set("part", "contentDetails");
    url.searchParams.set("id", channelId);
    url.searchParams.set("key", apiKey);
    const body = (await requestJson(url, dependencies)) as Record<string, unknown>;
    const items = Array.isArray(body.items) ? body.items : [];
    const channel = items[0] as Record<string, unknown> | undefined;
    const contentDetails = channel?.contentDetails as Record<string, unknown> | undefined;
    const related = contentDetails?.relatedPlaylists as Record<string, unknown> | undefined;
    const uploads = typeof related?.uploads === "string" ? related.uploads : "";
    if (channel?.id !== channelId || !uploads) {
      throw new YouTubeSyncError(
        "youtube_invalid_snapshot",
        "The provider returned an invalid YouTube channel snapshot.",
      );
    }
    return uploads;
  }

  function normalizePlaylistItem(value: unknown): YouTubeVideo {
    if (!value || typeof value !== "object") {
      throw new YouTubeSyncError("youtube_invalid_snapshot", "The provider returned an invalid YouTube snapshot.");
    }
    const item = value as Record<string, unknown>;
    const snippet = item.snippet as Record<string, unknown> | undefined;
    const content = item.contentDetails as Record<string, unknown> | undefined;
    const resource = snippet?.resourceId as Record<string, unknown> | undefined;
    const contentVideoId = typeof content?.videoId === "string" ? content.videoId : "";
    const resourceVideoId = typeof resource?.videoId === "string" ? resource.videoId : "";
    const videoId = contentVideoId || resourceVideoId;
    const owner =
      typeof snippet?.videoOwnerChannelId === "string"
        ? snippet.videoOwnerChannelId
        : typeof snippet?.channelId === "string"
          ? snippet.channelId
          : "";
    const title = typeof snippet?.title === "string" ? snippet.title.trim() : "";
    const description = typeof snippet?.description === "string" ? snippet.description : "";
    const publishedAt =
      typeof content?.videoPublishedAt === "string"
        ? content.videoPublishedAt
        : typeof snippet?.publishedAt === "string"
          ? snippet.publishedAt
          : "";

    if (
      !/^[A-Za-z0-9_-]{11}$/.test(videoId) ||
      (contentVideoId && resourceVideoId && contentVideoId !== resourceVideoId) ||
      owner !== channelId ||
      !title ||
      !Number.isFinite(Date.parse(publishedAt))
    ) {
      throw new YouTubeSyncError("youtube_invalid_snapshot", "The provider returned an invalid YouTube snapshot.");
    }
    return {
      videoId,
      title,
      description,
      publishedAt: new Date(publishedAt).toISOString(),
      canonicalUrl: canonicalYouTubeUrl(videoId),
    };
  }

  async function listUploads(listInput: ListUploadsInput = {}): Promise<YouTubeFetchResult> {
    const playlistId = await uploadsPlaylistId();
    const videos: YouTubeVideo[] = [];
    const seenVideoIds = new Set<string>();
    const seenTokens = new Set<string>();
    let pageToken: string | null = null;
    let pageNumber = 0;
    let boundaryFound = false;

    do {
      const url = new URL(`${API_ROOT}/playlistItems`);
      url.searchParams.set("part", "snippet,contentDetails");
      url.searchParams.set("playlistId", playlistId);
      url.searchParams.set("maxResults", "50");
      url.searchParams.set("key", apiKey);
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const body = (await requestJson(url, dependencies)) as Record<string, unknown>;
      if (!Array.isArray(body.items)) {
        throw new YouTubeSyncError("youtube_invalid_snapshot", "The provider returned an invalid YouTube snapshot.");
      }
      pageNumber += 1;
      let acceptedOnPage = 0;
      for (const rawItem of body.items) {
        const item = normalizePlaylistItem(rawItem);
        if (seenVideoIds.has(item.videoId)) {
          throw new YouTubeSyncError("youtube_invalid_snapshot", "The provider returned an invalid YouTube snapshot.");
        }
        seenVideoIds.add(item.videoId);
        videos.push(item);
        acceptedOnPage += 1;
        if (listInput.boundaryVideoId && item.videoId === listInput.boundaryVideoId) {
          boundaryFound = true;
          break;
        }
      }
      await listInput.onPage?.({ pageNumber, itemCount: acceptedOnPage });
      if (boundaryFound) break;

      const next = typeof body.nextPageToken === "string" && body.nextPageToken ? body.nextPageToken : null;
      if (next && seenTokens.has(next)) {
        throw new YouTubeSyncError("youtube_invalid_snapshot", "The provider returned an invalid YouTube snapshot.");
      }
      if (next) seenTokens.add(next);
      pageToken = next;
    } while (pageToken);

    return { videos, pages: pageNumber, boundaryFound };
  }

  return { listUploads };
}
```

- [ ] **Step 5: Add the remaining malformed-response assertions**

Append these cases to `youtube-client.test.ts`:

```ts
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
    (error) => error instanceof Error && "code" in error && error.code === "youtube_invalid_snapshot",
  );
  assert.equal(pageCallbacks, 0);
});

test("mismatched identity and invalid publication timestamps invalidate the snapshot", async () => {
  const mismatchedItem = playlistItem("AAAAAAAAAAA");
  mismatchedItem.snippet.resourceId.videoId = "BBBBBBBBBBB";
  const mismatch = queuedFetch([channelResponse(), json({ items: [mismatchedItem] })]);
  await assert.rejects(
    () => createYouTubeClient({ apiKey, channelId, fetchImpl: mismatch.fetchImpl }).listUploads({}),
    (error) => error instanceof Error && "code" in error && error.code === "youtube_invalid_snapshot",
  );

  const invalidDateItem = playlistItem("AAAAAAAAAAA");
  invalidDateItem.contentDetails.videoPublishedAt = "not-a-date";
  const invalidDate = queuedFetch([channelResponse(), json({ items: [invalidDateItem] })]);
  await assert.rejects(
    () => createYouTubeClient({ apiKey, channelId, fetchImpl: invalidDate.fetchImpl }).listUploads({}),
    (error) => error instanceof Error && "code" in error && error.code === "youtube_invalid_snapshot",
  );
});

test("non-transient key failures are classified once without exposing the key", async () => {
  const fake = queuedFetch([
    json({ error: { errors: [{ reason: "keyInvalid" }] } }, 403),
  ]);
  await assert.rejects(
    () => createYouTubeClient({ apiKey, channelId, fetchImpl: fake.fetchImpl }).listUploads({}),
    (error) => {
      assert.equal(error instanceof Error && "code" in error && error.code, "youtube_auth_failed");
      assert.doesNotMatch(error instanceof Error ? error.message : String(error), /test-key-never-log/);
      return true;
    },
  );
  assert.equal(fake.urls.length, 1);
});
```

- [ ] **Step 6: Run provider and reconciliation tests**

Run:

```powershell
bun test src/lib/youtube-sync/youtube-client.test.ts src/lib/youtube-sync/youtube-reconciliation.test.ts
```

Expected: PASS with pagination, boundary, retry, invalid-snapshot, wrong-channel, and safe-error cases all green.

- [ ] **Step 7: Commit the provider slice**

```powershell
git add src/lib/youtube-sync/youtube-client.server.ts src/lib/youtube-sync/youtube-client.test.ts
git commit -m "feat: add YouTube uploads client"
```

---

### Task 4: Implement the Lease and Set-Based Neon Repository

**Files:**

- Create: `src/lib/youtube-sync/youtube-repository.server.ts`
- Create: `src/lib/youtube-sync/youtube-repository.test.ts`

**Interfaces:**

- Consumes: `queryRows`, `PlannedYouTubeVideo`, the fixed channel ID, lease timings, and HKT period strings.
- Produces: `createYouTubeSyncRepository()` with `acquireLease`, `renewLease`, `releaseLease`, `listManualCandidates`, and `applySnapshot`. `applySnapshot` accepts `mode`, the validated/adoption-planned snapshot, lease token, boundary, completion time, and full period.

- [ ] **Step 1: Write repository contract tests before SQL**

Create `src/lib/youtube-sync/youtube-repository.test.ts`:

```ts
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
  const source = readFileSync(
    new URL("./youtube-repository.server.ts", import.meta.url),
    "utf8",
  );
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
```

- [ ] **Step 2: Run repository tests and verify red**

Run:

```powershell
bun test src/lib/youtube-sync/youtube-repository.test.ts
```

Expected: FAIL because the repository module does not exist.

- [ ] **Step 3: Implement the repository port and tokenized lease**

Create `src/lib/youtube-sync/youtube-repository.server.ts` with this public shape:

```ts
import "@tanstack/react-start/server-only";

import {
  YOUTUBE_LEASE_MS,
  YouTubeSyncError,
  type ManualVideoCandidate,
  type PlannedYouTubeVideo,
  type YouTubeMutationSummary,
  type YouTubeSyncMode,
} from "./youtube-sync.types";

type Row = Record<string, unknown>;
type QueryRows = (statement: string, params?: unknown[]) => Promise<Row[]>;

type LeaseInput = { channelId: string; owner: string; now: Date };
export type YouTubeSyncLease = {
  channelId: string;
  owner: string;
  lastIncrementalVideoId: string | null;
  lastFullPeriod: string | null;
};

type ApplySnapshotInput = {
  channelId: string;
  owner: string;
  mode: YouTubeSyncMode;
  videos: readonly PlannedYouTubeVideo[];
  newestVideoId: string | null;
  completedAt: Date;
  period: string | null;
};

async function defaultQueryRows(statement: string, params: unknown[] = []) {
  const database = await import("@/lib/neon/db.server");
  return database.queryRows(statement, params);
}

function iso(value: Date) {
  return value.toISOString();
}

function leaseExpiry(now: Date) {
  return new Date(now.getTime() + YOUTUBE_LEASE_MS).toISOString();
}

function count(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createYouTubeSyncRepository(
  dependencies: { queryRows?: QueryRows } = {},
) {
  const queryRows = dependencies.queryRows ?? defaultQueryRows;

  async function acquireLease(input: LeaseInput): Promise<YouTubeSyncLease | null> {
    const rows = (await queryRows(
      `INSERT INTO youtube_sync_state
         (channel_id, lease_owner, lease_expires_at, updated_at)
       VALUES ($1, $2::uuid, $4::timestamptz, $3::timestamptz)
       ON CONFLICT (channel_id) DO UPDATE
       SET lease_owner = EXCLUDED.lease_owner,
           lease_expires_at = EXCLUDED.lease_expires_at,
           updated_at = EXCLUDED.updated_at
       WHERE youtube_sync_state.lease_owner IS NULL
          OR youtube_sync_state.lease_expires_at <= $3::timestamptz
       RETURNING channel_id, last_incremental_video_id,
                 last_full_period::text AS last_full_period`,
      [input.channelId, input.owner, iso(input.now), leaseExpiry(input.now)],
    )) as Array<{
      channel_id: string;
      last_incremental_video_id: string | null;
      last_full_period: string | null;
    }>;
    const row = rows[0];
    return row
      ? {
          channelId: row.channel_id,
          owner: input.owner,
          lastIncrementalVideoId: row.last_incremental_video_id,
          lastFullPeriod: row.last_full_period,
        }
      : null;
  }

  async function renewLease(input: LeaseInput) {
    const rows = await queryRows(
      `UPDATE youtube_sync_state
       SET lease_expires_at = $4::timestamptz, updated_at = $3::timestamptz
       WHERE channel_id = $1
         AND lease_owner = $2::uuid
         AND lease_expires_at > $3::timestamptz
       RETURNING true AS renewed`,
      [input.channelId, input.owner, iso(input.now), leaseExpiry(input.now)],
    );
    return rows.length === 1;
  }

  async function releaseLease(input: LeaseInput) {
    await queryRows(
      `UPDATE youtube_sync_state
       SET lease_owner = NULL, lease_expires_at = NULL, updated_at = $3::timestamptz
       WHERE channel_id = $1 AND lease_owner = $2::uuid`,
      [input.channelId, input.owner, iso(input.now)],
    );
  }

  async function listManualCandidates(): Promise<ManualVideoCandidate[]> {
    const rows = (await queryRows(
      `SELECT id::text AS id, video_url
       FROM cms_videos
       WHERE youtube_managed = false AND youtube_video_id IS NULL`,
    )) as Array<{ id: string; video_url: string }>;
    return rows.map((row) => ({ id: row.id, videoUrl: row.video_url }));
  }

  return { acquireLease, renewLease, releaseLease, listManualCandidates, applySnapshot };

  async function applySnapshot(input: ApplySnapshotInput): Promise<YouTubeMutationSummary> {
    if ((input.mode === "full") !== Boolean(input.period)) {
      throw new YouTubeSyncError("youtube_validation_error", "Full mode and period must agree.");
    }
    const payload = input.videos.map((item) => ({
      video_id: item.videoId,
      title: item.title,
      description: item.description,
      published_at: item.publishedAt,
      canonical_url: item.canonicalUrl,
      adoption_id: item.adoptionId,
      expected_manual_url: item.expectedManualUrl,
    }));
    const rows = (await queryRows(SNAPSHOT_SQL, [
      input.channelId,
      input.owner,
      iso(input.completedAt),
      input.mode,
      JSON.stringify(payload),
      input.newestVideoId,
      input.period,
    ])) as Array<{
      lease_ok: boolean;
      state_updates: number;
      inserted: number;
      adopted: number;
      updated: number;
      restored: number;
      unavailable: number;
    }>;
    const result = rows[0];
    if (!result?.lease_ok || count(result.state_updates) !== 1) {
      throw new YouTubeSyncError("youtube_lease_lost", "The YouTube synchronization lease was lost.", true);
    }
    return {
      inserted: count(result.inserted),
      adopted: count(result.adopted),
      updated: count(result.updated),
      restored: count(result.restored),
      unavailable: count(result.unavailable),
    };
  }
}
```

- [ ] **Step 4: Add the single-statement atomic snapshot SQL**

Define `SNAPSHOT_SQL` above the factory. Keep all video and state writes in this one PostgreSQL statement so any cast, constraint, or state failure rolls back the entire application:

```ts
const SNAPSHOT_SQL = `
WITH lease_guard AS MATERIALIZED (
  SELECT channel_id, last_full_period
  FROM youtube_sync_state
  WHERE channel_id = $1
    AND lease_owner = $2::uuid
    AND lease_expires_at > $3::timestamptz
  FOR UPDATE
),
incoming AS MATERIALIZED (
  SELECT *
  FROM jsonb_to_recordset($5::jsonb) AS item(
    video_id text,
    title text,
    description text,
    published_at timestamptz,
    canonical_url text,
    adoption_id uuid,
    expected_manual_url text
  )
),
existing AS MATERIALIZED (
  SELECT target.id, target.youtube_video_id, target.youtube_available
  FROM cms_videos target
  JOIN incoming ON incoming.video_id = target.youtube_video_id
  CROSS JOIN lease_guard
  FOR UPDATE OF target
),
adopted AS (
  UPDATE cms_videos AS target
  SET title = incoming.title,
      video_url = incoming.canonical_url,
      description = COALESCE(target.description, incoming.description),
      youtube_video_id = incoming.video_id,
      youtube_published_at = incoming.published_at,
      youtube_managed = true,
      youtube_available = true,
      youtube_last_seen_at = $3::timestamptz,
      youtube_missing_full_runs = 0,
      updated_at = $3::timestamptz
  FROM incoming
  CROSS JOIN lease_guard
  WHERE incoming.adoption_id IS NOT NULL
    AND target.id = incoming.adoption_id
    AND target.youtube_managed = false
    AND target.youtube_video_id IS NULL
    AND target.video_url = incoming.expected_manual_url
  RETURNING target.id, target.youtube_video_id
),
upserted AS (
  INSERT INTO cms_videos (
    title, video_url, description, sort_order, published,
    youtube_video_id, youtube_published_at, youtube_managed,
    youtube_available, youtube_last_seen_at, youtube_missing_full_runs,
    created_at, updated_at
  )
  SELECT incoming.title, incoming.canonical_url, incoming.description, 1000, true,
         incoming.video_id, incoming.published_at, true,
         true, $3::timestamptz, 0,
         $3::timestamptz, $3::timestamptz
  FROM incoming
  CROSS JOIN lease_guard
  WHERE NOT EXISTS (
    SELECT 1 FROM adopted WHERE adopted.youtube_video_id = incoming.video_id
  )
  ON CONFLICT (youtube_video_id) WHERE youtube_video_id IS NOT NULL
  DO UPDATE SET
    title = EXCLUDED.title,
    video_url = EXCLUDED.video_url,
    youtube_published_at = EXCLUDED.youtube_published_at,
    youtube_managed = true,
    youtube_available = true,
    youtube_last_seen_at = EXCLUDED.youtube_last_seen_at,
    youtube_missing_full_runs = 0,
    updated_at = EXCLUDED.updated_at
  RETURNING id, youtube_video_id
),
missing_before AS MATERIALIZED (
  SELECT target.id, target.youtube_available, target.youtube_missing_full_runs
  FROM cms_videos target
  CROSS JOIN lease_guard
  WHERE $4::text = 'full'
    AND lease_guard.last_full_period IS DISTINCT FROM $7::date
    AND target.youtube_managed = true
    AND NOT EXISTS (
      SELECT 1 FROM incoming WHERE incoming.video_id = target.youtube_video_id
    )
  FOR UPDATE OF target
),
missing_updated AS (
  UPDATE cms_videos AS target
  SET youtube_missing_full_runs = LEAST(target.youtube_missing_full_runs + 1, 32767)::smallint,
      youtube_available = CASE
        WHEN target.youtube_missing_full_runs + 1 >= 2 THEN false
        ELSE target.youtube_available
      END,
      updated_at = $3::timestamptz
  FROM missing_before
  WHERE target.id = missing_before.id
  RETURNING target.id, target.youtube_available
),
state_updated AS (
  UPDATE youtube_sync_state
  SET last_incremental_video_id = CASE
        WHEN $4::text = 'incremental' THEN COALESCE($6::text, last_incremental_video_id)
        ELSE last_incremental_video_id
      END,
      last_incremental_completed_at = CASE
        WHEN $4::text = 'incremental' THEN $3::timestamptz
        ELSE last_incremental_completed_at
      END,
      last_full_completed_at = CASE
        WHEN $4::text = 'full' THEN $3::timestamptz
        ELSE last_full_completed_at
      END,
      last_full_period = CASE
        WHEN $4::text = 'full' THEN $7::date
        ELSE last_full_period
      END,
      updated_at = $3::timestamptz
  WHERE channel_id = $1
    AND lease_owner = $2::uuid
    AND EXISTS (SELECT 1 FROM lease_guard)
  RETURNING channel_id
)
SELECT
  EXISTS (SELECT 1 FROM lease_guard) AS lease_ok,
  (SELECT count(*)::integer FROM state_updated) AS state_updates,
  (
    SELECT count(*)::integer
    FROM upserted
    LEFT JOIN existing ON existing.youtube_video_id = upserted.youtube_video_id
    WHERE existing.id IS NULL
  ) AS inserted,
  (SELECT count(*)::integer FROM adopted) AS adopted,
  (
    SELECT count(*)::integer
    FROM upserted
    JOIN existing ON existing.youtube_video_id = upserted.youtube_video_id
  ) AS updated,
  (
    SELECT count(*)::integer
    FROM upserted
    JOIN existing ON existing.youtube_video_id = upserted.youtube_video_id
    WHERE existing.youtube_available = false
  ) AS restored,
  (
    SELECT count(*)::integer
    FROM missing_updated
    JOIN missing_before USING (id)
    WHERE missing_before.youtube_available = true
      AND missing_updated.youtube_available = false
  ) AS unavailable;
`;
```

The `upserted` conflict clause must never assign `description`, `sort_order`, or `published`. The adoption clause may populate description only through `COALESCE(target.description, incoming.description)` and must not assign ID, order, or publication.

- [ ] **Step 5: Run repository tests**

Run:

```powershell
bun test src/lib/youtube-sync/youtube-repository.test.ts
```

Expected: PASS with lease-token, SQL-safety, no-delete, and lost-lease tests green.

- [ ] **Step 6: Run focused TypeScript and formatting checks**

Run:

```powershell
.\node_modules\.bin\tsc.cmd --noEmit
git diff --check -- src/lib/youtube-sync/youtube-repository.server.ts src/lib/youtube-sync/youtube-repository.test.ts
```

Expected: both commands exit zero.

- [ ] **Step 7: Commit the repository slice**

```powershell
git add src/lib/youtube-sync/youtube-repository.server.ts src/lib/youtube-sync/youtube-repository.test.ts
git commit -m "feat: persist YouTube synchronization state"
```

---

### Task 5: Orchestrate Incremental and Full Lifecycles

**Files:**

- Create: `src/lib/youtube-sync/youtube-sync.server.ts`
- Create: `src/lib/youtube-sync/youtube-sync.test.ts`

**Interfaces:**

- Consumes: the YouTube client, repository, adoption planner, fixed channel, lease timings, and HKT period helper.
- Produces: `runYouTubeSync({ mode, trigger }, dependencies?)`, returning either `{ status: "completed", summary }` or `{ status: "skipped", reason: "sync_in_progress" }`, while logging only aggregate completion/failure events.

- [ ] **Step 1: Write orchestration tests with fake ports**

Create `src/lib/youtube-sync/youtube-sync.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "bun:test";

import { runYouTubeSync } from "./youtube-sync.server";
import { canonicalYouTubeUrl } from "./youtube-reconciliation";
import { YouTubeSyncError, type YouTubeVideo } from "./youtube-sync.types";

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
        applySnapshot: async () => ({ inserted: 0, adopted: 0, updated: 0, restored: 0, unavailable: 0 }),
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
          { id: "22222222-2222-4222-8222-222222222222", videoUrl: "https://youtu.be/AAAAAAAAAAA" },
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
              throw new YouTubeSyncError("youtube_unavailable", "YouTube is temporarily unavailable.", true);
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
```

- [ ] **Step 2: Run orchestration tests and verify red**

Run:

```powershell
bun test src/lib/youtube-sync/youtube-sync.test.ts
```

Expected: FAIL because `youtube-sync.server.ts` does not exist.

- [ ] **Step 3: Implement the orchestrator with injectable ports**

Create `src/lib/youtube-sync/youtube-sync.server.ts`:

```ts
import "@tanstack/react-start/server-only";

import { createYouTubeClient, readYouTubeSyncConfig } from "./youtube-client.server";
import { planManualAdoptions, hongKongMonthPeriod } from "./youtube-reconciliation";
import { createYouTubeSyncRepository } from "./youtube-repository.server";
import {
  YOUTUBE_CHANNEL_ID,
  YOUTUBE_LEASE_RENEWAL_MS,
  YouTubeSyncError,
  type ManualVideoCandidate,
  type PlannedYouTubeVideo,
  type YouTubeFetchResult,
  type YouTubeMutationSummary,
  type YouTubePageProgress,
  type YouTubeSyncMode,
  type YouTubeSyncOutcome,
  type YouTubeSyncTrigger,
} from "./youtube-sync.types";

type ClientPort = {
  listUploads(input: {
    boundaryVideoId?: string | null;
    onPage?: (progress: YouTubePageProgress) => Promise<void>;
  }): Promise<YouTubeFetchResult>;
};

type RepositoryPort = {
  acquireLease(input: { channelId: string; owner: string; now: Date }): Promise<{
    channelId: string;
    owner: string;
    lastIncrementalVideoId: string | null;
    lastFullPeriod: string | null;
  } | null>;
  renewLease(input: { channelId: string; owner: string; now: Date }): Promise<boolean>;
  releaseLease(input: { channelId: string; owner: string; now: Date }): Promise<void>;
  listManualCandidates(): Promise<ManualVideoCandidate[]>;
  applySnapshot(input: {
    channelId: string;
    owner: string;
    mode: YouTubeSyncMode;
    videos: readonly PlannedYouTubeVideo[];
    newestVideoId: string | null;
    completedAt: Date;
    period: string | null;
  }): Promise<YouTubeMutationSummary>;
};

type Dependencies = {
  channelId?: string;
  owner?: () => string;
  now?: () => Date;
  client?: ClientPort;
  repository?: RepositoryPort;
  logger?: {
    info: (event: Record<string, unknown>) => void;
    error: (event: Record<string, unknown>) => void;
  };
};

const defaultLogger = {
  info(event: Record<string, unknown>) {
    console.info("[youtube-sync]", JSON.stringify(event));
  },
  error(event: Record<string, unknown>) {
    console.error("[youtube-sync]", JSON.stringify(event));
  },
};

function startLeaseHeartbeat(renew: () => Promise<void>) {
  let failure: unknown = null;
  let inFlight = Promise.resolve();
  const timer = setInterval(() => {
    inFlight = inFlight
      .then(async () => {
        if (!failure) await renew();
      })
      .catch((error) => {
        failure = error;
      });
  }, YOUTUBE_LEASE_RENEWAL_MS);

  return {
    async checkpoint() {
      await inFlight;
      if (failure) throw failure;
    },
    async stop() {
      clearInterval(timer);
      await inFlight;
      if (failure) throw failure;
    },
  };
}

export async function runYouTubeSync(
  input: { mode: YouTubeSyncMode; trigger: YouTubeSyncTrigger },
  overrides: Dependencies = {},
): Promise<YouTubeSyncOutcome> {
  const now = overrides.now ?? (() => new Date());
  const startedAt = now();
  const owner = (overrides.owner ?? crypto.randomUUID)();
  const channelId = overrides.channelId ?? YOUTUBE_CHANNEL_ID;
  const logger = overrides.logger ?? defaultLogger;
  const repository = overrides.repository ?? createYouTubeSyncRepository();
  const client =
    overrides.client ??
    createYouTubeClient({
      ...readYouTubeSyncConfig(),
      channelId,
    });

  const lease = await repository.acquireLease({ channelId, owner, now: startedAt });
  if (!lease) {
    logger.info({
      event: "youtube_sync_skipped",
      mode: input.mode,
      trigger: input.trigger,
      reason: "sync_in_progress",
    });
    return { status: "skipped", reason: "sync_in_progress" };
  }

  async function renew() {
    const renewed = await repository.renewLease({ channelId, owner, now: now() });
    if (!renewed) {
      throw new YouTubeSyncError(
        "youtube_lease_lost",
        "The YouTube synchronization lease was lost.",
        true,
      );
    }
  }

  const heartbeat = startLeaseHeartbeat(renew);

  try {
    const fetched = await client.listUploads({
      boundaryVideoId: input.mode === "incremental" ? lease.lastIncrementalVideoId : null,
      onPage: async () => renew(),
    });
    await heartbeat.checkpoint();
    const manualRows = await repository.listManualCandidates();
    const planned = planManualAdoptions(fetched.videos, manualRows);

    // This renewal is unconditional: it satisfies the immediate pre-mutation
    // checkpoint even when the last provider page completed moments ago.
    await heartbeat.checkpoint();
    await renew();
    const completedAt = now();
    const period = input.mode === "full" ? hongKongMonthPeriod(startedAt) : null;
    const mutations = await repository.applySnapshot({
      channelId,
      owner,
      mode: input.mode,
      videos: planned,
      newestVideoId: fetched.videos[0]?.videoId ?? null,
      completedAt,
      period,
    });
    const finishedAt = now();
    const outcome: YouTubeSyncOutcome = {
      status: "completed",
      summary: {
        mode: input.mode,
        trigger: input.trigger,
        pages: fetched.pages,
        fetched: fetched.videos.length,
        ...mutations,
        elapsedMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        period,
      },
    };
    logger.info({ event: "youtube_sync_completed", ...outcome.summary });
    return outcome;
  } catch (error) {
    logger.error({
      event: "youtube_sync_failed",
      mode: input.mode,
      trigger: input.trigger,
      code: error instanceof YouTubeSyncError ? error.code : "internal_error",
    });
    throw error;
  } finally {
    let heartbeatFailure: unknown = null;
    try {
      await heartbeat.stop();
    } catch (error) {
      heartbeatFailure = error;
    }
    await repository.releaseLease({ channelId, owner, now: now() });
    if (heartbeatFailure) throw heartbeatFailure;
  }
}
```

- [ ] **Step 4: Add renewal-loss and duplicate-manual regression cases**

Append these two tests to `youtube-sync.test.ts`:

```ts
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
              { id: "22222222-2222-4222-8222-222222222222", videoUrl: "https://youtu.be/AAAAAAAAAAA" },
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
    (error) => error instanceof Error && "code" in error && error.code === "youtube_invalid_snapshot",
  );
  assert.equal(applies, 0);
  assert.equal(releases, 1);
});
```

- [ ] **Step 5: Run the complete service layer**

Run:

```powershell
bun test src/lib/youtube-sync/youtube-reconciliation.test.ts src/lib/youtube-sync/youtube-client.test.ts src/lib/youtube-sync/youtube-repository.test.ts src/lib/youtube-sync/youtube-sync.test.ts
```

Expected: PASS with no network or database access.

- [ ] **Step 6: Commit the orchestration slice**

```powershell
git add src/lib/youtube-sync/youtube-sync.server.ts src/lib/youtube-sync/youtube-sync.test.ts
git commit -m "feat: orchestrate YouTube synchronization"
```

---

### Task 6: Add Cron and Staff HTTP Adapters

**Files:**

- Create: `src/lib/youtube-sync/youtube-http.server.ts`
- Create: `src/lib/youtube-sync/youtube-http.test.ts`
- Create: `src/routes/api.youtube-sync.ts`
- Create: `src/routes/api.youtube-sync.full.ts`
- Create: `src/routes/api.youtube-sync.test.mjs`
- Regenerate: `src/routeTree.gen.ts`

**Interfaces:**

- Consumes: `runYouTubeSync`, `requireStaffPermission(request, "cms.publish")`, `writeAudit`, `createOperationContext`, and `CRON_SECRET`.
- Produces: `createYouTubeSyncHttpHandlers()` with `cron(request, mode)` and `staff(request)`, plus the three approved endpoint/method combinations.

- [ ] **Step 1: Write HTTP policy tests with injected dependencies**

Create `src/lib/youtube-sync/youtube-http.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "bun:test";

import type { StaffAccess } from "@/lib/neon/auth.server";

import { createYouTubeSyncHttpHandlers } from "./youtube-http.server";

const actor: StaffAccess = {
  staffId: "11111111-1111-4111-8111-111111111111",
  authUserId: "auth-test",
  email: "manager@example.test",
  name: "Manager",
  roles: ["manager"],
  bootstrap: false,
};

function handlers(
  overrides: Parameters<typeof createYouTubeSyncHttpHandlers>[0] = {},
) {
  return createYouTubeSyncHttpHandlers({
    cronSecret: () => "cron-test-secret",
    requireStaffPermission: async () => actor,
    writeAudit: async () => {},
    createContext: () => ({
      requestId: "22222222-2222-4222-8222-222222222222",
      startedAt: "2026-08-17T00:00:00.000Z",
    }),
    runSync: async ({ mode, trigger }) => ({
      status: "completed",
      summary: {
        mode,
        trigger,
        pages: 1,
        fetched: 2,
        inserted: 1,
        adopted: 1,
        updated: 0,
        restored: 0,
        unavailable: 0,
        elapsedMs: 20,
        period: mode === "full" ? "2026-08-01" : null,
      },
    }),
    ...overrides,
  });
}

test("cron rejects missing or invalid bearer authorization", async () => {
  let calls = 0;
  const subject = handlers({
    runSync: async () => {
      calls += 1;
      throw new Error("must not run");
    },
  });
  for (const authorization of [undefined, "Bearer wrong-secret"]) {
    const headers = authorization ? { authorization } : {};
    const response = await subject.cron(new Request("https://example.test/api/youtube-sync", { headers }), "incremental");
    assert.equal(response.status, 401);
  }
  assert.equal(calls, 0);
});

test("cron contention returns a successful skip for duplicate delivery", async () => {
  const subject = handlers({
    runSync: async () => ({ status: "skipped", reason: "sync_in_progress" }),
  });
  const response = await subject.cron(
    new Request("https://example.test/api/youtube-sync", {
      headers: { authorization: "Bearer cron-test-secret" },
    }),
    "incremental",
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "skipped",
    reason: "sync_in_progress",
  });
});

test("staff POST validates mode and audits a successful aggregate-only result", async () => {
  const audits: Array<Record<string, unknown>> = [];
  let permission = "";
  const subject = handlers({
    requireStaffPermission: async (_request: Request, requested: string) => {
      permission = requested;
      return actor;
    },
    writeAudit: async (entry) => {
      audits.push(entry as unknown as Record<string, unknown>);
    },
  });
  const response = await subject.staff(
    new Request("https://example.test/api/youtube-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "full" }),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(permission, "cms.publish");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "youtube.sync.manual");
  assert.equal(audits[0].outcome, "success");
  assert.doesNotMatch(JSON.stringify(audits), /description|apiKey|authorization/i);
});

test("staff contention is 409 and malformed bodies are 400", async () => {
  const contention = handlers({
    runSync: async () => ({ status: "skipped", reason: "sync_in_progress" }),
  });
  const conflict = await contention.staff(
    new Request("https://example.test/api/youtube-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "incremental" }),
    }),
  );
  assert.equal(conflict.status, 409);

  const invalid = await handlers().staff(
    new Request("https://example.test/api/youtube-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "rss", apiKey: "must-not-echo" }),
    }),
  );
  assert.equal(invalid.status, 400);
  assert.doesNotMatch(await invalid.text(), /must-not-echo/);
});

test("provider failures map to safe non-2xx responses", async () => {
  const { YouTubeSyncError } = await import("./youtube-sync.types");
  const subject = handlers({
    runSync: async () => {
      throw new YouTubeSyncError("youtube_quota_exhausted", "safe", false);
    },
  });
  const response = await subject.cron(
    new Request("https://example.test/api/youtube-sync", {
      headers: { authorization: "Bearer cron-test-secret" },
    }),
    "full",
  );
  assert.equal(response.status, 503);
  assert.match(await response.text(), /youtube_quota_exhausted/);
});
```

- [ ] **Step 2: Run HTTP tests and verify red**

Run:

```powershell
bun test src/lib/youtube-sync/youtube-http.test.ts
```

Expected: FAIL because the HTTP adapter does not exist.

- [ ] **Step 3: Implement safe response mapping and handler injection**

Create `src/lib/youtube-sync/youtube-http.server.ts`. Use a strict Zod body and fixed response messages:

```ts
import "@tanstack/react-start/server-only";

import { z } from "zod";

import { writeAudit as defaultWriteAudit } from "@/lib/control-plane/audit.server";
import { requireStaffPermission as defaultRequireStaffPermission } from "@/lib/control-plane/permissions";
import { createOperationContext } from "@/lib/control-plane/request-context";
import type { StaffAccess } from "@/lib/neon/auth.server";

import { runYouTubeSync } from "./youtube-sync.server";
import {
  YOUTUBE_CHANNEL_ID,
  YouTubeSyncError,
  type YouTubeSyncMode,
  type YouTubeSyncOutcome,
  type YouTubeSyncTrigger,
} from "./youtube-sync.types";

const staffBodySchema = z.object({ mode: z.enum(["incremental", "full"]) }).strict();

type Context = { requestId: string; startedAt: string };
type Dependencies = {
  cronSecret: () => string | undefined;
  requireStaffPermission: (request: Request, permission: "cms.publish") => Promise<StaffAccess>;
  writeAudit: typeof defaultWriteAudit;
  createContext: () => Context;
  runSync: (input: { mode: YouTubeSyncMode; trigger: YouTubeSyncTrigger }) => Promise<YouTubeSyncOutcome>;
};

const publicMessages = {
  youtube_quota_exhausted: "YouTube quota is exhausted.",
  youtube_auth_failed: "YouTube synchronization is not configured.",
  youtube_rate_limited: "YouTube rate-limited the synchronization request.",
  youtube_unavailable: "YouTube is temporarily unavailable.",
  youtube_invalid_snapshot: "YouTube returned an invalid snapshot.",
  youtube_sync_in_progress: "A YouTube synchronization is already running.",
  youtube_lease_lost: "The YouTube synchronization lease was lost.",
  youtube_validation_error: "The YouTube synchronization request is invalid.",
} as const;

function errorStatus(code: keyof typeof publicMessages) {
  if (code === "youtube_rate_limited") return 429;
  if (code === "youtube_invalid_snapshot") return 502;
  if (code === "youtube_sync_in_progress" || code === "youtube_lease_lost") return 409;
  if (code === "youtube_validation_error") return 400;
  return 503;
}

function safeErrorResponse(error: unknown, cron: boolean) {
  if (error instanceof YouTubeSyncError) {
    const status = cron && error.code === "youtube_lease_lost" ? 503 : errorStatus(error.code);
    return Response.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: publicMessages[error.code],
          retryable: error.retryable,
        },
      },
      { status },
    );
  }
  return Response.json(
    {
      ok: false,
      error: {
        code: "internal_error",
        message: "The synchronization could not be completed.",
        retryable: false,
      },
    },
    { status: 500 },
  );
}

function success(outcome: YouTubeSyncOutcome, staff: boolean) {
  if (outcome.status === "skipped") {
    if (staff) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "youtube_sync_in_progress",
            message: publicMessages.youtube_sync_in_progress,
            retryable: true,
          },
        },
        { status: 409 },
      );
    }
    return Response.json(
      { ok: true, status: "skipped", reason: outcome.reason },
      { status: 200 },
    );
  }
  return Response.json({ ok: true, status: "completed", ...outcome.summary });
}

export function createYouTubeSyncHttpHandlers(overrides: Partial<Dependencies> = {}) {
  const dependencies: Dependencies = {
    cronSecret: () => process.env.CRON_SECRET,
    requireStaffPermission: defaultRequireStaffPermission,
    writeAudit: defaultWriteAudit,
    createContext: createOperationContext,
    runSync: runYouTubeSync,
    ...overrides,
  };

  async function cron(request: Request, mode: YouTubeSyncMode) {
    const expected = dependencies.cronSecret();
    if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    try {
      return success(await dependencies.runSync({ mode, trigger: "cron" }), false);
    } catch (error) {
      return safeErrorResponse(error, true);
    }
  }

  async function staff(request: Request) {
    const context = dependencies.createContext();
    let actor: StaffAccess;
    try {
      actor = await dependencies.requireStaffPermission(request, "cms.publish");
    } catch (error) {
      if (error instanceof Response) return error;
      return safeErrorResponse(error, false);
    }

    const parsed = staffBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      await dependencies.writeAudit({
        actor,
        permission: "cms.publish",
        action: "youtube.sync.manual",
        resourceType: "youtube_channel",
        resourceId: YOUTUBE_CHANNEL_ID,
        outcome: "failure",
        context,
        metadata: { code: "VALIDATION_ERROR" },
      });
      return Response.json(
        { ok: false, error: { code: "validation_error", message: "Mode must be incremental or full." } },
        { status: 400 },
      );
    }

    try {
      const outcome = await dependencies.runSync({ mode: parsed.data.mode, trigger: "staff" });
      await dependencies.writeAudit({
        actor,
        permission: "cms.publish",
        action: "youtube.sync.manual",
        resourceType: "youtube_channel",
        resourceId: YOUTUBE_CHANNEL_ID,
        outcome: outcome.status === "completed" ? "success" : "failure",
        context,
        metadata:
          outcome.status === "completed"
            ? outcome.summary
            : { mode: parsed.data.mode, reason: outcome.reason },
      });
      return success(outcome, true);
    } catch (error) {
      await dependencies.writeAudit({
        actor,
        permission: "cms.publish",
        action: "youtube.sync.manual",
        resourceType: "youtube_channel",
        resourceId: YOUTUBE_CHANNEL_ID,
        outcome: "failure",
        context,
        metadata: {
          mode: parsed.data.mode,
          code: error instanceof YouTubeSyncError ? error.code : "internal_error",
        },
      });
      return safeErrorResponse(error, false);
    }
  }

  return { cron, staff };
}
```

- [ ] **Step 4: Run HTTP tests green**

Run:

```powershell
bun test src/lib/youtube-sync/youtube-http.test.ts
```

Expected: PASS with cron auth, staff permission, validation, contention, audit, and safe-error tests green.

- [ ] **Step 5: Write the failing file-route contract**

Create `src/routes/api.youtube-sync.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const incremental = readFileSync(new URL("./api.youtube-sync.ts", import.meta.url), "utf8");
const full = readFileSync(new URL("./api.youtube-sync.full.ts", import.meta.url), "utf8");

test("daily route exposes cron GET and staff POST through the shared handlers", () => {
  assert.match(incremental, /createFileRoute\(["']\/api\/youtube-sync["']\)/);
  assert.match(incremental, /GET/);
  assert.match(incremental, /POST/);
  assert.match(incremental, /handlers\.cron\(request, ["']incremental["']\)/);
  assert.match(incremental, /handlers\.staff\(request\)/);
});

test("monthly route exposes only full cron GET", () => {
  assert.match(full, /createFileRoute\(["']\/api\/youtube-sync\/full["']\)/);
  assert.match(full, /handlers\.cron\(request, ["']full["']\)/);
  assert.doesNotMatch(full, /POST/);
});
```

- [ ] **Step 6: Run the route contract and verify red**

Run:

```powershell
node --test src/routes/api.youtube-sync.test.mjs
```

Expected: FAIL because neither file route exists.

- [ ] **Step 7: Add both thin TanStack routes**

Create `src/routes/api.youtube-sync.ts`:

```ts
import { createFileRoute } from "@tanstack/react-router";

import { createYouTubeSyncHttpHandlers } from "@/lib/youtube-sync/youtube-http.server";

const handlers = createYouTubeSyncHttpHandlers();

export const Route = createFileRoute("/api/youtube-sync")({
  server: {
    handlers: {
      GET: ({ request }) => handlers.cron(request, "incremental"),
      POST: ({ request }) => handlers.staff(request),
    },
  },
});
```

Create `src/routes/api.youtube-sync.full.ts`:

```ts
import { createFileRoute } from "@tanstack/react-router";

import { createYouTubeSyncHttpHandlers } from "@/lib/youtube-sync/youtube-http.server";

const handlers = createYouTubeSyncHttpHandlers();

export const Route = createFileRoute("/api/youtube-sync/full")({
  server: {
    handlers: {
      GET: ({ request }) => handlers.cron(request, "full"),
    },
  },
});
```

- [ ] **Step 8: Regenerate the route tree and run route tests**

Run:

```powershell
npm.cmd run build:dev
node --test src/routes/api.youtube-sync.test.mjs
```

Expected: the development build succeeds, `src/routeTree.gen.ts` contains both `/api/youtube-sync` routes, and the route contract passes. Do not hand-edit generated route-tree content.

- [ ] **Step 9: Commit the HTTP slice**

```powershell
git add src/lib/youtube-sync/youtube-http.server.ts src/lib/youtube-sync/youtube-http.test.ts src/routes/api.youtube-sync.ts src/routes/api.youtube-sync.full.ts src/routes/api.youtube-sync.test.mjs src/routeTree.gen.ts
git commit -m "feat: expose YouTube sync endpoints"
```

---

### Task 7: Wire Public Visibility, Environment Documentation, and Vercel Schedules

**Files:**

- Modify: `src/lib/neon/public-data.server.ts`
- Modify: `src/routes/api.youtube-sync.test.mjs`
- Modify: `vercel.ts`
- Modify: `.env.example`
- Modify: `package.json`

**Interfaces:**

- Consumes: the migration columns, both API routes, and the repository's existing `fetchCmsVideos` public return shape.
- Produces: correct public visibility/order, two registered Vercel jobs, documented server-only key configuration, and `test:youtube-sync` / `test:youtube-sync:db` commands.

- [ ] **Step 1: Extend the contract test before changing reads or schedules**

Append these exact fixtures and tests to `src/routes/api.youtube-sync.test.mjs`:

```js
const publicData = readFileSync(
  new URL("../lib/neon/public-data.server.ts", import.meta.url),
  "utf8",
);
const vercel = readFileSync(new URL("../../vercel.ts", import.meta.url), "utf8");
const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);

test("public CMS video reads combine staff publication with source availability", () => {
  const fetchCmsVideos = publicData.match(
    /export async function fetchCmsVideos\(\)[\s\S]*?\r?\n}\r?\n/,
  )?.[0];
  assert.ok(fetchCmsVideos, "fetchCmsVideos must remain exported");
  assert.match(
    fetchCmsVideos,
    /published = true[\s\S]*youtube_managed = false OR youtube_available = true/,
  );
  assert.match(
    fetchCmsVideos,
    /ORDER BY sort_order ASC, COALESCE\(youtube_published_at, created_at\) DESC/,
  );
  assert.match(
    fetchCmsVideos,
    /SELECT id, title, video_url, description, sort_order, created_at/,
  );
});

test("Vercel retains existing jobs and adds the two YouTube schedules", () => {
  for (const existingPath of [
    "/api/mls-sync",
    "/api/admin/control-plane/worker",
    "/api/admin/jobs/send-queue",
  ]) {
    assert.ok(vercel.includes(existingPath), `${existingPath} must remain scheduled`);
  }
  assert.match(vercel, /path:\s*"\/api\/youtube-sync"[\s\S]*schedule:\s*"0 19 \* \* \*"/);
  assert.match(
    vercel,
    /path:\s*"\/api\/youtube-sync\/full"[\s\S]*schedule:\s*"0 21 1 \* \*"/,
  );
});

test("server-only configuration is documented without values", () => {
  assert.match(envExample, /^YOUTUBE_API_KEY=""$/m);
  assert.doesNotMatch(envExample, /YOUTUBE_API_KEY=".+"/);
  assert.match(envExample, /YouTube Data API v3/i);
});

test("package exposes deterministic and disposable-database YouTube suites", () => {
  assert.match(packageJson.scripts["test:youtube-sync"], /youtube-reconciliation\.test\.ts/);
  assert.match(packageJson.scripts["test:youtube-sync"], /api\.youtube-sync\.test\.mjs/);
  assert.equal(
    packageJson.scripts["test:youtube-sync:db"],
    "node --test src/lib/youtube-sync/youtube-sync.integration.test.mjs",
  );
});
```

- [ ] **Step 2: Run the expanded contract and verify red**

Run:

```powershell
node --test src/routes/api.youtube-sync.test.mjs
```

Expected: route-only tests pass, while public visibility, cron, environment, and package-script tests fail.

- [ ] **Step 3: Update only the CMS video visibility and order clauses**

In `fetchCmsVideos()` inside `src/lib/neon/public-data.server.ts`, keep the selected columns and mapped return object unchanged. Replace the filter and order with:

```sql
WHERE published = true
  AND (youtube_managed = false OR youtube_available = true)
ORDER BY sort_order ASC, COALESCE(youtube_published_at, created_at) DESC
```

Do not change listing-video queries, `src/routes/videos.tsx`, `src/lib/queries.ts`, or the returned `CmsVideo` fields.

- [ ] **Step 4: Add both Vercel cron entries without removing existing jobs**

Add these objects to the existing `crons` array in `vercel.ts`:

```ts
{ path: "/api/youtube-sync", schedule: "0 19 * * *" },
{ path: "/api/youtube-sync/full", schedule: "0 21 1 * *" },
```

Place the daily entry before the existing 20:00 UTC jobs and the monthly entry after them. Update the surrounding comment to say five Vercel jobs rather than three. Preserve all redirect content and the existing Cloudflare-worker explanation.

- [ ] **Step 5: Document the key source without committing a secret**

Append this section to `.env.example`:

```dotenv

# --- YouTube official-channel synchronization ---
# Google Cloud Console -> APIs & Services -> Credentials. The owning project
# must have YouTube Data API v3 enabled. Server-only; never prefix with VITE_.
YOUTUBE_API_KEY=""
# Both GET routes reuse the existing Vercel CRON_SECRET bearer convention.
# The fixed channel ID lives in youtube-sync.types.ts and is not a secret.
```

Do not add a real key, a sample key-shaped value, or a second channel configuration variable.

- [ ] **Step 6: Add focused package scripts**

Merge these entries into the existing `scripts` object in `package.json` without replacing or reordering unrelated scripts:

```json
{
  "test:youtube-sync": "bun test src/lib/youtube-sync/youtube-reconciliation.test.ts src/lib/youtube-sync/youtube-client.test.ts src/lib/youtube-sync/youtube-repository.test.ts src/lib/youtube-sync/youtube-sync.test.ts src/lib/youtube-sync/youtube-http.test.ts && node --test src/lib/youtube-sync/youtube-sync-schema.test.mjs src/routes/api.youtube-sync.test.mjs",
  "test:youtube-sync:db": "node --test src/lib/youtube-sync/youtube-sync.integration.test.mjs"
}
```

- [ ] **Step 7: Run deterministic YouTube, cron, CMS, and manifest checks**

Run:

```powershell
npm.cmd run test:youtube-sync
npm.cmd run test:cron
npm.cmd run test:cms
node --test src/lib/control-plane/migration-versions.test.mjs
```

Expected: every command passes. `test:cron` confirms every Vercel schedule still runs no more than once per day and existing Cloudflare worker routes remain intact.

- [ ] **Step 8: Build and inspect generated route coverage**

Run:

```powershell
npm.cmd run build:dev
Select-String -Path src/routeTree.gen.ts -Pattern '/api/youtube-sync'
```

Expected: build exits zero and the generated tree reports both daily and full paths.

- [ ] **Step 9: Commit public/configuration wiring**

```powershell
git add src/lib/neon/public-data.server.ts src/routes/api.youtube-sync.test.mjs vercel.ts .env.example package.json src/routeTree.gen.ts
git commit -m "feat: schedule YouTube channel synchronization"
```

---

### Task 8: Prove Reconciliation Against a Disposable Neon Database

**Files:**

- Create: `src/lib/youtube-sync/youtube-sync.integration.test.mjs`

**Interfaces:**

- Consumes: `TEST_DATABASE_URL`, the repository migration runner, a fake client, a controlled clock, and the production repository/orchestrator code.
- Produces: database evidence for adoption, protected editorial fields, same-period idempotency, two-period unavailability, restoration, public visibility, and single-statement rollback. It never contacts YouTube.

- [ ] **Step 1: Write the gated integration test**

Create `src/lib/youtube-sync/youtube-sync.integration.test.mjs`:

```js
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

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

test(
  "fake YouTube plus controlled time proves adoption, two-period absence, restoration, and rollback",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const migrationEnv = { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL };
    delete migrationEnv.DATABASE_URL_UNPOOLED;
    const migration = spawnSync(process.execPath, ["scripts/neon/apply-migrations.mjs"], {
      env: migrationEnv,
      encoding: "utf8",
    });
    assert.equal(migration.status, 0, migration.stderr || migration.stdout);

    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousUnpooledUrl = process.env.DATABASE_URL_UNPOOLED;
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    delete process.env.DATABASE_URL_UNPOOLED;

    const { queryRows } = await import("../neon/db.server.ts");
    const { createYouTubeSyncRepository } = await import("./youtube-repository.server.ts");
    const { runYouTubeSync } = await import("./youtube-sync.server.ts");
    const cleanup = async () => {
      await queryRows(
        `DELETE FROM cms_videos
         WHERE youtube_video_id = ANY($1::text[]) OR video_url = ANY($2::text[])`,
        [videoIds, [manualUrl, nullDescriptionManualUrl]],
      );
      await queryRows("DELETE FROM youtube_sync_state WHERE channel_id = $1", [channelId]);
    };

    try {
      await cleanup();
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
          client: fakeClient([
            video("AAAAAAAAAAA", "Adopted title"),
            video("BBBBBBBBBBB", "Inserted title"),
            video("CCCCCCCCCCC", "First adopted description"),
          ]),
          repository: createYouTubeSyncRepository(),
        },
      );
      assert.equal(initial.status, "completed");
      assert.equal(initial.summary.adopted, 2);
      assert.equal(initial.summary.inserted, 1);

      const adopted = await queryRows(
        `SELECT id::text AS id, title, description, sort_order, published,
                youtube_managed, youtube_available, youtube_missing_full_runs
         FROM cms_videos WHERE youtube_video_id = 'AAAAAAAAAAA'`,
      );
      assert.equal(adopted[0].id, manualId);
      assert.equal(adopted[0].title, "Adopted title");
      assert.equal(adopted[0].description, "Staff description");
      assert.equal(adopted[0].sort_order, 7);
      assert.equal(adopted[0].published, false);
      assert.equal(adopted[0].youtube_managed, true);

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

      const augustFull = {
        channelId,
        now: fixedNow("2026-08-02T21:00:00.000Z"),
        client: fakeClient([
          video("AAAAAAAAAAA", "August title"),
          video("CCCCCCCCCCC", "Changed upstream description"),
        ]),
        repository: createYouTubeSyncRepository(),
      };
      await runYouTubeSync({ mode: "full", trigger: "cron" }, augustFull);
      await runYouTubeSync({ mode: "full", trigger: "staff" }, augustFull);
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
          repository: createYouTubeSyncRepository(),
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
          repository: createYouTubeSyncRepository(),
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

      const visible = await queryRows(
        `SELECT youtube_video_id
         FROM cms_videos
         WHERE published = true
           AND (youtube_managed = false OR youtube_available = true)
           AND youtube_video_id = ANY($1::text[])
         ORDER BY sort_order ASC, COALESCE(youtube_published_at, created_at) DESC`,
        [videoIds],
      );
      assert.deepEqual(visible.map((row) => row.youtube_video_id), [
        "CCCCCCCCCCC",
        "BBBBBBBBBBB",
      ]);

      const repository = createYouTubeSyncRepository();
      const rollbackOwner = crypto.randomUUID();
      const rollbackNow = new Date("2026-10-03T00:00:00.000Z");
      assert.ok(await repository.acquireLease({ channelId, owner: rollbackOwner, now: rollbackNow }));
      const stateBefore = await queryRows(
        `SELECT last_incremental_video_id
         FROM youtube_sync_state WHERE channel_id = $1`,
        [channelId],
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
              adoptionId: "not-a-uuid",
              expectedManualUrl: manualUrl,
            },
          ],
        }),
      );
      const stateAfter = await queryRows(
        `SELECT last_incremental_video_id
         FROM youtube_sync_state WHERE channel_id = $1`,
        [channelId],
      );
      assert.deepEqual(stateAfter, stateBefore);
      assert.equal(
        (await queryRows("SELECT id FROM cms_videos WHERE youtube_video_id = 'CCCCCCCCCCC'")).length,
        0,
      );
      await repository.releaseLease({ channelId, owner: rollbackOwner, now: rollbackNow });
    } finally {
      await cleanup();
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      if (previousUnpooledUrl === undefined) delete process.env.DATABASE_URL_UNPOOLED;
      else process.env.DATABASE_URL_UNPOOLED = previousUnpooledUrl;
    }
  },
);
```

The test cleanup is limited to its three known video IDs, two known manual URLs, and the fixed channel state inside a separately provisioned disposable database. Do not truncate tables, delete unrelated rows, or accept `DATABASE_URL` as a substitute for `TEST_DATABASE_URL`.

- [ ] **Step 2: Run without database credentials and verify the honest skip**

Run:

```powershell
Remove-Item Env:TEST_DATABASE_URL -ErrorAction SilentlyContinue
npm.cmd run test:youtube-sync:db
```

Expected: one skipped test, zero failures, and no network/database attempt.

- [ ] **Step 3: Run against an approved disposable database**

After separate approval and creation of a disposable Neon branch, set `TEST_DATABASE_URL` only in the current process without printing it, then run:

```powershell
if (-not $env:TEST_DATABASE_URL) { throw 'TEST_DATABASE_URL is required for the disposable database check.' }
npm.cmd run test:youtube-sync:db
```

Expected: PASS with adoption, protected fields, same-period idempotency, second-period unavailability, restoration, visibility, and rollback assertions green. The output must show no live YouTube request.

- [ ] **Step 4: Commit the integration proof**

```powershell
git add src/lib/youtube-sync/youtube-sync.integration.test.mjs
git commit -m "test: verify YouTube sync reconciliation"
```

---

### Task 9: Verify Code Completion and Stop at Production Gates

**Files:**

- Verify: every path listed in Tasks 1-8.
- Modify only if verification finds a scoped defect: the corresponding implementation and regression-test files.

**Interfaces:**

- Consumes: the task commits, deterministic test evidence, optional approved disposable-database evidence, and the approved design.
- Produces: an implementation-ready or explicit no-go report. It does not apply production migrations, install secrets, deploy, activate cron, or backfill live data.

- [ ] **Step 1: Verify checkout and commit boundaries**

Run:

```powershell
git status --short
git log --oneline -12
git diff --check
```

Expected: each task commit is present, no task-owned changes remain unstaged, and whitespace validation passes. Preserve and report any unrelated pre-existing changes rather than staging or discarding them.

- [ ] **Step 2: Run all deterministic YouTube and affected regression suites**

Run:

```powershell
npm.cmd run test:youtube-sync
npm.cmd run test:cron
npm.cmd run test:cms
node --test src/lib/control-plane/migration-versions.test.mjs
.\node_modules\.bin\tsc.cmd --noEmit
npm.cmd run build:dev
```

Expected: all tests pass, TypeScript reports zero errors, route generation includes both endpoints, and the development build succeeds. These commands must not use `YOUTUBE_API_KEY`, `TEST_DATABASE_URL`, or live network access.

- [ ] **Step 3: Run full lint separately and report baseline honestly**

Run:

```powershell
npm.cmd run lint
```

Expected: PASS. If unrelated pre-existing lint failures exist, record their exact files and run the repository-local ESLint binary against every touched TypeScript/JavaScript path. Do not claim the full lint passes when only the focused check passes.

- [ ] **Step 4: Verify the optional database boundary**

Without `TEST_DATABASE_URL`, run:

```powershell
npm.cmd run test:youtube-sync:db
```

Expected: SKIPPED. With separately approved disposable Neon access, run the same command with `TEST_DATABASE_URL` set only for the process and require PASS. Never substitute production `DATABASE_URL` or `DATABASE_URL_UNPOOLED`, and never print the connection string.

- [ ] **Step 5: Request focused code review**

Invoke `superpowers:requesting-code-review` and review the implementation against the approved design. The review must specifically confirm:

- the client always resolves `relatedPlaylists.uploads`, requests 50 items, and never derives a `UU` ID;
- malformed, partial, repeated-token, and wrong-channel snapshots cannot reach absence mutation;
- duplicate manual matches stop before writes;
- existing UUID, sort order, publication, and non-null description survive adoption and refresh;
- incremental mode never advances missing counters;
- only a new Hong Kong monthly period advances an unseen row once;
- the second distinct miss hides without deleting and a return restores availability;
- every write is guarded by the current lease token and the full application is one atomic SQL statement;
- cron and staff contention return 200 and 409 respectively;
- staff auth uses `cms.publish`, audit metadata contains aggregates only, and all failure responses are safe;
- all three existing Vercel jobs remain alongside both new jobs;
- public listing-video behavior and `/videos` presentation code are untouched; and
- no logs, responses, fixtures, docs, or commits expose secrets or raw provider bodies.

Resolve actionable findings with a failing regression test, the smallest fix, and an explicit follow-up commit. Re-run Steps 1-4 after any fix.

- [ ] **Step 6: Produce the configuration source map before any rollout request**

Report this exact map without values:

| Variable | Source | Scope |
| --- | --- | --- |
| `YOUTUBE_API_KEY` | Google Cloud project with YouTube Data API v3 enabled | Vercel server-only environment variable |
| `CRON_SECRET` | Existing random Vercel cron secret | Vercel server-only; shared by the two GET routes and existing cron routes |
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED` | Existing Neon project integration | Server-only; no new database credential |
| Channel ID | `YOUTUBE_CHANNEL_ID` in source | Non-secret fixed value `UCTwcj9hcQoKVpKEZY-ZgnwA` |

Confirm which required provider values are absent without reading, printing, or comparing secret contents.

- [ ] **Step 7: Stop at each external production authorization gate**

Obtain a separate explicit approval before each action:

1. apply `20260817130000_youtube_channel_sync.sql` to production Neon;
2. create or install the production `YOUTUBE_API_KEY`;
3. deploy the implementation and its Vercel cron configuration;
4. invoke the first live full synchronization/backfill; and
5. accept the resulting public catalog state.

Approval for implementation, testing, or one gate does not authorize a later gate. Until all approved gates are complete, report code completion and production rollout separately.

- [ ] **Step 8: Verify the first live run only after all preceding approvals**

For the separately approved first full run, verify aggregate evidence without exposing descriptions or URLs:

- the configured channel ID is the expected fixed ID;
- provider pagination completes without a repeated token or invalid item;
- exactly one manual row is adopted or the run stops on duplicate matches;
- new rows use `published=true`, `sort_order=1000`, and `youtube_available=true`;
- the existing manual row retains its UUID, order, publication, and non-null description;
- no unseen row becomes unavailable on the first successful monthly period;
- the response and staff audit contain only the approved summary fields; and
- Vercel lists the five intended cron jobs with the approved UTC schedules.

If any assertion fails, stop cron activation or disable the new schedules, preserve database/audit evidence, keep every video row, and fix forward through a new reviewed migration or code commit. Never delete rows to simulate rollback.

---

## Definition of Done

Implementation is code-complete when Tasks 1-8 are committed, deterministic checks pass, the disposable-database suite is either passed with separately approved evidence or explicitly reported as skipped, route generation contains both endpoints, and focused review has no unresolved findings.

Production rollout is complete only after the production migration, API-key installation, deployment/cron activation, first full run, and catalog acceptance were separately approved and verified. Code completion alone is not production completion.
