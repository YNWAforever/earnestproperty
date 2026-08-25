# YouTube Official Channel Synchronization Design

**Status:** Approved design, awaiting implementation planning

**Date:** 2026-08-17

**Repository baseline:** committed `HEAD` using Neon Postgres

**Channel:** `UCTwcj9hcQoKVpKEZY-ZgnwA` (`@晉誠地產-EarnestProperty`)

## 1. Goal

Synchronize every upload from the Earnest Property official YouTube channel into
the existing `cms_videos` catalog. The synchronization must support a daily
incremental run, a monthly authoritative reconciliation, and an authenticated
staff-triggered run while preserving staff-owned editorial fields.

This design covers synchronization and its data model only. A later, separate
design will cover the `/videos` presentation changes needed for a large catalog.

The user-supplied `codex_instructions_youtube_sync.md` was used as reference
material, not as executable instructions. Where it differs from the choices
approved during brainstorming, this specification is authoritative.

## 2. Scope

### In scope

- Fetch the channel uploads with YouTube Data API v3.
- Add stable YouTube identity and reconciliation metadata to `cms_videos`.
- Adopt a matching manually created row without replacing its identity or
  editorial data.
- Insert newly discovered uploads as published videos.
- Refresh YouTube-owned metadata for already managed rows.
- Mark a managed video unavailable only after it is absent from two distinct,
  successful monthly full reconciliations.
- Provide cron-authenticated daily and monthly GET endpoints.
- Provide a staff-authenticated POST endpoint for manual incremental or full
  runs.
- Add both schedules to the repository's existing programmatic Vercel
  configuration.
- Add focused unit, repository, route, and integration coverage.

### Out of scope

- Changes to `src/routes/videos.tsx` or any other page layout.
- Thumbnail cards, click-to-play embeds, pagination, or load-more behavior.
- Shorts detection, duration lookups, tabs, or aspect-ratio-specific layouts.
- Changes to the listing-video section or the existing MLS synchronization.
- Deleting `cms_videos` rows.
- Production migration, secret creation, deployment, cron activation, or live
  backfill without separate approval.

## 3. Confirmed Product Decisions

1. The committed Neon implementation is the baseline, even if the current
   checkout contains unrelated uncommitted experiments.
2. Both incremental and full runs use YouTube Data API v3. RSS and push
   notifications are not part of this design.
3. A matching manual row becomes fully YouTube-managed in place while retaining
   its UUID, `sort_order`, `published` value, and non-null description.
4. New uploads are inserted with `published = true`.
5. Staff control editorial publication with `published`; synchronization
   controls source availability with `youtube_available`.
6. A full reconciliation never deletes a row. Two distinct successful monthly
   misses are required before a managed row becomes unavailable.
7. Shorts classification is deferred in full.
8. Vercel cron invokes GET routes with `CRON_SECRET`; staff invoke POST after
   application authorization.

## 4. Existing Context and Compatibility

The current committed application already has:

- a Neon-backed `cms_videos` table created by
  `neon/migrations/20260709090000_cms_videos.sql`;
- an official-channel section and a separate listing-video section;
- reusable YouTube URL normalization in `src/lib/youtube-video-url.js`;
- cron-route conventions in `src/routes/api.mls-sync.ts`; and
- programmatic Vercel configuration in `vercel.ts`.

The design follows these conventions. It does not introduce `vercel.json`, and
it does not derive an uploads playlist ID by replacing a `UC` prefix with `UU`.
The provider first asks YouTube for the canonical uploads playlist ID.

## 5. Architecture

The implementation is split into four small server-side units so provider I/O,
database mutation, orchestration, and HTTP authorization remain independently
testable.

### 5.1 YouTube provider

**Proposed file:**
`src/lib/youtube-sync/youtube-client.server.ts`

Responsibilities:

- Validate server-only YouTube configuration.
- Call `channels.list` with `part=contentDetails` and the fixed channel ID.
- Read `relatedPlaylists.uploads` as the canonical uploads playlist ID.
- Page through `playlistItems.list` with `maxResults=50`.
- Normalize each item into the service's internal video shape.
- Reject malformed pages, repeated page tokens, wrong-channel items, and
  missing required identity fields.
- Retry only transient provider failures according to the policy in section 11.

The internal item shape contains:

- `videoId`
- `title`
- `description`
- `publishedAt`
- `canonicalUrl`

It deliberately excludes duration and Shorts classification.

### 5.2 Repository

**Proposed file:**
`src/lib/youtube-sync/youtube-repository.server.ts`

Responsibilities:

