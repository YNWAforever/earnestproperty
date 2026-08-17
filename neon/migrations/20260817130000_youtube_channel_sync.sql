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
