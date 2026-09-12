-- Phase 3: no tenant configuration or service policy approval is seeded.
CREATE TABLE IF NOT EXISTS whatsapp_staff_channels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 staff_id uuid NOT NULL REFERENCES staff_users(id),
 channel_id text NOT NULL, inbox_user_id text NOT NULL, folder_id text NOT NULL,
 routing_node_id text NOT NULL, branch_id text, eligible boolean NOT NULL DEFAULT false,
 verification_ref text, verified_at timestamptz,
 verified_by uuid REFERENCES staff_users(id), retired_at timestamptz,
 CHECK(NOT eligible OR (verification_ref IS NOT NULL AND verified_at IS NOT NULL AND retired_at IS NULL)),
 UNIQUE(channel_id,inbox_user_id), UNIQUE(channel_id,staff_id)
);
ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS assignment_version bigint NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS assignment_lock boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS pending_assignment_id uuid,
 ADD COLUMN IF NOT EXISTS confirmed_staff_id uuid REFERENCES staff_users(id);
CREATE TABLE IF NOT EXISTS whatsapp_assignment_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id),
 desired_staff_id uuid REFERENCES staff_users(id),
 requested_by uuid REFERENCES staff_users(id),
 version bigint NOT NULL, reason text NOT NULL, state text NOT NULL DEFAULT 'pending'
 CHECK(state IN ('pending','executing','confirmed','failed','unknown')),
 target_snapshot jsonb NOT NULL DEFAULT '{}', claim_id uuid, started_at timestamptz, finished_at timestamptz, evidence jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(conversation_id,version)
);
CREATE UNIQUE INDEX IF NOT EXISTS wa_assignment_singleflight ON whatsapp_assignment_requests(conversation_id) WHERE state IN ('executing','unknown');
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='wa_pending_assignment_fk' AND conrelid='whatsapp_conversations'::regclass) THEN ALTER TABLE whatsapp_conversations ADD CONSTRAINT wa_pending_assignment_fk FOREIGN KEY(pending_assignment_id) REFERENCES whatsapp_assignment_requests(id); END IF; END $$;
-- Every existing ownership writer, including staff handover, enters the same durable request path.
-- An ordinary local ownership write can never certify a remote Inbox assignment.
CREATE OR REPLACE FUNCTION wa_request_owner_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid uuid; actor uuid;
BEGIN
 IF NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN RETURN NEW; END IF;
 IF current_setting('app.wa_confirm_assignment',true)='true' THEN RETURN NEW; END IF;
 actor:=NULLIF(current_setting('app.wa_assignment_actor',true),'')::uuid;
 NEW.assignment_version:=OLD.assignment_version+1;
 INSERT INTO whatsapp_assignment_requests(conversation_id,desired_staff_id,requested_by,version,reason)
 VALUES(OLD.id,NEW.assigned_agent_id,actor,NEW.assignment_version,COALESCE(NULLIF(current_setting('app.wa_assignment_reason',true),''),'staff_handover')) RETURNING id INTO rid;
 NEW.pending_assignment_id:=rid;
 NEW.assignment_lock:=true;
 NEW.assigned_agent_id:=OLD.assigned_agent_id;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wa_owner_request ON whatsapp_conversations;
