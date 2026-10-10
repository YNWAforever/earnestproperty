-- FX-12 / C-04 and D-12. One list of contact identity problems for managers.
-- A WhatsApp message whose member id and phone point at different contacts is
-- stored in a review conversation and listed here instead of failing ingest.
-- Phone format duplicates found by scripts/neon/normalize-contact-phones.mjs
-- are listed here too. Nothing is merged automatically.
-- Additive and re-runnable. No existing row is written. No function or
-- trigger is replaced, so there is no revert file. The table can stay.
-- Comments avoid semicolons and quotes because apply-migrations.mjs splits
-- the file on them.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm_contact_identity_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reason text NOT NULL CHECK (reason IN ('whatsapp_identity_conflict','phone_format_duplicate')),
  contact_a uuid REFERENCES crm_contacts(id) ON DELETE CASCADE,
  contact_b uuid REFERENCES crm_contacts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','linked','same_person','different_people','dismissed')),
  linked_contact_id uuid REFERENCES crm_contacts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  resolution_note text,
  CONSTRAINT crm_contact_identity_reviews_distinct CHECK (contact_a IS DISTINCT FROM contact_b),
  CONSTRAINT crm_contact_identity_reviews_resolved CHECK ((status = 'open') = (resolved_at IS NULL)),
  CONSTRAINT crm_contact_identity_reviews_shape CHECK (
    (reason = 'whatsapp_identity_conflict' AND conversation_id IS NOT NULL)
    OR (reason = 'phone_format_duplicate' AND contact_a IS NOT NULL AND contact_b IS NOT NULL
        AND contact_a < contact_b AND conversation_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_identity_review_open_conversation
  ON crm_contact_identity_reviews (conversation_id)
  WHERE reason = 'whatsapp_identity_conflict' AND status = 'open';
CREATE UNIQUE INDEX IF NOT EXISTS ux_identity_review_duplicate_pair
  ON crm_contact_identity_reviews (contact_a, contact_b)
  WHERE reason = 'phone_format_duplicate';
CREATE INDEX IF NOT EXISTS idx_identity_review_open
  ON crm_contact_identity_reviews (created_at DESC) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_identity_review_conversation_linked
  ON crm_contact_identity_reviews (conversation_id) WHERE status = 'linked';
