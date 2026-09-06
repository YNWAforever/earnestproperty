-- Additive, disabled by default. Apply in a dedicated client transaction.
-- The existing HTTP migration runner executes statements independently; it is not
-- sufficient for this writer-gated migration. Record its version in the same transaction.
-- No source collection, owner adoption, baseline approval or historical data rewrite.
LOCK TABLE properties IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS ingestion_owner TEXT NOT NULL DEFAULT 'legacy'
    CHECK (ingestion_owner IN ('legacy', 'no-hermes-v2')),
  ADD COLUMN IF NOT EXISTS ingestion_identity_policy TEXT NOT NULL DEFAULT 'legacy'
    CHECK (ingestion_identity_policy IN ('legacy', 'no-hermes-v2'));
ALTER TABLE property_sync_fields
  ADD COLUMN IF NOT EXISTS selection_reason TEXT,
  ADD COLUMN IF NOT EXISTS policy_version TEXT;
ALTER TABLE listing_source_observations DROP CONSTRAINT IF EXISTS listing_source_observations_source_check;
ALTER TABLE listing_source_observations ADD CONSTRAINT listing_source_observations_source_check
  CHECK (source IN ('old_site', '28hse_agent_540', 'propertyhk'));
ALTER TABLE property_source_links DROP CONSTRAINT IF EXISTS property_source_links_source_check;
ALTER TABLE property_source_links ADD CONSTRAINT property_source_links_source_check
  CHECK (source IN ('old_site', '28hse_agent_540', 'propertyhk'));
ALTER TABLE property_source_links ALTER COLUMN match_key DROP NOT NULL;
ALTER TABLE property_source_links DROP CONSTRAINT IF EXISTS property_source_links_link_reason_check;
ALTER TABLE property_source_links ADD CONSTRAINT property_source_links_link_reason_check
  CHECK (link_reason IN ('exact_property_no_and_deal_type', 'source_id_v2', 'exact_unit_v2'));
ALTER TABLE property_source_links DROP CONSTRAINT IF EXISTS property_source_links_match_evidence_check;
ALTER TABLE property_source_links ADD CONSTRAINT property_source_links_match_evidence_check
  CHECK (link_reason = 'source_id_v2' OR match_key IS NOT NULL);

CREATE TABLE IF NOT EXISTS mls_ingestion_policies (
  source TEXT NOT NULL CHECK (source IN ('28hse_agent_540', 'propertyhk')),
  scope_id TEXT NOT NULL CHECK (length(scope_id) BETWEEN 1 AND 200),
  policy_version TEXT NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 160),
  parser_version TEXT NOT NULL CHECK (length(parser_version) BETWEEN 1 AND 160),
  owner TEXT NOT NULL DEFAULT 'disabled' CHECK (owner IN ('disabled', 'legacy', 'no-hermes-v2')),
  publish_enabled BOOLEAN NOT NULL DEFAULT false,
  bootstrap_approved_at TIMESTAMPTZ,
  bootstrap_approved_by TEXT,
  bootstrap_approval_note TEXT,
  id_scope TEXT CHECK (id_scope IN ('global', 'branch')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source, scope_id, policy_version),
  CHECK ((bootstrap_approved_at IS NULL) = (bootstrap_approved_by IS NULL)),
  CHECK (NOT publish_enabled OR owner = 'no-hermes-v2'),
  CHECK ((source = '28hse_agent_540' AND scope_id = 'agent:540')
    OR (source = 'propertyhk' AND scope_id = 'branches:EPW,EPS,EPT')),
  CHECK (source <> '28hse_agent_540' OR id_scope IS NULL OR id_scope = 'global'),
  CHECK (NOT publish_enabled OR source <> 'propertyhk' OR id_scope IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS mls_ingestion_one_scope_owner
  ON mls_ingestion_policies (source, scope_id) WHERE owner = 'no-hermes-v2';

CREATE TABLE IF NOT EXISTS mls_ingestion_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  scraped_at TIMESTAMPTZ NOT NULL,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  run_id UUID NOT NULL REFERENCES listing_sync_runs(id),
  response JSONB NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  full_snapshot BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (source, scope_id, scraped_at),
  FOREIGN KEY (source, scope_id, policy_version)
    REFERENCES mls_ingestion_policies(source, scope_id, policy_version)
);
CREATE INDEX IF NOT EXISTS mls_ingestion_receipts_latest
  ON mls_ingestion_receipts(source, scope_id, scraped_at DESC);
