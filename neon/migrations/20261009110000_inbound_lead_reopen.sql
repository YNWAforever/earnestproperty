-- FX-09 / C-10. Replaces ensure_whatsapp_inbound_lead_fn from
-- 20260906100000_whatsapp_inbound_leads.sql. The trigger itself is unchanged.
-- A contact with no lead still gets one, as before. On a new inbound message
-- only, a contact whose leads are all closed_won or closed_lost gets a new lead
-- when the message is newer than the latest closed lead update, and a closed
-- conversation reopens when the message is at least as new as its last inbound.
-- Older messages from history import or identity moves never do either.
-- A new lead keeps the contact owner only while that staff member is active.
-- No job is queued and no history reconcile runs here. No existing row is written.
-- Rollback: neon/reverts/20261009110000_inbound_lead_reopen_revert.sql
-- Comments avoid semicolons and quotes because apply-migrations.mjs splits
-- the file on them.
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION ensure_whatsapp_inbound_lead_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE has_any boolean; has_open boolean; latest_closed timestamptz; msg_at timestamptz;
BEGIN
  IF NEW.direction::text <> 'inbound' OR NEW.contact_id IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('whatsapp-lead:' || NEW.contact_id::text, 0));
  msg_at := COALESCE(NEW.created_at, now());
  SELECT count(*) > 0,
         COALESCE(bool_or(l.stage NOT IN ('closed_won','closed_lost')), false),
         max(l.updated_at) FILTER (WHERE l.stage IN ('closed_won','closed_lost'))
    INTO has_any, has_open, latest_closed
    FROM crm_leads l WHERE l.contact_id = NEW.contact_id;
  IF NOT has_any OR (TG_OP = 'INSERT' AND NOT has_open AND msg_at > latest_closed) THEN
    INSERT INTO crm_leads(contact_id,assigned_agent_id,stage,intent,source,note,created_at,updated_at)
    SELECT c.id, CASE WHEN s.active THEN c.assigned_agent_id END, 'new','unknown','whatsapp',
      'WhatsApp 入站查詢；詳情見對話紀錄。', msg_at, msg_at
    FROM crm_contacts c LEFT JOIN staff_users s ON s.id = c.assigned_agent_id
    WHERE c.id = NEW.contact_id;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.conversation_id IS NOT NULL THEN
    UPDATE whatsapp_conversations w SET status = 'open', updated_at = now()
     WHERE w.id = NEW.conversation_id AND w.status = 'closed'
       AND (w.last_inbound_at IS NULL OR msg_at >= w.last_inbound_at);
  END IF;
  RETURN NEW;
END;
$$;
