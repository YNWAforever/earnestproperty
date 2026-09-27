-- Expand existing staff-channel mappings without changing legacy eligibility.
-- Old manual verification references remain manual; provider review is opt-in per mapping.
ALTER TABLE whatsapp_staff_channels
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN IF NOT EXISTS review_basis text NOT NULL DEFAULT 'legacy_manual'
    CHECK (review_basis IN ('legacy_manual', 'provider_verified')),
  ADD COLUMN IF NOT EXISTS review_enforced boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS whatsapp_staff_mapping_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff_users(id),
  channel_id text NOT NULL,
  provider_scope text NOT NULL,
  inbox_user_id text NOT NULL,
  folder_id text NOT NULL,
  basis text NOT NULL CHECK (basis IN ('manual_review', 'provider_verified')),
  result text NOT NULL CHECK (result IN ('verified', 'denied', 'unknown')),
  checked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  actor_id uuid NOT NULL REFERENCES staff_users(id),
  mapping_version integer,
  reason_code text,
  CHECK (expires_at > checked_at),
  CHECK (mapping_version IS NULL OR mapping_version > 0)
);
CREATE INDEX IF NOT EXISTS wa_mapping_review_scope
  ON whatsapp_staff_mapping_reviews(staff_id,channel_id,checked_at DESC);

ALTER TABLE whatsapp_staff_channels
  ADD COLUMN IF NOT EXISTS review_evidence_id uuid
    REFERENCES whatsapp_staff_mapping_reviews(id);
CREATE UNIQUE INDEX IF NOT EXISTS wa_mapping_review_single_use
  ON whatsapp_staff_channels(review_evidence_id) WHERE review_evidence_id IS NOT NULL;

CREATE OR REPLACE FUNCTION wa_bump_staff_channel_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wa_staff_channel_version ON whatsapp_staff_channels;
CREATE TRIGGER wa_staff_channel_version
  BEFORE UPDATE ON whatsapp_staff_channels FOR EACH ROW
  EXECUTE FUNCTION wa_bump_staff_channel_version();

CREATE OR REPLACE FUNCTION wa_mapping_review_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'MAPPING_REVIEW_APPEND_ONLY';
END $$;
DROP TRIGGER IF EXISTS wa_mapping_review_immutable ON whatsapp_staff_mapping_reviews;
CREATE TRIGGER wa_mapping_review_immutable
  BEFORE UPDATE OR DELETE ON whatsapp_staff_mapping_reviews FOR EACH ROW
  EXECUTE FUNCTION wa_mapping_review_append_only();