CREATE TABLE IF NOT EXISTS mls_ingestion_scopes (
  source TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  last_accepted_at TIMESTAMPTZ,
  full_receipt_id UUID REFERENCES mls_ingestion_receipts(id),
  full_count INTEGER CHECK (full_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source, scope_id, policy_version),
  FOREIGN KEY (source, scope_id, policy_version)
    REFERENCES mls_ingestion_policies(source, scope_id, policy_version),
  CHECK ((full_receipt_id IS NULL) = (full_count IS NULL))
);
CREATE TABLE IF NOT EXISTS mls_source_state (
  source TEXT NOT NULL,
  external_listing_id TEXT NOT NULL CHECK (length(external_listing_id) BETWEEN 1 AND 200),
  deal_type deal_type NOT NULL,
  scope_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  observation_id UUID NOT NULL REFERENCES listing_source_observations(id),
  last_receipt_id UUID NOT NULL REFERENCES mls_ingestion_receipts(id),
  property_id UUID REFERENCES properties(id),
  unit_key TEXT,
  source_status TEXT NOT NULL CHECK (source_status IN ('active', 'delisted')),
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_accepted_at TIMESTAMPTZ NOT NULL,
  raw_identity JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_identity) = 'object'),
  PRIMARY KEY (source, external_listing_id, deal_type),
  FOREIGN KEY (source, scope_id, policy_version)
    REFERENCES mls_ingestion_policies(source, scope_id, policy_version),
  CHECK (first_seen_at <= last_accepted_at)
);
CREATE INDEX IF NOT EXISTS mls_source_state_unit
  ON mls_source_state(unit_key, deal_type) WHERE unit_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS mls_source_state_property ON mls_source_state(property_id);
CREATE INDEX IF NOT EXISTS mls_source_state_scope
  ON mls_source_state(source, scope_id, policy_version, source_status);
