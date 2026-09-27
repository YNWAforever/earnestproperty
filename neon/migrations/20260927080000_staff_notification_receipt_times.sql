-- Keep provider acceptance, authenticated delivery and read receipts distinct.
-- Apply before the matching application release. This migration sends no message.
ALTER TABLE staff_notification_attempts
  ADD COLUMN IF NOT EXISTS provider_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_acceptance_source text,
  ADD COLUMN IF NOT EXISTS provider_delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_delivery_source text,
  ADD COLUMN IF NOT EXISTS provider_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_read_source text;