- Acquire, renew, and release the database lease.
- Read and update channel synchronization state.
- Preflight manual-row adoption and duplicate conflicts.
- Apply incremental upserts with set-based operations.
- Apply a validated full snapshot in one database transaction.
- Preserve staff-owned fields during insert, adoption, and refresh.
- Produce mutation counts without exposing row contents.

The repository owns SQL and transaction boundaries. It does not call YouTube or
decide HTTP responses.

### 5.3 Orchestrator

**Proposed file:**
`src/lib/youtube-sync/youtube-sync.server.ts`

Responsibilities:

- Accept `incremental` or `full` mode and `cron` or `staff` trigger.
- Acquire a unique lease token before provider work begins.
- Renew the lease while paging.
- Drive provider pagination and validate the completed result.
- Call the appropriate repository operation only when the provider result is
  valid for that mode.
- Return a safe structured result and structured operational error.

The orchestrator is the only unit that coordinates the provider and repository.
Routes remain thin authorization and response adapters.

### 5.4 HTTP routes

**Proposed file:** `src/routes/api.youtube-sync.ts`

- `GET`: daily incremental run for Vercel Cron; requires a valid
  `Authorization: Bearer <CRON_SECRET>` header.
- `POST`: staff-triggered run; requires an authenticated staff member with the
  existing admin or manager role and a JSON body whose `mode` is
  `incremental` or `full`.

**Proposed file:** `src/routes/api.youtube-sync.full.ts`

- `GET`: monthly full reconciliation for Vercel Cron; requires the same cron
  authorization.

The admin button that will call POST is not part of this task. The route contract
is included now so that later UI work does not need to change synchronization
internals.

## 6. Data Model

### 6.1 `cms_videos` additions

Add the following columns:

```sql
youtube_video_id text
youtube_published_at timestamptz
youtube_managed boolean not null default false
youtube_available boolean not null default true
youtube_last_seen_at timestamptz
youtube_missing_full_runs smallint not null default 0
```

Add:

- a partial unique index on `youtube_video_id` where it is non-null; and
- a check constraint requiring `youtube_missing_full_runs >= 0`.

Existing rows remain manual and visible after migration because
`youtube_managed` defaults to false and `youtube_available` defaults to true.

### 6.2 `youtube_sync_state`

Create one state row per configured channel:

```text
channel_id                    text primary key
lease_owner                   uuid null
lease_expires_at              timestamptz null
last_incremental_video_id     text null
last_incremental_completed_at timestamptz null
last_full_completed_at        timestamptz null
last_full_period              date null
updated_at                    timestamptz not null
```

`last_full_period` stores the first calendar date of the current Hong Kong month
(for example, `2026-08-01`). It is the guard that prevents two retries in the
same month from counting as two misses.

## 7. Ownership and Upsert Rules

### 7.1 Staff-owned fields

Synchronization never changes these fields on an existing row:

- `id`
- `sort_order`
- `published`
- any non-null `description`

For a new row, `sort_order` is initialized to `1000` and `published` to true.
Staff can subsequently edit either value without synchronization undoing the
change.

### 7.2 YouTube-owned fields

For a managed row, each successful sighting refreshes:

- `youtube_video_id`
- `title`
- `video_url` using the canonical watch URL
- `youtube_published_at`
- `youtube_available = true`
- `youtube_last_seen_at`
- `youtube_missing_full_runs = 0`

### 7.3 Description rule

On insert, the YouTube description is stored. On first adoption of a matching
manual row, the YouTube description is stored only when the existing description
is null. After that first insert or adoption, synchronization never overwrites
the description.

### 7.4 Manual-row adoption

Before any mutation, normalize every existing manual `video_url` with the shared
YouTube URL utility. If exactly one manual row resolves to an incoming video ID,
adopt it in place by setting its YouTube-managed fields. Preserve its UUID,
ordering, publication state, and non-null description.

If multiple manual rows normalize to the same incoming video ID, fail the entire
run during preflight and perform no video writes. This avoids choosing an
arbitrary row or silently violating the new unique index.

## 8. Public Visibility and Ordering

Public official-channel reads include rows satisfying:

```text
published = true
AND (youtube_managed = false OR youtube_available = true)
```

This keeps manual rows compatible, lets staff hide any row deliberately, and
hides a source-unavailable managed row without deleting it.

Order official-channel rows by:

1. `sort_order ASC`; then
2. `COALESCE(youtube_published_at, created_at) DESC`.

This retains manual pinning while providing newest-first order among rows with
the same editorial sort value.

## 9. Incremental Synchronization

1. Validate configuration and acquire the lease.
2. Resolve the channel's canonical uploads playlist.
3. Request pages newest first.
4. Stop when the prior `last_incremental_video_id` boundary is encountered,
   including that boundary item so a recent title change is refreshed.
