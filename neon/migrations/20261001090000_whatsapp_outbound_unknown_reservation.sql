-- Retain existing intents and jobs. No provider call, replay or activation.
-- Conversation row locking also serializes with the existing dispatch worker.
CREATE INDEX IF NOT EXISTS wa_outbound_unresolved
  ON whatsapp_outbound_intents(conversation_id,created_at,id)
  WHERE state IN ('dispatching','unknown');

CREATE OR REPLACE FUNCTION wa_guard_outbound_reservation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Existing service automation retains its own authorization/activation gates.
  IF NEW.actor_type <> 'staff' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NOT (OLD.state='queued' AND NEW.state='dispatching') THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM whatsapp_conversations WHERE id=NEW.conversation_id FOR UPDATE;
  -- An INSERT's outer authorization snapshot may predate this lock wait.
  IF NOT wa_can_read_conversation(NEW.actor_staff_id,NEW.conversation_id)
    OR EXISTS(SELECT 1 FROM inquiries q WHERE q.id=NEW.enquiry_id
      AND q.attribution_method='explicit_customer_statement' AND q.link_open_id IS NULL
      AND NOT wa_can_reply_enquiry(NEW.actor_staff_id,q.id)) THEN
    IF TG_OP='INSERT' THEN RAISE EXCEPTION 'OUTBOUND_CONFLICT_OR_NOT_FOUND'; END IF;
    NEW.state:='cancelled';
    NEW.error:='OUTBOUND_CONFLICT_OR_NOT_FOUND';
    NEW.dispatch_started_at:=OLD.dispatch_started_at;
    RETURN NEW;
  END IF;
  -- Let the existing actor/payload-bound ON CONFLICT resolve the original ID.
  IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM whatsapp_outbound_intents WHERE id=NEW.id) THEN
    RETURN NEW;
  END IF;
  IF EXISTS(SELECT 1 FROM whatsapp_outbound_intents
    WHERE conversation_id=NEW.conversation_id AND id<>NEW.id
      AND state IN ('dispatching','unknown')) THEN
    IF TG_OP='INSERT' THEN
      RAISE EXCEPTION 'OUTBOUND_RECONCILIATION_REQUIRED';
    END IF;
    -- A previously queued different request must not cross the provider boundary.
    NEW.state:='cancelled';
    NEW.error:='OUTBOUND_RECONCILIATION_REQUIRED';
    NEW.dispatch_started_at:=OLD.dispatch_started_at;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wa_intent_unknown_reservation ON whatsapp_outbound_intents;
CREATE TRIGGER wa_intent_unknown_reservation
  BEFORE INSERT OR UPDATE OF state ON whatsapp_outbound_intents
  FOR EACH ROW EXECUTE FUNCTION wa_guard_outbound_reservation();
