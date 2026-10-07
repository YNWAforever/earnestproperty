-- FX-09 / D-06. The WhatsApp profile name is stored apart from the CRM name
-- that staff edit. Ingest keeps an existing CRM name and writes the profile
-- name here instead. Additive and re-runnable. No existing row is written
-- here, see the FX-09 plan Open question 1 about a backfill.
-- Comments avoid semicolons and quotes because apply-migrations.mjs splits
-- the file on them.
SET LOCAL lock_timeout = '5s';
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS whatsapp_profile_name text;