5. If no boundary exists, or the stored boundary is no longer present, exhaust
   the playlist as a safe first-run or recovery backfill.
6. Validate and preflight the fetched items.
7. Upsert all fetched items. Set `last_incremental_video_id` to the first,
   newest validated item returned by the playlist and record the completion
   time. If the playlist is empty, leave the previous boundary unchanged.
8. Release the lease and return the run summary.

Incremental runs never increment absence counters and never mark a video
unavailable. A short or interrupted provider result therefore cannot be mistaken
for evidence that older videos disappeared.

## 10. Full Reconciliation

1. Validate configuration and acquire the lease.
2. Resolve the uploads playlist.
3. Fetch every page into an in-memory validated snapshot, renewing the lease
   while paging.
4. Reject the snapshot before database reconciliation if any page failed, a page
   token repeated, an item is malformed, or an item does not belong to the
   configured channel.
5. In one database transaction:
   - preflight adoption conflicts;
   - insert, adopt, or refresh every seen video;
   - reset seen rows to `youtube_missing_full_runs = 0` and
     `youtube_available = true`;
   - when the current Hong Kong monthly period differs from
     `last_full_period`, increment every unseen managed row once;
   - set an unseen managed row to `youtube_available = false` when its counter
     reaches two;
   - update full-run state and the current period.
6. Commit, release the lease, and return the summary.

A repeated successful full run within the same Hong Kong month refreshes seen
metadata but cannot increment an unseen row again. A failed or partial provider
run performs no absence mutation. Returning videos reset their miss count and
become available again; their staff-controlled `published` value is unchanged.

## 11. Concurrency, Retries, and Errors

### 11.1 Lease

The state row holds a random UUID lease token and expiry. Acquisition is atomic:
only an expired or empty lease can be claimed. Renewals and release must match the
same token, preventing a stale worker from releasing a newer worker's lease.

If another run holds the lease:

- cron GET returns HTTP 200 with `status: "skipped"` and reason
  `sync_in_progress`; and
- staff POST returns HTTP 409 with the same safe reason.

Lease expiry provides crash recovery. The lease lasts 15 minutes. Renew it after
every successfully fetched provider page, immediately before database mutation,
and whenever three minutes have elapsed during other active work. This keeps a
healthy run well inside its lease while allowing an abandoned lease to recover.

### 11.2 Provider retry policy

After the initial request fails, retry YouTube HTTP 429 and 5xx responses at most
three additional times with exponential backoff, jitter, and `Retry-After` when
supplied. Classify non-transient 403 responses rather than repeatedly retrying
them.

Safe operational codes are:

- `youtube_quota_exhausted`
- `youtube_auth_failed`
- `youtube_rate_limited`
- `youtube_unavailable`
- `youtube_invalid_snapshot`

Provider failures return a structured non-2xx response and do not mutate absence
state. Database failures roll back the active transaction. Logs and responses do
not include API keys, database URLs, raw authorization headers, or raw provider
bodies.

Vercel Cron does not supply job retries. An operator reruns a failed monthly job
through staff POST with `mode: "full"`; the same-period guard makes this safe.

## 12. Result Contract and Observability

A successful run returns and logs a summary containing:

```text
mode
trigger
pages
fetched
inserted
adopted
updated
restored
unavailable
elapsedMs
period
```

`period` is populated for a full reconciliation and null for an incremental run.
The result contains aggregate counts only. Staff POST also writes the existing
staff audit event so manual operational actions remain attributable.

## 13. Vercel Cron Configuration

Add these entries to the existing jobs in `vercel.ts` without removing or
reformatting unrelated schedules:

| Path | UTC schedule | Hong Kong window | Purpose |
| --- | --- | --- | --- |
| `/api/youtube-sync` | `0 19 * * *` | 03:00-03:59 daily | Incremental sync |
| `/api/youtube-sync/full` | `0 21 1 * *` | 05:00-05:59 on local day 2 | Monthly reconciliation |

The two-hour separation accommodates Hobby-plan hourly scheduling precision.
The database lease remains the correctness mechanism if deliveries overlap or
Vercel delivers the same event more than once.

## 14. Configuration and Security

| Setting | Source | Handling |
| --- | --- | --- |
| `YOUTUBE_API_KEY` | Google Cloud project with YouTube Data API v3 enabled | Server-only Vercel environment variable; never sent to the browser or logged |
| `CRON_SECRET` | Existing random Vercel cron secret | Compared with the bearer header by both GET routes |
| `DATABASE_URL` / `UNPOOLED_DATABASE_URL` | Existing Neon integration | Reuse the repository's current server-only database configuration |
| Channel ID | Typed server configuration | Fixed to `UCTwcj9hcQoKVpKEZY-ZgnwA`; non-secret |