CREATE TRIGGER wa_owner_request BEFORE UPDATE OF assigned_agent_id ON whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION wa_request_owner_change();
CREATE OR REPLACE FUNCTION wa_retire_staff_channel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.active AND NOT NEW.active THEN
 UPDATE whatsapp_staff_channels SET eligible=false,retired_at=now() WHERE staff_id=NEW.id AND retired_at IS NULL;
 UPDATE whatsapp_assignment_requests SET state='failed',finished_at=now(),evidence=jsonb_build_object('reason','staff_retired') WHERE desired_staff_id=NEW.id AND state='pending';
 -- Executing/unknown operations stay unresolved until authoritative reconciliation.
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wa_staff_retirement ON staff_users;
CREATE TRIGGER wa_staff_retirement AFTER UPDATE OF active ON staff_users FOR EACH ROW EXECUTE FUNCTION wa_retire_staff_channel();
ALTER TABLE whatsapp_outbound_intents ADD COLUMN IF NOT EXISTS enquiry_id uuid REFERENCES inquiries(id);
CREATE TABLE IF NOT EXISTS whatsapp_human_response_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inquiry_id uuid NOT NULL REFERENCES inquiries(id),
 message_id uuid NOT NULL REFERENCES whatsapp_messages(id),
 staff_id uuid NOT NULL REFERENCES staff_users(id),
 origin text NOT NULL CHECK(origin IN ('authenticated_intent','verified_inbox')),
 responded_at timestamptz NOT NULL, external_message_id text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 supersedes uuid REFERENCES whatsapp_human_response_evidence(id), UNIQUE(inquiry_id,message_id), UNIQUE(message_id)
);
CREATE OR REPLACE FUNCTION wa_associate_intent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidates uuid[]; selected uuid;
BEGIN
 selected:=NULLIF(NEW.payload->>'enquiryId','')::uuid;
 IF selected IS NOT NULL THEN
 IF NOT EXISTS(SELECT 1 FROM inquiries WHERE id=selected AND conversation_id=NEW.conversation_id AND source='whatsapp' AND status NOT IN ('closed','resolved','spam')) THEN RAISE EXCEPTION 'ENQUIRY_ASSOCIATION_INVALID'; END IF;
 ELSE
 SELECT array_agg(id) INTO candidates FROM inquiries WHERE conversation_id=NEW.conversation_id AND source='whatsapp' AND status NOT IN ('closed','resolved','spam');
 IF cardinality(candidates)>1 THEN RAISE EXCEPTION 'ENQUIRY_SELECTION_REQUIRED'; END IF;
 selected:=candidates[1];
 END IF;
 NEW.enquiry_id:=selected; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wa_intent_association ON whatsapp_outbound_intents;
