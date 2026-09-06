-- Inbound WhatsApp messages are recorded enquiries. Keep intake atomic with
-- message ingestion and do not infer buying intent or marketing consent.
LOCK TABLE whatsapp_messages IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE crm_leads IN SHARE ROW EXCLUSIVE MODE;

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

DROP TRIGGER IF EXISTS ensure_whatsapp_inbound_lead ON whatsapp_messages;
CREATE TRIGGER ensure_whatsapp_inbound_lead
AFTER INSERT OR UPDATE OF contact_id,direction ON whatsapp_messages
FOR EACH ROW EXECUTE FUNCTION ensure_whatsapp_inbound_lead_fn();

-- Reconcile history without changing existing stages, facts or assignments.
INSERT INTO crm_leads(contact_id,assigned_agent_id,stage,intent,source,note,created_at,updated_at)
SELECT c.id,c.assigned_agent_id,'new','unknown','whatsapp',
  'WhatsApp 入站查詢；詳情見對話紀錄。',min(m.created_at),max(m.created_at)
FROM whatsapp_messages m JOIN crm_contacts c ON c.id=m.contact_id
WHERE m.direction::text='inbound'
  AND NOT EXISTS (SELECT 1 FROM crm_leads l WHERE l.contact_id=c.id)
GROUP BY c.id,c.assigned_agent_id;
