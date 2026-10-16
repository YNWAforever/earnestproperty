# YouTube incremental updates

This runbook supersedes the schedule in the historical August design. The channel
is fixed to `UCTwcj9hcQoKVpKEZY-ZgnwA`. Code changes and offline verification do
not mean production sync, publication or deployment has been approved.

## Cause and source changes

Commit `efd0c9127526407be3ed1541e3a2a664f33af4bb` (2026-09-25) removed the
YouTube Vercel schedules while reducing idle database wakeups. Main
`a9533a58c7dc9ee007986abe4aeb527125d6c692` still had `crons: []`.

The proposed `vercel.ts` restores **only** `/api/youtube-sync`, `0 19 * * *`,
19:00 UTC / 03:00 Hong Kong the next day. Hobby may invoke at any point in that
hour. `/api/youtube-sync/full` remains unscheduled. Job lanes retain their
demand-driven wakes and Cloudflare sweep. This file does not enable a live cron
until an approved deployment applies it.

The incremental cutoff is a YouTube ID, not a date. Pages contain up to 50 items;
the cutoff item is included to refresh its metadata. A missing cutoff falls back
to traversing the playlist, still under **incremental** semantics, with no absence
updates. A normal increment will not find older gaps behind a known cutoff.

An approved staff request may include `backfillVideoIds` (up to 50 valid IDs)
alongside `mode: "incremental"`. Reads continue beyond the cutoff until those
IDs are found; only requested older items and the normal incremental window are
submitted. A missing requested ID fails the entire read. This option is rejected
in full mode. It is not available through untrusted cron query parameters.

## Safety and status

- GET requires the existing timing-safe `CRON_SECRET` bearer check. Staff POST
  requires `cms.publish`. No key or token is sent to the frontend.
- The existing atomic per-channel lease and pre-write ownership guard protect
  overlapping invocations. The unique `youtube_video_id` index provides stable
  upserts. Unchanged incremental rows are not rewritten. Staff descriptions,
  publication decisions, categories and sort orders remain intact.
- All accepted pages validate before the single set-based mutation. A provider
  error on a later page commits no earlier batch. Incremental reads never delete,
  unpublish or increase missing-full-run counters for omitted videos.
- Provider requests have a 15-second timeout, at most four attempts, exponential
  backoff and a 90-second overall read deadline. A traversal is capped at 100
  pages. A `Retry-After` over five seconds stops visibly instead of waiting beyond
  the run budget. Authorization and quota errors are permanent for this run;
  they do not trigger credential changes, another provider or unlimited retries.
- Vercel does not retry failed cron invocations. The bounded client retries cover
  transient reads; failures remain visible for review and the next daily run.
- Existing `ops_audit_logs` stores `youtube.sync.started` and
  `youtube.sync.result` records with aggregate counts and fixed error codes.
  Cron records have a NULL staff actor. Existing staff-request audit remains.
  **No schema migration is required.**
- The CMS video tab shows the panel only with `cms.publish` and reads these records on opening and explicit refresh only.
  It shows last attempt, last fully recorded success, inserts, adoptions, actual
  updates, failures and a sanitized explanation. Unknown failed-video counts
  remain unknown. Partial commits/cleanup failures and expired attempts without
  a result do not appear fully successful.
- The last-success display uses completed result records, not lease heartbeats
  or the source-write timestamp. `last_incremental_completed_at` in
  `youtube_sync_state` remains the atomic source-commit checkpoint; if later
  cleanup fails it is evidence that data may already have committed, not overall
  success. Reconcile before retrying unknown outcomes. History begins with this
  version; it does not invent records for earlier runs.

The public query still requires `published = true AND (youtube_managed = false
OR youtube_available = true)`. New source inserts use `published = true`, so an
approved production backfill **can immediately change public data**. Existing
unpublished records remain unpublished. `/videos` reads the DB via its loader,
without an application video-result cache; normal document revalidation on a new
request sees committed data. Its client loader cache may retain a page already
open; reload to verify. Images remain thumbnail facades, and load-more is local
pagination in batches of 12. No cache-wide purge or new polling is added.

## Read-only preview before any backfill

Use `scripts/youtube-sync-preview.ts` with captured JSON files, never a production
sync endpoint disguised as a dry run. See `scripts/fixtures/youtube-sync/` for the synthetic inputs.
The utility has no DB client, API key, online mode or mutation path.

From the repository root, run the explicitly synthetic sample:

```powershell
bun --no-env-file scripts/youtube-sync-preview.ts --uploads scripts/fixtures/youtube-sync/uploads.synthetic.json --inventory scripts/fixtures/youtube-sync/inventory.synthetic.json --json .audit/sample-preview.json --markdown .audit/sample-preview.md
```

The output directory must already exist and both output paths must be new.
The sample conditionally reports 2 inserts and 1 unchanged hidden row; it is not
real channel evidence or permission to import. Use different output filenames
on subsequent runs to preserve prior evidence.

Capture source evidence and inventory **by ID**. A public `/videos` capture is
only a published subset: absence there cannot prove absence from CMS. Read-only
full CMS inventory and the saved cutoff must be checked under a separately
authorized production-data inspection before treating insert/update estimates
as exact. Preserve capture time, source provenance, completeness and unknowns.
Never derive a cutoff from the total count or fabricate descriptions/dates.

The local public observation at **2026-10-16 19:00 HKT** found 135 published
videos, newest `2026-09-24T08:31:14Z`, and these 15 public-list gaps:

```text
QYfxr1g1ZcQ  KEjti_AsMAQ  vBO9mMeT7Mc  n-FxOCaipWA  Tq2Gv3R4fGI
k_LYk6OXOAg  -7VuLDwOObM  L6_2uj85nc8  F59WAG2Tywo  V4l-_UjJ-Ro
emG_bJVjBkw  8-4HV2hDbUY  fzik7vPBG7g  kQmRW2SiAp4  JtPoiVjUUMc
```

The first 14 were present on the channel's videos tab; `JtPoiVjUUMc` was on the
Shorts tab. All 15 also appeared in its RSS feed and were absent from all 135 IDs
in the public loader data. This is a lower bound from partial public channel
pages, **not** a full provider/API snapshot or proof of 15 new DB rows. Actual
insert/update counts remain unknown until the full inventory is compared.
Do not publish public-page descriptions as provider metadata. Raw observations
and the actual preview remain in local private task evidence, separate from
synthetic fixtures.

## Quota and database wakeups

Official documents checked 2026-10-16:

- `https://developers.google.com/youtube/v3/docs/playlistItems/list`
- `https://developers.google.com/youtube/v3/determine_quota_cost`
- `https://vercel.com/docs/cron-jobs/manage-cron-jobs`

`channels.list` and `playlistItems.list` each cost one unit. A successful run
reading P pages therefore uses **1 + P units**, usually **2 units/day** while
the prior cutoff is on page one. Even an empty delta still reads the first page.
Four attempts per request give an upper bound of `4 * (1 + P)` units; the 100-page
cap bounds a traversal to 404 units before the time budget stops it earlier.
There is no search.list, videos.list or new paid service in this flow.

The daily invocation adds at most one normal idle wake window per day, with
`7 + P` normal repository/history round trips (8 for one page), plus any exceptional
lease heartbeat. No-op runs still record attempts/results/checkpoints, but
do not rewrite the catalogue. Unchanged rows retain their previous `youtube_last_seen_at`; the audit records the new attempt. Full reconciliation still updates observation bookkeeping. Staff opening/refreshing status adds one read.
Actual Neon/Vercel charges depend on existing plans and measured execution;
zero cost and remaining quota have not been asserted or changed.

## Approval and production verification

Before production action, request one consolidated approval covering:

1. Publish the reviewed branch/PR, merge after exact-head checks, and deploy the
   verified source. This activates the daily cron; keep monthly full disabled.
2. Read-only full CMS inventory/checkpoint inspection and a fresh exact-ID
   preview, including drafts and adoption conflicts.
3. One incremental backfill against the approved IDs, after checking the preview,
   existing credentials/quota and expected publication. No table reset or full
   reconciliation.

Verify deployment source equals the approved merge SHA. Check cron registration
and existing auth configuration without printing credentials. Do not trigger sync
as an auth probe. After the approved backfill, read every approved missing ID from
the public `/videos` loader, verify source publication dates, newest video and
Short, uniqueness, load-more and recorded counts. Retain failed/partial evidence.
HTTP 200, a matching total or Vercel READY alone cannot close acceptance.

## Rollback

Revert only the approved YouTube repair commit(s) and deploy that source with
separate approval, or disable only the new YouTube cron in a reviewed config
change. Keep the unrelated wake optimizations. No database rollback/migration
is needed. Do not delete imported videos or rewind the checkpoint as a rollback;
first reconcile exact IDs and publication decisions read-only, then request
approval for any corrective data changes.
