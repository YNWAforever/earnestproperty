-- FX-08 / D-01 / D4: evidence for each WhatsApp opt-out.
-- Additive only. This file never writes `opted_out_whatsapp`; it never clears an
-- opt-out; it is re-runnable (every statement is guarded, and the legacy stamp
-- only touches rows whose `opted_out_at` is still NULL).
-- No revert: the columns stay (migration register).

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

-- Legacy stamp: freeze each existing opt-out at the latest known inbound, so only
-- a LATER customer message reopens text replies. The flag itself is not touched.
UPDATE crm_contacts
SET opted_out_at = COALESCE(last_inbound_at, updated_at, now()),
    opted_out_source = 'legacy'
WHERE opted_out_whatsapp AND opted_out_at IS NULL;
