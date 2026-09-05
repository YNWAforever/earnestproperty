-- Receipt events are durable evidence, never customer transcript content.
CREATE TABLE IF NOT EXISTS whatsapp_delivery_events (
 id text PRIMARY KEY, external_message_id text, channel_id text, woztell_member_id text,
 status text NOT NULL CHECK(status IN ('sent','delivered','read','failed','deleted')),
 payload jsonb NOT NULL, occurred_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS whatsapp_delivery_event_identity ON whatsapp_delivery_events(external_message_id,channel_id,woztell_member_id);
CREATE OR REPLACE FUNCTION woztell_refresh_message_status() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
 IF NEW.direction::text <> 'outbound' THEN RETURN NEW; END IF;
 SELECT status INTO v_status FROM whatsapp_delivery_events
 WHERE external_message_id=NEW.external_message_id AND channel_id=NEW.channel_id AND woztell_member_id=NEW.woztell_member_id
 ORDER BY CASE status WHEN 'read' THEN 5 WHEN 'delivered' THEN 4 WHEN 'sent' THEN 3 WHEN 'deleted' THEN 2 ELSE 1 END DESC LIMIT 1;
 IF v_status IS NOT NULL AND (NEW.status NOT IN ('read','delivered') OR v_status='read') THEN NEW.status=v_status; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS woztell_refresh_message_status ON whatsapp_messages;
CREATE TRIGGER woztell_refresh_message_status BEFORE INSERT OR UPDATE ON whatsapp_messages FOR EACH ROW EXECUTE FUNCTION woztell_refresh_message_status();

-- Preserve all legacy payloads before removing misclassified receipt bubbles.
INSERT INTO whatsapp_delivery_events(id,external_message_id,channel_id,woztell_member_id,status,payload,occurred_at)
SELECT 'legacy:'||m.id,m.external_message_id,m.channel_id,m.woztell_member_id,
 CASE WHEN upper(m.message_type) IN ('SENT','DELIVERED','READ','FAILED','DELETED') THEN lower(m.message_type) ELSE 'failed' END,m.payload,m.created_at
FROM whatsapp_messages m WHERE nullif(trim(m.text),'') IS NULL
 AND (upper(m.message_type) IN ('SENT','DELIVERED','READ','FAILED','DELETED') OR (m.message_type='UNKNOWN' AND (m.payload#>'{messageEvent,error}') IS NOT NULL))
 AND NOT EXISTS(SELECT 1 FROM whatsapp_outbound_intents i WHERE i.message_id=m.id)
ON CONFLICT(id) DO NOTHING;
DELETE FROM whatsapp_messages m USING whatsapp_delivery_events e WHERE e.id='legacy:'||m.id
 AND NOT EXISTS(SELECT 1 FROM whatsapp_outbound_intents i WHERE i.message_id=m.id);
UPDATE whatsapp_messages m SET status=m.status WHERE direction='outbound'
 AND EXISTS(SELECT 1 FROM whatsapp_delivery_events e WHERE e.external_message_id=m.external_message_id AND e.channel_id=m.channel_id AND e.woztell_member_id=m.woztell_member_id);
UPDATE whatsapp_conversations c SET last_message_at=(SELECT max(created_at) FROM whatsapp_messages m WHERE m.conversation_id=c.id),
 last_inbound_at=(SELECT max(created_at) FROM whatsapp_messages m WHERE m.conversation_id=c.id AND m.direction='inbound')
 WHERE EXISTS(SELECT 1 FROM whatsapp_delivery_events e WHERE e.channel_id=c.channel_id AND e.woztell_member_id=c.woztell_member_id);
