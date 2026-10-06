-- FX-05b: duty-manager flag and lead subject for staff-alert evidence.
-- Additive and idempotent. Sends nothing, rewrites no existing row, replaces no
-- function or trigger. Apply only to owned or test databases until the owner
-- approves a production rollout.
ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS is_duty_manager boolean NOT NULL DEFAULT false;

-- A lead alert has no enquiry intent, so the attempt may carry a lead instead.
ALTER TABLE staff_notification_attempts
  ALTER COLUMN notification_id DROP NOT NULL;

ALTER TABLE staff_notification_attempts
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES crm_leads(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_attempt_one_subject'
      AND conrelid = 'staff_notification_attempts'::regclass
  ) THEN
    ALTER TABLE staff_notification_attempts
      ADD CONSTRAINT staff_attempt_one_subject
      CHECK ((notification_id IS NULL) <> (lead_id IS NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS staff_attempts_lead
  ON staff_notification_attempts(lead_id) WHERE lead_id IS NOT NULL;
