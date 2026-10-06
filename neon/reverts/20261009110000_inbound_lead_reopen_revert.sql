-- Rollback for neon/migrations/20261009110000_inbound_lead_reopen.sql.
-- Restores the ensure_whatsapp_inbound_lead_fn body from
-- 20260906100000_whatsapp_inbound_leads.sql verbatim. A contact then gets a lead
-- only while it has no lead at all, and a closed conversation never reopens.
-- No history reconcile and no LOCK TABLE. The trigger itself is unchanged.
--
-- This file lives outside neon/migrations on purpose: npm run neon:migrate and the
-- migration drift check never discover it. Apply it by hand inside BEGIN and COMMIT,
-- with owner approval. It leaves the forward migration app_migrations row in place,
-- so the drift check still reports up to date and neon:migrate will not re-apply the
-- forward file. Re-apply the forward file by hand inside BEGIN and COMMIT if needed.
-- Comments avoid semicolons and quotes because apply-migrations.mjs splits
-- the file on them.
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION ensure_whatsapp_inbound_lead_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.direction::text <> 'inbound' OR NEW.contact_id IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('whatsapp-lead:' || NEW.contact_id::text, 0));
  INSERT INTO crm_leads(contact_id,assigned_agent_id,stage,intent,source,note,created_at,updated_at)
  SELECT c.id,c.assigned_agent_id,'new','unknown','whatsapp',
    'WhatsApp 入站查詢；詳情見對話紀錄。',COALESCE(NEW.created_at,now()),COALESCE(NEW.created_at,now())
  FROM crm_contacts c WHERE c.id=NEW.contact_id
    AND NOT EXISTS (SELECT 1 FROM crm_leads l WHERE l.contact_id=c.id);
  RETURN NEW;
END;
$$;
