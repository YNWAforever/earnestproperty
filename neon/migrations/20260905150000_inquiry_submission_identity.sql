CREATE TABLE IF NOT EXISTS website_inquiry_submissions (
  submission_id uuid PRIMARY KEY,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  inquiry_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS crm_lead_id uuid REFERENCES crm_leads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_inquiries_crm_lead_id ON inquiries(crm_lead_id);
-- Submission identities are tombstones after the 72-hour replay window.
-- Do not delete/reuse them during ordinary retry handling.
