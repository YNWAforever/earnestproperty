-- FX-10b final fix wave, I1. A campaign re-send must reach only the WhatsApp
-- identity the earlier attempt used.
-- Adds one nullable column to whatsapp_campaign_recipients. Delivery writes it
-- when it reserves a dispatch. It holds a hex sha256 digest of the contact
-- member id and normalized phone, never the raw phone. A re-send compares the
-- digest with the contact as it is now, under the contact row lock, and blocks
-- the row as CONTACT_CHANGED_SINCE_ATTEMPT on a mismatch.
-- Additive and re-runnable. No existing row is written. Rows with no digest
-- were never attempted after this migration and behave as before.
-- No revert file: the change only adds a nullable column, which can stay.
-- Comments avoid semicolons and quotes because apply-migrations.mjs splits
-- the file on them.
SET LOCAL lock_timeout = '5s';

ALTER TABLE whatsapp_campaign_recipients
  ADD COLUMN IF NOT EXISTS attempted_identity text;
