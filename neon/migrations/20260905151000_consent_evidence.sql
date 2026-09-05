CREATE TABLE IF NOT EXISTS crm_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  opted_in boolean NOT NULL,
  source text NOT NULL,
  evidence_ref text,
  copy_version text NOT NULL,
  actor_staff_id uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_consent_events_contact ON crm_consent_events(contact_id, created_at DESC);
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS marketing_consent_requested boolean NOT NULL DEFAULT false;
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS consent_copy_version text;
