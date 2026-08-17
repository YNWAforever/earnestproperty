ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS canonical_property_no TEXT;

UPDATE properties
SET canonical_property_no = upper(regexp_replace(trim(legacy_property_no), '\\s+', '', 'g'))
WHERE canonical_property_no IS NULL
  AND legacy_property_no IS NOT NULL
  AND trim(legacy_property_no) <> '';

CREATE INDEX IF NOT EXISTS idx_properties_canonical_property_no_deal
  ON properties (canonical_property_no, deal_type);

CREATE TABLE IF NOT EXISTS listing_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_for DATE NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  mode TEXT NOT NULL CHECK (mode IN ('shadow', 'publish')),
  status TEXT NOT NULL CHECK (status IN (
    'running', 'shadow_healthy', 'healthy', 'degraded', 'blocked', 'failed', 'lock_skipped'
  )),
  parser_version TEXT NOT NULL,
  source_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  baselines JSONB NOT NULL DEFAULT '{}'::jsonb,
  failure_code TEXT,
  failure_summary TEXT,
  baseline_approved_at TIMESTAMPTZ,
  baseline_approved_by TEXT,
  baseline_approval_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_sync_runs_started
  ON listing_sync_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_sync_runs_status
  ON listing_sync_runs (status, started_at DESC);

CREATE TABLE IF NOT EXISTS listing_source_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES listing_sync_runs(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('old_site', '28hse_agent_540')),
  external_listing_id TEXT NOT NULL,
  deal_type deal_type NOT NULL,
  source_url TEXT NOT NULL,
  property_no_raw TEXT,
  property_no_normalized TEXT,
  payload JSONB NOT NULL,
  media_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  content_hash TEXT NOT NULL,
  validation_state TEXT NOT NULL CHECK (validation_state IN ('valid', 'quarantined')),
  quarantine_reasons TEXT[] NOT NULL DEFAULT '{}',
  parse_warnings TEXT[] NOT NULL DEFAULT '{}',
  discovered_at TIMESTAMPTZ NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, source, external_listing_id, deal_type)
);

CREATE INDEX IF NOT EXISTS idx_listing_observations_match
  ON listing_source_observations (property_no_normalized, deal_type, run_id);
CREATE INDEX IF NOT EXISTS idx_listing_observations_source_external
  ON listing_source_observations (source, external_listing_id, deal_type, fetched_at DESC);

CREATE TABLE IF NOT EXISTS property_source_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('old_site', '28hse_agent_540')),
  external_listing_id TEXT NOT NULL,
  deal_type deal_type NOT NULL,
  match_key TEXT NOT NULL,
  link_reason TEXT NOT NULL CHECK (link_reason = 'exact_property_no_and_deal_type'),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'rejected')),
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_run_id UUID NOT NULL REFERENCES listing_sync_runs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, external_listing_id, deal_type)
);

CREATE INDEX IF NOT EXISTS idx_property_source_links_property
  ON property_source_links (property_id, status);
CREATE INDEX IF NOT EXISTS idx_property_source_links_match
  ON property_source_links (match_key, status);

CREATE TABLE IF NOT EXISTS property_sync_fields (
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  last_published_value JSONB,
  override_value JSONB,
  active_override BOOLEAN NOT NULL DEFAULT false,
  winning_observation_id UUID REFERENCES listing_source_observations(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, field_name)
);

CREATE TABLE IF NOT EXISTS property_sync_state (
  property_id UUID PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  consecutive_absent_healthy_runs INT NOT NULL DEFAULT 0 CHECK (consecutive_absent_healthy_runs >= 0),
  last_evaluated_run_id UUID REFERENCES listing_sync_runs(id) ON DELETE SET NULL,
  inactive_reason TEXT,
  inactive_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listing_change_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES listing_sync_runs(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL CHECK (change_type IN ('new', 'changed', 'inactive', 'reactivated', 'link_change')),
  field_name TEXT,
  old_value JSONB,
  new_value JSONB,
  winning_observation_id UUID REFERENCES listing_source_observations(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_change_events_property
  ON listing_change_events (property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_change_events_run
  ON listing_change_events (run_id, change_type);

ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS media_assets_content_hash_key
  ON media_assets (content_hash)
  WHERE content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS listing_media_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id UUID NOT NULL REFERENCES listing_source_observations(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  source_url TEXT NOT NULL,
  content_hash TEXT,
  owned_media_asset_id UUID REFERENCES media_assets(id) ON DELETE SET NULL,
  detected_mime TEXT,
  size_bytes BIGINT,
  width INT,
  height INT,
  eligibility TEXT NOT NULL CHECK (eligibility IN ('eligible', 'rejected', 'upload_failed')),
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (observation_id, source_url)
);

CREATE INDEX IF NOT EXISTS idx_listing_media_records_hash
  ON listing_media_records (content_hash)
  WHERE content_hash IS NOT NULL;
