-- Woztell member-id identity hardening.
--
-- Inbound member-id-keyed events without a phone number created duplicate
-- crm_contacts rows on every message because normalized_phone was NULL and
-- NULLs are distinct under the UNIQUE (normalized_phone) constraint. The
-- webhook already stores the stable Woztell member id in
-- crm_contacts.whatsapp_member_id, so add a partial unique index on it to let
-- the webhook upsert/lookup contacts by member id when no phone is present.
-- (whatsapp_conversations already has UNIQUE (channel_id, woztell_member_id);
-- the webhook handles its NULL-key case in application code.)

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_contacts_whatsapp_member_id
  ON crm_contacts (whatsapp_member_id)
  WHERE whatsapp_member_id IS NOT NULL;
