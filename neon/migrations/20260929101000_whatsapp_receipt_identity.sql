-- Keep historical keys intact. New verified receipts receive scoped identities;
-- no unproven historical scope is backfilled.
ALTER TABLE whatsapp_inbound_receipts
  ADD COLUMN IF NOT EXISTS delivery_count integer NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS wa_inbound_receipts_provider_identity
  ON whatsapp_inbound_receipts (tenant_key,app_id,channel_id,identity_key)
  WHERE identity_key IS NOT NULL;