CREATE TRIGGER wa_intent_association BEFORE INSERT ON whatsapp_outbound_intents FOR EACH ROW EXECUTE FUNCTION wa_associate_intent();
-- Separate tenant verification: an administrator's staff mapping alone does not certify metadata semantics.
CREATE TABLE IF NOT EXISTS whatsapp_inbox_evidence_capabilities (
 channel_id text PRIMARY KEY,
 verification_ref text NOT NULL CHECK(length(trim(verification_ref))>0),
 verified_at timestamptz NOT NULL
);
CREATE OR REPLACE FUNCTION wa_credit_human_response(p_inquiry uuid,p_message uuid,p_staff uuid,p_time timestamptz,p_external text,p_origin text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE i record; previous uuid; inserted uuid;
BEGIN
 SELECT * INTO i FROM inquiries WHERE id=p_inquiry FOR UPDATE;
 IF NOT FOUND OR i.source<>'whatsapp' OR COALESCE(i.customer_message_at,i.webhook_received_at) IS NULL OR p_time IS NULL OR NULLIF(p_external,'') IS NULL OR p_time<COALESCE(i.customer_message_at,i.webhook_received_at) THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM whatsapp_messages WHERE id=p_message AND conversation_id=i.conversation_id AND direction='outbound' AND external_message_id=p_external) THEN RETURN false; END IF;
 IF p_origin='authenticated_intent' THEN
 IF NOT EXISTS(SELECT 1 FROM whatsapp_outbound_intents WHERE enquiry_id=p_inquiry AND message_id=p_message AND actor_staff_id=p_staff AND state='accepted' AND external_message_id=p_external AND dispatch_started_at=p_time AND EXISTS(SELECT 1 FROM whatsapp_messages WHERE id=p_message AND sent_by=p_staff)) THEN RETURN false; END IF;
 ELSE
 IF p_origin<>'verified_inbox' OR NOT EXISTS(
 SELECT 1 FROM whatsapp_enquiry_events e
 JOIN whatsapp_messages m ON m.id=e.message_id
 JOIN whatsapp_staff_channels sc ON sc.channel_id=e.channel_id AND sc.inbox_user_id=e.evidence->>'agentUserId'
 JOIN staff_users staff ON staff.id=sc.staff_id AND staff.active
 JOIN whatsapp_inbox_evidence_capabilities cap ON cap.channel_id=e.channel_id
 WHERE e.message_id=p_message AND e.origin='live_webhook' AND e.kind IN ('unverified_outbound','staff_outbound')
 AND e.identity_quality='provider_id' AND e.timing='fresh' AND e.evidence->>'integrationId'='inbox'
 AND e.external_message_id=p_external AND e.occurred_at=p_time
 AND m.external_message_id=p_external AND m.channel_id=e.channel_id AND m.woztell_member_id=e.member_id
 AND sc.staff_id=p_staff AND sc.eligible AND sc.retired_at IS NULL AND sc.verified_at<=e.received_at AND cap.verified_at<=e.received_at
 ) THEN RETURN false; END IF;
 END IF;
 SELECT id INTO previous FROM whatsapp_human_response_evidence WHERE inquiry_id=p_inquiry ORDER BY responded_at,recorded_at LIMIT 1;
 INSERT INTO whatsapp_human_response_evidence(inquiry_id,message_id,staff_id,origin,responded_at,external_message_id,supersedes)
 VALUES(p_inquiry,p_message,p_staff,p_origin,p_time,p_external,CASE WHEN p_time<i.first_human_response_at THEN previous ELSE NULL END) ON CONFLICT DO NOTHING RETURNING id INTO inserted;
 IF inserted IS NULL THEN RETURN EXISTS(SELECT 1 FROM whatsapp_human_response_evidence WHERE inquiry_id=p_inquiry AND message_id=p_message AND staff_id=p_staff AND responded_at=p_time); END IF;
 IF i.first_human_response_at IS NULL OR p_time<i.first_human_response_at THEN
 UPDATE inquiries SET first_human_response_at=p_time,first_human_response_message_id=p_message,first_human_response_staff_id=p_staff WHERE id=p_inquiry;
 END IF;
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION wa_credit_accepted_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state='accepted' AND NEW.enquiry_id IS NOT NULL AND NEW.external_message_id IS NOT NULL THEN
 PERFORM wa_credit_human_response(NEW.enquiry_id,NEW.message_id,NEW.actor_staff_id,NEW.dispatch_started_at,NEW.external_message_id,'authenticated_intent');
 END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wa_intent_human_response ON whatsapp_outbound_intents;
CREATE CONSTRAINT TRIGGER wa_intent_human_response AFTER UPDATE ON whatsapp_outbound_intents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wa_credit_accepted_intent();

CREATE OR REPLACE FUNCTION wa_observe_inbox_response(p_event uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE e record; candidates uuid[]; staff uuid;
BEGIN
 SELECT ev.*,m.conversation_id INTO e FROM whatsapp_enquiry_events ev JOIN whatsapp_messages m ON m.id=ev.message_id
 WHERE ev.id=p_event AND ev.origin='live_webhook' AND ev.kind IN ('unverified_outbound','staff_outbound') AND m.direction='outbound';
 IF NOT FOUND OR e.occurred_at IS NULL THEN RETURN false; END IF;
 PERFORM id FROM whatsapp_conversations WHERE id=e.conversation_id FOR UPDATE;
 SELECT array_agg(id) INTO candidates FROM inquiries WHERE conversation_id=e.conversation_id AND source='whatsapp'
 AND status NOT IN ('closed','resolved','spam') AND COALESCE(customer_message_at,webhook_received_at)<=e.occurred_at;
 IF cardinality(candidates)>1 THEN
 UPDATE inquiries SET association_review=true WHERE id=ANY(candidates);
 RETURN false;
 END IF;
 IF cardinality(candidates) IS DISTINCT FROM 1 THEN RETURN false; END IF;
 SELECT staff_id INTO staff FROM whatsapp_staff_channels WHERE channel_id=e.channel_id AND inbox_user_id=e.evidence->>'agentUserId';
 IF staff IS NULL THEN RETURN false; END IF;
 RETURN wa_credit_human_response(candidates[1],e.message_id,staff,e.occurred_at,e.external_message_id,'verified_inbox');
END $$;