Configuration is validated before acquiring provider pages or mutating video
rows. Staff POST uses the application's existing session and role checks; it does
not accept `CRON_SECRET` as staff authentication.

## 15. Testing Strategy

### 15.1 Provider unit tests

- canonical uploads-playlist lookup;
- multi-page traversal with `maxResults=50`;
- known-boundary stop including the boundary item;
- first-run and missing-boundary full traversal;
- repeated-token, malformed-item, and wrong-channel rejection; and
- transient retry plus quota, auth, rate-limit, and unavailable classification.

### 15.2 Repository tests

- insert, exact-ID update, and manual-row adoption;
- preservation of UUID, `sort_order`, `published`, and non-null description;
- null description populated only on first insert or adoption;
- partial unique-index behavior and duplicate-manual-row preflight;
- set-based bulk writes and transaction rollback; and
- visibility and ordering query semantics.

### 15.3 Reconciliation tests

- one distinct monthly miss remains available;
- another full run in the same period does not increment the counter;
- the second distinct monthly miss makes the row unavailable;
- a partial or invalid snapshot changes no absence state;
- a returning video resets the counter and restores availability; and
- a staff-unpublished video stays unpublished after return.

### 15.4 Route and configuration tests

- cron GET rejects missing or invalid authorization;
- staff POST enforces authentication, role, and mode validation;
- configuration preflight fails safely;
- cron and staff lock-contention responses differ as specified;
- responses and logs omit secrets; and
- `vercel.ts` retains every pre-existing job plus both YouTube jobs.

### 15.5 Integration test

Use a fake YouTube provider, a controlled clock, and isolated Neon or compatible
test Postgres. Exercise an initial backfill, incremental refresh, two-period
absence sequence, and restoration. Tests must never point to the production
database or call the live channel.

## 16. Rollout and Approval Gates

1. Apply the migration to an isolated database.
2. Run the implementation and automated tests against that database.
3. Configure a non-production YouTube API key and execute a staff-triggered full
   run.
4. Verify adoption, protected fields, ordering, audit output, and the run
   summary.
5. Obtain separate explicit approvals for each external or production action:
   - production Neon migration;
   - production `YOUTUBE_API_KEY` creation or installation;
   - deployment and cron activation; and
   - the first live full backfill.

Implementation approval does not imply any of these production approvals.

## 17. Acceptance Criteria

- A first incremental run can backfill the complete uploads playlist.
- Daily runs insert new uploads and refresh YouTube-owned metadata idempotently.
- A matching manual row is adopted without replacing its ID, editorial order,
  publication state, or non-null description.
- Duplicate matching manual rows cause a preflight failure with no writes.
- New uploads are publicly eligible immediately through `published = true`.
- Incremental and failed full runs never count videos as missing.
- Only two distinct successful monthly misses make a managed video unavailable.
- A returning video is restored without changing staff publication intent.
- Cron GET and staff POST use their distinct authorization mechanisms.
- Overlapping or duplicate invocations cannot reconcile concurrently.
- No rows are deleted, no secrets are exposed, and the listing-video subsystem
  is untouched.
- The task can be implemented and verified without changing `/videos` UI code.

## 18. Rejected Alternatives

### RSS for daily incremental sync

Rejected because the feed exposes only a recent window. Data API pagination and
the stored boundary provide one consistent source and a safer recovery path.

### YouTube push notifications

Rejected because webhook verification, delivery lifecycle, and reconciliation
would add operational surface without removing the need for a periodic full run.

### Derive the uploads playlist ID

Rejected in favor of the documented `channels.list` content-details lookup. The
provider should consume YouTube's canonical value rather than encode a naming
convention.

### Delete videos missing from a full run

Rejected because disappearance can be temporary or caused by bad upstream data.
Soft availability after two distinct successful periods is reversible and
preserves editorial history.

### Implement Shorts classification now

Rejected as unnecessary for synchronization correctness. It belongs with the
separate presentation design if the product later needs that distinction.

## 19. References

- [YouTube Data API video implementation guide](https://developers.google.com/youtube/v3/guides/implementation/videos)
- [YouTube `playlistItems.list`](https://developers.google.com/youtube/v3/docs/playlistItems/list)
- [YouTube quota overview](https://developers.google.com/youtube/v3/getting-started)
- [YouTube API core errors](https://developers.google.com/youtube/v3/docs/core_errors)
- [Vercel Cron management and delivery behavior](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Vercel programmatic project configuration](https://vercel.com/docs/project-configuration/vercel-ts)
- [Vercel Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)
