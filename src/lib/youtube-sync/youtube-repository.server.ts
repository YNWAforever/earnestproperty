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

export function createYouTubeSyncRepository(dependencies: { queryRows?: QueryRows } = {}) {
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
      throw new YouTubeSyncError(
        "youtube_lease_lost",
        "The YouTube synchronization lease was lost.",
        true,
      );
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
