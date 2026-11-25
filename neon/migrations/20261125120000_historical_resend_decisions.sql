-- Reviewed historical staff resend: one immutable decision per claimed attempt.
-- The attempt itself lives in staff_notification_attempts (lead_id subject, reserved
-- attempt_key prefix). No seeding, no activation, no provider call here.
CREATE TABLE IF NOT EXISTS historical_resend_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES crm_leads(id),
  actor_staff_id uuid NOT NULL REFERENCES staff_users(id),
  channel_id text NOT NULL,
  staff_id uuid NOT NULL REFERENCES staff_users(id),
  transport text NOT NULL CHECK (transport IN ('website_lead_phone')),
  endpoint_id uuid NOT NULL REFERENCES staff_notification_endpoints(id),
  endpoint_version integer NOT NULL CHECK (endpoint_version > 0),
  attempt_id uuid NOT NULL REFERENCES staff_notification_attempts(id),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  decision text NOT NULL CHECK (decision IN ('approved_dispatch')),
  note text CHECK (note IS NULL OR length(note) <= 200),
  decided_at timestamptz NOT NULL DEFAULT now(),
  -- One decision per attempt: a repeat submit can never mint a second approval.
  UNIQUE (attempt_id)
);
CREATE INDEX IF NOT EXISTS historical_resend_decisions_lead
  ON historical_resend_decisions(lead_id, channel_id, decided_at DESC);

-- The reviewed lane is phone-only; a member id is never a historical resend target.
CREATE INDEX IF NOT EXISTS staff_attempts_historical_resend
  ON staff_notification_attempts(lead_id, dispatch_state, created_at DESC)
  WHERE attempt_key LIKE 'historical-resend:%';

-- Decisions are evidence: they are inserted once and never edited or deleted.
CREATE OR REPLACE FUNCTION historical_resend_decision_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'HISTORICAL_RESEND_DECISION_IMMUTABLE';
END $$;
DROP TRIGGER IF EXISTS historical_resend_decision_immutable ON historical_resend_decisions;
CREATE TRIGGER historical_resend_decision_immutable
  BEFORE UPDATE OR DELETE ON historical_resend_decisions
  FOR EACH ROW EXECUTE FUNCTION historical_resend_decision_immutable();
