-- FX-08 / D-01 / D4: evidence for each WhatsApp opt-out.
-- Additive only. This file never writes the opted_out_whatsapp flag, never clears
-- an opt-out, and is re-runnable (every statement is guarded, and the legacy
-- stamp only touches rows whose opted_out_at is still NULL).
-- No revert: the columns stay (migration register).
--
-- Rollback window: if application code is rolled back to a pre-FX-08 build after
-- this migration, that code can set the flag again (from any origin, including a
-- redelivery or a history import) without touching these columns, so the stored
-- evidence can be stale for those contacts. Before relying on the text-reopen
-- predicate (Task 3), roll forward again and re-apply this file, then review any
-- contact whose opted_out_at predates its latest inbound opt-out message.
--
-- Comments here avoid semicolons and quotes because apply-migrations.mjs splits
-- the file on them.

SET LOCAL lock_timeout = '5s';

ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS opted_out_at timestamptz;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS opted_out_message_id text;   -- whatsapp_messages.external_message_id
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS opted_out_text text;          -- raw message text, left(text, 500)
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS opted_out_source text;        -- CHECK below
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS opted_out_cleared_at timestamptz;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS opted_out_cleared_by uuid REFERENCES staff_users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'crm_contacts_opted_out_source_check'
      AND conrelid = 'crm_contacts'::regclass
  ) THEN
    ALTER TABLE crm_contacts ADD CONSTRAINT crm_contacts_opted_out_source_check
      CHECK (opted_out_source IS NULL OR opted_out_source IN ('customer_message','staff_recorded','legacy'));
  END IF;
END $$;

-- Legacy stamp: freeze each existing opt-out at the latest known time for the
-- contact (its own inbound, any of its conversations, or its last update), so only
-- a LATER customer message reopens text replies and a legacy row can never reopen
-- immediately. The flag itself is not touched.
UPDATE crm_contacts c
SET opted_out_at = COALESCE(
      GREATEST(
        c.last_inbound_at,
        (SELECT max(wc.last_inbound_at) FROM whatsapp_conversations wc WHERE wc.contact_id = c.id),
        c.updated_at
      ),
      now()),
    opted_out_source = 'legacy'
WHERE c.opted_out_whatsapp AND c.opted_out_at IS NULL;