CREATE TABLE IF NOT EXISTS mls_source_contacts (
  source TEXT NOT NULL,
  external_listing_id TEXT NOT NULL,
  deal_type deal_type NOT NULL,
  contact JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(contact) = 'object'),
  branches JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(branches) = 'array'),
  observation_id UUID NOT NULL REFERENCES listing_source_observations(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source, external_listing_id, deal_type),
  FOREIGN KEY (source, external_listing_id, deal_type)
    REFERENCES mls_source_state(source, external_listing_id, deal_type)
);
CREATE TABLE IF NOT EXISTS mls_ingestion_conflicts (
  conflict_key TEXT PRIMARY KEY CHECK (conflict_key ~ '^[a-f0-9]{64}$'),
  property_id UUID REFERENCES properties(id),
  field_name TEXT NOT NULL,
  primary_observation_id UUID NOT NULL REFERENCES listing_source_observations(id),
  secondary_observation_id UUID NOT NULL REFERENCES listing_source_observations(id),
  resolution TEXT NOT NULL DEFAULT 'keep_28hse' CHECK (resolution = 'keep_28hse'),
  review_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed', 'reviewed')),
  primary_value JSONB,
  secondary_value JSONB,
  primary_observed_at TIMESTAMPTZ NOT NULL,
  secondary_observed_at TIMESTAMPTZ NOT NULL,
  first_run_id UUID NOT NULL REFERENCES listing_sync_runs(id),
  last_run_id UUID NOT NULL REFERENCES listing_sync_runs(id),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (first_seen_at <= last_seen_at)
);
CREATE INDEX IF NOT EXISTS mls_ingestion_conflicts_property ON mls_ingestion_conflicts(property_id, last_seen_at DESC);
CREATE TABLE IF NOT EXISTS mls_ingestion_reviews (
  review_key TEXT PRIMARY KEY CHECK (review_key ~ '^[a-f0-9]{64}$'),
  source TEXT NOT NULL CHECK (source IN ('28hse_agent_540', 'propertyhk')),
  external_listing_id TEXT NOT NULL,
  deal_type deal_type NOT NULL,
  reason TEXT NOT NULL,
  evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  observation_id UUID REFERENCES listing_source_observations(id),
  first_run_id UUID NOT NULL REFERENCES listing_sync_runs(id),
  last_run_id UUID NOT NULL REFERENCES listing_sync_runs(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Runs before admin_property_protect_source so a denied legacy write has no side effects.
-- Admin management and staff handover keep their existing explicit application boundaries.
CREATE OR REPLACE FUNCTION mls_ingestion_owner_fence_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  writer_v2 BOOLEAN := coalesce(current_setting('app.mls_writer_policy', true), '') = 'no-hermes-v2';
  admin_write BOOLEAN := coalesce(current_setting('app.admin_property_write', true), '') = 'on';
  staff_handover BOOLEAN := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    staff_handover := NEW.agent_id IS DISTINCT FROM OLD.agent_id AND NEW.agent_id IS NOT NULL
      AND current_setting('app.staff_property_handover', true) = NEW.agent_id::text;
    IF (NEW.ingestion_owner IS DISTINCT FROM OLD.ingestion_owner
        OR NEW.ingestion_identity_policy IS DISTINCT FROM OLD.ingestion_identity_policy) AND NOT writer_v2 THEN
      RAISE EXCEPTION 'MLS_INGESTION_OWNERSHIP_CONFLICT';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF (NEW.ingestion_owner = 'no-hermes-v2' OR NEW.ingestion_identity_policy = 'no-hermes-v2') AND NOT writer_v2 THEN
      RAISE EXCEPTION 'MLS_INGESTION_OWNERSHIP_CONFLICT';
    END IF;
  ELSIF OLD.ingestion_owner = 'no-hermes-v2' AND NOT (writer_v2 OR admin_write OR coalesce(staff_handover, false)) THEN
    RAISE EXCEPTION 'MLS_INGESTION_OWNERSHIP_CONFLICT';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS aaa_mls_ingestion_owner_fence ON properties;
CREATE TRIGGER aaa_mls_ingestion_owner_fence BEFORE INSERT OR UPDATE OR DELETE ON properties
  FOR EACH ROW EXECUTE FUNCTION mls_ingestion_owner_fence_fn();
CREATE OR REPLACE FUNCTION assign_property_public_identity(target_property_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  candidate properties%ROWTYPE;
  canonical_no TEXT;
  chosen_public_listing_no TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM property_public_members WHERE property_id = target_property_id) THEN RETURN; END IF;
  SELECT * INTO candidate FROM properties WHERE id = target_property_id;
  IF NOT FOUND THEN RETURN; END IF;
  -- Source numbers are metadata in v2. Only the ingestion matcher can explicitly
  -- share an issued group; automatic assignment must not join by canonical number.
  IF candidate.ingestion_identity_policy = 'no-hermes-v2' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('property-public:' || candidate.listing_no, 0));
    IF EXISTS (SELECT 1 FROM property_public_groups WHERE public_listing_no = candidate.listing_no) THEN
      RAISE EXCEPTION 'MLS_INGESTION_PUBLIC_ALIAS_CONFLICT';
    END IF;
    INSERT INTO property_public_groups(public_listing_no, canonical_property_no)
      VALUES (candidate.listing_no, NULL);
    INSERT INTO property_public_members(property_id, public_listing_no)
      VALUES (candidate.id, candidate.listing_no);
    RETURN;
  END IF;
  canonical_no := NULLIF(upper(regexp_replace(trim(candidate.canonical_property_no), '\s+', '', 'g')), '');
  PERFORM pg_advisory_xact_lock(hashtextextended('property-public:' || COALESCE(canonical_no, candidate.listing_no), 0));
  SELECT g.public_listing_no INTO chosen_public_listing_no
  FROM property_public_groups g
  WHERE canonical_no IS NOT NULL AND g.canonical_property_no = canonical_no
  ORDER BY (g.public_listing_no = canonical_no) DESC, g.created_at, g.public_listing_no LIMIT 1;
  chosen_public_listing_no := COALESCE(chosen_public_listing_no, canonical_no, candidate.listing_no);
  INSERT INTO property_public_groups(public_listing_no, canonical_property_no)
    VALUES (chosen_public_listing_no, canonical_no) ON CONFLICT (public_listing_no) DO NOTHING;
  IF EXISTS (
    SELECT 1 FROM property_public_members m JOIN properties existing ON existing.id=m.property_id
    WHERE m.public_listing_no=chosen_public_listing_no AND (
(candidate.estate_id IS NOT NULL AND existing.estate_id IS NOT NULL AND candidate.estate_id <> existing.estate_id)
          OR (candidate.district_slug IS NOT NULL AND existing.district_slug IS NOT NULL AND candidate.district_slug <> existing.district_slug)
          OR (candidate.saleable_area IS NOT NULL AND existing.saleable_area IS NOT NULL AND candidate.saleable_area <> existing.saleable_area)
          OR (candidate.gross_area IS NOT NULL AND existing.gross_area IS NOT NULL AND candidate.gross_area <> existing.gross_area)
          OR (candidate.bedrooms IS NOT NULL AND existing.bedrooms IS NOT NULL AND candidate.bedrooms <> existing.bedrooms)
          OR (NULLIF(lower(regexp_replace(trim(candidate.floor), '\s+', '', 'g')), '') IS NOT NULL
              AND NULLIF(lower(regexp_replace(trim(existing.floor), '\s+', '', 'g')), '') IS NOT NULL
              AND NULLIF(lower(regexp_replace(trim(candidate.floor), '\s+', '', 'g')), '') <>
                  NULLIF(lower(regexp_replace(trim(existing.floor), '\s+', '', 'g')), ''))
    )
  ) THEN
    UPDATE property_public_groups SET review_required=true, updated_at=now()
      WHERE public_listing_no=chosen_public_listing_no;
  END IF;
  INSERT INTO property_public_members(property_id, public_listing_no)
    VALUES(candidate.id, chosen_public_listing_no) ON CONFLICT(property_id) DO NOTHING;
END;
$$;
CREATE OR REPLACE FUNCTION revalidate_property_public_identity_after_update_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  existing_public_listing_no TEXT;
  existing_member_count INTEGER;
  canonical_no TEXT;
BEGIN
  IF NEW.ingestion_identity_policy = 'no-hermes-v2' THEN
    -- assign returns immediately for existing membership, preserving public URLs.
    PERFORM assign_property_public_identity(NEW.id);
    RETURN NEW;
  END IF;
  -- The assignment function records conflicting facts but always uses one
  -- group for the number. Reassignment is also safe for source corrections.
  PERFORM pg_advisory_xact_lock(hashtextextended('property-public:' || lock_key, 0))
  FROM (
    SELECT DISTINCT lock_key FROM unnest(ARRAY[
      COALESCE(NULLIF(upper(regexp_replace(trim(OLD.canonical_property_no), '\s+', '', 'g')), ''), OLD.listing_no),
      COALESCE(NULLIF(upper(regexp_replace(trim(NEW.canonical_property_no), '\s+', '', 'g')), ''), NEW.listing_no)
    ]) AS keys(lock_key) ORDER BY lock_key
  ) ordered_locks;
  canonical_no := NULLIF(upper(regexp_replace(trim(NEW.canonical_property_no), '\s+', '', 'g')), '');
  SELECT m.public_listing_no,
    (SELECT count(*)::int FROM property_public_members peers WHERE peers.public_listing_no=m.public_listing_no)
  INTO existing_public_listing_no, existing_member_count
  FROM property_public_members m WHERE m.property_id=NEW.id;
  IF existing_member_count=1 AND NEW.canonical_property_no IS DISTINCT FROM OLD.canonical_property_no
     AND NOT EXISTS (SELECT 1 FROM property_public_groups WHERE canonical_property_no=canonical_no AND public_listing_no<>existing_public_listing_no) THEN
    UPDATE property_public_groups SET canonical_property_no=canonical_no, updated_at=now()
      WHERE public_listing_no=existing_public_listing_no;
  END IF;
  DELETE FROM property_public_members WHERE property_id=NEW.id;
  PERFORM assign_property_public_identity(NEW.id);
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION admin_property_protect_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_no text; v_patch jsonb; v_raw jsonb; v_canonical text;
BEGIN
 IF current_setting('app.admin_property_write',true)='on' THEN RETURN NEW; END IF;
 v_canonical := NULLIF(upper(regexp_replace(trim(NEW.canonical_property_no),'\s+','','g')),'');
 -- Corrected canonical identity targets the new group, never leaks old overrides.
 IF TG_OP='UPDATE' AND NEW.canonical_property_no IS NOT DISTINCT FROM OLD.canonical_property_no THEN
   SELECT public_listing_no INTO v_no FROM property_public_members WHERE property_id=NEW.id;
 END IF;
 IF NEW.ingestion_identity_policy = 'no-hermes-v2' THEN
   -- V2 source identity corrections do not move issued membership or override ownership.
   IF TG_OP='UPDATE' THEN
     SELECT public_listing_no INTO v_no FROM property_public_members WHERE property_id=NEW.id;
   END IF;
   v_no := coalesce(v_no, NEW.listing_no);
 ELSIF v_no IS NULL THEN
   SELECT public_listing_no INTO v_no FROM property_public_groups WHERE canonical_property_no=v_canonical
   ORDER BY (public_listing_no=v_canonical) DESC,created_at,public_listing_no LIMIT 1;
 END IF;
 IF v_no IS NULL THEN v_no:=NEW.listing_no; END IF;
 -- Staff lifecycle handover is an explicit application boundary, never inferred
 -- from a source agent change. Its statement clears this transaction-local flag.
 IF TG_OP='UPDATE' AND NEW.agent_id IS DISTINCT FROM OLD.agent_id
    AND current_setting('app.staff_property_handover',true)=NEW.agent_id::text THEN
   IF NEW.id=(SELECT p.id FROM properties p JOIN property_public_members m ON m.property_id=p.id
     WHERE m.public_listing_no=v_no AND p.deal_type=NEW.deal_type
     ORDER BY p.source_updated_at DESC NULLS LAST,p.last_seen_at DESC NULLS LAST,
       p.updated_at DESC NULLS LAST,p.created_at DESC,p.id ASC LIMIT 1) THEN
     INSERT INTO admin_property_overrides(property_no) VALUES(v_no) ON CONFLICT(property_no) DO NOTHING;
     UPDATE admin_property_overrides SET
       sale=CASE WHEN NEW.deal_type::text='sale' THEN sale||jsonb_build_object('agent_id',NEW.agent_id) ELSE sale END,
       rent=CASE WHEN NEW.deal_type::text='rent' THEN rent||jsonb_build_object('agent_id',NEW.agent_id) ELSE rent END,
       revision=revision+1,updated_at=clock_timestamp() WHERE property_no=v_no;
   END IF;
   RETURN NEW;
 END IF;
 SELECT shared || CASE NEW.deal_type::text WHEN 'sale' THEN sale WHEN 'rent' THEN rent ELSE '{}'::jsonb END
 INTO v_patch FROM admin_property_overrides WHERE property_no=v_no;
 IF v_patch IS NULL OR v_patch='{}'::jsonb THEN RETURN NEW; END IF;
 v_raw:=to_jsonb(NEW);
 INSERT INTO admin_property_source_snapshots(property_no,property_id,operation,payload) VALUES(v_no,NEW.id,TG_OP,v_raw);
 -- Defense in depth: even malformed directly-written override JSON cannot change identity/source keys.
 SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO v_patch FROM jsonb_each(v_patch)
 WHERE key=ANY(ARRAY['title_zh','title_en','estate_id','district_slug','address','saleable_area','bedrooms','bathrooms','floor','description','images','seo_title','seo_description','video_url','price','rent','status','agent_id']);
 NEW:=jsonb_populate_record(NEW,v_patch);
 RETURN NEW;
END $$;

-- Cross-record evidence is checked at COMMIT. The writer can create a receipt
-- placeholder first and finish its response after every atomic ingestion effect.
CREATE UNIQUE INDEX IF NOT EXISTS mls_ingestion_policy_parser_identity
  ON mls_ingestion_policies(source, scope_id, policy_version, parser_version);
CREATE UNIQUE INDEX IF NOT EXISTS mls_ingestion_receipt_scope_identity
  ON mls_ingestion_receipts(source, scope_id, policy_version, id);
CREATE UNIQUE INDEX IF NOT EXISTS mls_observation_source_identity
  ON listing_source_observations(source, external_listing_id, deal_type, id);
CREATE INDEX IF NOT EXISTS mls_ingestion_scopes_full_receipt
  ON mls_ingestion_scopes(full_receipt_id) WHERE full_receipt_id IS NOT NULL;
ALTER TABLE mls_ingestion_receipts DROP CONSTRAINT IF EXISTS mls_receipt_policy_parser_fk;
ALTER TABLE mls_ingestion_receipts ADD CONSTRAINT mls_receipt_policy_parser_fk
  FOREIGN KEY (source, scope_id, policy_version, parser_version)
  REFERENCES mls_ingestion_policies(source, scope_id, policy_version, parser_version)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE mls_ingestion_scopes DROP CONSTRAINT IF EXISTS mls_scope_full_receipt_fk;
ALTER TABLE mls_ingestion_scopes ADD CONSTRAINT mls_scope_full_receipt_fk
  FOREIGN KEY (source, scope_id, policy_version, full_receipt_id)
  REFERENCES mls_ingestion_receipts(source, scope_id, policy_version, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE mls_source_state DROP CONSTRAINT IF EXISTS mls_state_receipt_scope_fk;
ALTER TABLE mls_source_state ADD CONSTRAINT mls_state_receipt_scope_fk
  FOREIGN KEY (source, scope_id, policy_version, last_receipt_id)
  REFERENCES mls_ingestion_receipts(source, scope_id, policy_version, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE mls_source_state DROP CONSTRAINT IF EXISTS mls_state_observation_identity_fk;
ALTER TABLE mls_source_state ADD CONSTRAINT mls_state_observation_identity_fk
  FOREIGN KEY (source, external_listing_id, deal_type, observation_id)
  REFERENCES listing_source_observations(source, external_listing_id, deal_type, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE mls_source_contacts DROP CONSTRAINT IF EXISTS mls_contact_observation_identity_fk;
ALTER TABLE mls_source_contacts ADD CONSTRAINT mls_contact_observation_identity_fk
  FOREIGN KEY (source, external_listing_id, deal_type, observation_id)
  REFERENCES listing_source_observations(source, external_listing_id, deal_type, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION mls_ingestion_full_baseline_guard_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE invalid_baseline BOOLEAN;
BEGIN
  -- Read final stored rows rather than the earlier trigger NEW image: a receipt
  -- response may legitimately be completed later in this same transaction.
  IF TG_TABLE_NAME = 'mls_ingestion_scopes' THEN
    SELECT EXISTS (
      SELECT 1 FROM mls_ingestion_scopes s
      LEFT JOIN mls_ingestion_receipts r ON r.id = s.full_receipt_id
      WHERE s.source = NEW.source AND s.scope_id = NEW.scope_id AND s.policy_version = NEW.policy_version
        AND s.full_receipt_id IS NOT NULL AND (
          r.id IS NULL OR NOT r.full_snapshot OR
          CASE WHEN jsonb_typeof(r.response #> '{summary,advertisement_count}') = 'number'
            THEN (r.response #>> '{summary,advertisement_count}')::numeric <> s.full_count
            ELSE true END
        )
    ) INTO invalid_baseline;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM mls_ingestion_scopes s
      LEFT JOIN mls_ingestion_receipts r ON r.id = s.full_receipt_id
      WHERE s.full_receipt_id = NEW.id AND (
        r.id IS NULL OR NOT r.full_snapshot OR
        CASE WHEN jsonb_typeof(r.response #> '{summary,advertisement_count}') = 'number'
          THEN (r.response #>> '{summary,advertisement_count}')::numeric <> s.full_count
          ELSE true END
      )
    ) INTO invalid_baseline;
  END IF;
  IF invalid_baseline THEN RAISE EXCEPTION 'MLS_INGESTION_BASELINE_CONFLICT'; END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS mls_scope_full_baseline_guard ON mls_ingestion_scopes;
CREATE CONSTRAINT TRIGGER mls_scope_full_baseline_guard
  AFTER INSERT OR UPDATE ON mls_ingestion_scopes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION mls_ingestion_full_baseline_guard_fn();
DROP TRIGGER IF EXISTS mls_receipt_full_baseline_guard ON mls_ingestion_receipts;
CREATE CONSTRAINT TRIGGER mls_receipt_full_baseline_guard
  AFTER INSERT OR UPDATE ON mls_ingestion_receipts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION mls_ingestion_full_baseline_guard_fn();
