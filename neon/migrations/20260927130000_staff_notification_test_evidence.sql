-- Bind endpoint/test snapshots to reviewed mapping versions without changing legacy rows.
ALTER TABLE staff_notification_endpoints
  ADD COLUMN IF NOT EXISTS mapping_version integer CHECK (mapping_version > 0);
ALTER TABLE staff_notification_test_previews
  ADD COLUMN IF NOT EXISTS mapping_version integer CHECK (mapping_version > 0);
ALTER TABLE staff_notification_test_attempts
  ADD COLUMN IF NOT EXISTS mapping_version integer CHECK (mapping_version > 0),
  ADD COLUMN IF NOT EXISTS channel_id_snapshot text,
  ADD COLUMN IF NOT EXISTS destination_reference_snapshot text,
  ADD COLUMN IF NOT EXISTS provider_delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS recipient_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledgement_at timestamptz,
  ADD COLUMN IF NOT EXISTS evidence_source text CHECK (length(evidence_source) <= 80);

CREATE TABLE IF NOT EXISTS staff_notification_test_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES staff_notification_test_attempts(id),
  kind text NOT NULL CHECK (kind IN ('provider_delivered','recipient_confirmed','acknowledgement')),
  source text NOT NULL CHECK (source IN ('signed_provider_receipt','manual_confirmation')),
  source_ref text NOT NULL CHECK (length(source_ref) BETWEEN 1 AND 160),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  actor_staff_id uuid REFERENCES staff_users(id),
  UNIQUE(attempt_id,kind,source,source_ref)
);
CREATE INDEX IF NOT EXISTS staff_test_evidence_attempt ON staff_notification_test_evidence(attempt_id,kind,occurred_at);
CREATE OR REPLACE FUNCTION wa_test_evidence_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TEST_EVIDENCE_APPEND_ONLY';
END $$;
DROP TRIGGER IF EXISTS wa_test_evidence_immutable ON staff_notification_test_evidence;
CREATE TRIGGER wa_test_evidence_immutable
  BEFORE UPDATE OR DELETE ON staff_notification_test_evidence FOR EACH ROW
  EXECUTE FUNCTION wa_test_evidence_append_only();

CREATE TABLE IF NOT EXISTS staff_notification_test_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES staff_notification_test_attempts(id),
  external_event_key text NOT NULL UNIQUE,
  event_kind text NOT NULL,
  occurred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
