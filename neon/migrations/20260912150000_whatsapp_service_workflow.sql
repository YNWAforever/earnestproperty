-- Phase 4: additive schema only. No approval, activation, recipient, template or provider mapping seeded.
CREATE TABLE IF NOT EXISTS whatsapp_enquiry_activations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), mode text NOT NULL CHECK(mode='active'),
 policy_id uuid NOT NULL REFERENCES whatsapp_service_policies(id), cutover_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 ended_at timestamptz, created_by uuid NOT NULL REFERENCES staff_users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS wa_one_activation ON whatsapp_enquiry_activations((ended_at IS NULL)) WHERE ended_at IS NULL;
ALTER TABLE whatsapp_enquiry_events DROP CONSTRAINT IF EXISTS whatsapp_enquiry_events_capture_mode_check;
ALTER TABLE whatsapp_enquiry_events DROP CONSTRAINT IF EXISTS whatsapp_enquiry_events_effects_eligible_check;
ALTER TABLE whatsapp_enquiry_events DROP CONSTRAINT IF EXISTS whatsapp_enquiry_events_processing_state_check;
ALTER TABLE whatsapp_enquiry_events ADD COLUMN IF NOT EXISTS service_eligible boolean NOT NULL DEFAULT false;
ALTER TABLE whatsapp_enquiry_events ADD COLUMN IF NOT EXISTS activation_id uuid REFERENCES whatsapp_enquiry_activations(id);
ALTER TABLE inquiries DROP CONSTRAINT IF EXISTS inquiries_effects_eligible_check;
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS activation_id uuid REFERENCES whatsapp_enquiry_activations(id);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='wa_capture_modes' AND conrelid='whatsapp_enquiry_events'::regclass) THEN
 ALTER TABLE whatsapp_enquiry_events ADD CONSTRAINT wa_capture_modes CHECK(capture_mode IN ('observe','active'));
 ALTER TABLE whatsapp_enquiry_events ADD CONSTRAINT wa_capture_eligibility CHECK(NOT effects_eligible OR (capture_mode='active' AND activation_id IS NOT NULL AND timing='fresh' AND identity_quality='provider_id'));
 ALTER TABLE whatsapp_enquiry_events ADD CONSTRAINT wa_processing_states CHECK(processing_state IN ('pending','observed','suppressed','processed'));
 END IF;
END $$;
CREATE OR REPLACE FUNCTION wa_capture_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.capture_mode,NEW.effects_eligible,NEW.service_eligible,NEW.activation_id,NEW.received_at,NEW.occurred_at,NEW.origin) IS DISTINCT FROM (OLD.capture_mode,OLD.effects_eligible,OLD.service_eligible,OLD.activation_id,OLD.received_at,OLD.occurred_at,OLD.origin) THEN RAISE EXCEPTION 'WA_CAPTURE_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wa_capture_immutable ON whatsapp_enquiry_events;
CREATE TRIGGER wa_capture_immutable BEFORE UPDATE ON whatsapp_enquiry_events FOR EACH ROW EXECUTE FUNCTION wa_capture_immutable();
ALTER TABLE whatsapp_service_surveys ADD COLUMN IF NOT EXISTS policy_id uuid REFERENCES whatsapp_service_policies(id),
 ADD COLUMN IF NOT EXISTS activation_id uuid REFERENCES whatsapp_enquiry_activations(id),
 ADD COLUMN IF NOT EXISTS sent_at timestamptz, ADD COLUMN IF NOT EXISTS answered_at timestamptz,
 ADD COLUMN IF NOT EXISTS manager_task_id uuid REFERENCES crm_activities(id),
 ADD COLUMN IF NOT EXISTS manager_assignment_id uuid REFERENCES whatsapp_assignment_requests(id),
 ADD COLUMN IF NOT EXISTS exception_reason text;
CREATE TABLE IF NOT EXISTS whatsapp_service_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inquiry_id uuid NOT NULL REFERENCES inquiries(id),
 survey_id uuid NOT NULL REFERENCES whatsapp_service_surveys(id),
 purpose text NOT NULL CHECK(purpose IN ('after_hours_ack','survey','survey_thanks','manager_ack')),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','blocked','suppressed','dispatching','accepted','unknown','failed')),
 block_reason text, due_at timestamptz NOT NULL,
 policy_id uuid NOT NULL REFERENCES whatsapp_service_policies(id), activation_id uuid NOT NULL REFERENCES whatsapp_enquiry_activations(id),
 outbound_intent_id uuid UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(survey_id,purpose)
);
ALTER TABLE whatsapp_outbound_intents ALTER COLUMN actor_staff_id DROP NOT NULL;
ALTER TABLE whatsapp_outbound_intents ADD COLUMN IF NOT EXISTS actor_type text NOT NULL DEFAULT 'staff',
 ADD COLUMN IF NOT EXISTS service_action_id uuid UNIQUE REFERENCES whatsapp_service_actions(id);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='wa_intent_actor' AND conrelid='whatsapp_outbound_intents'::regclass) THEN
 ALTER TABLE whatsapp_outbound_intents ADD CONSTRAINT wa_intent_actor CHECK((actor_type='staff' AND actor_staff_id IS NOT NULL AND service_action_id IS NULL) OR (actor_type='service' AND actor_staff_id IS NULL AND service_action_id IS NOT NULL));
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS wa_service_due ON whatsapp_service_actions(due_at,id) WHERE state='queued';
CREATE INDEX IF NOT EXISTS wa_jobs_service_due ON ops_jobs(run_after,created_at) WHERE status='queued' AND (job_type LIKE 'woztell.enquiry.%' OR job_type='woztell.reply.deliver');
CREATE OR REPLACE FUNCTION wa_credit_accepted_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.actor_type='staff' AND NEW.state='accepted' AND NEW.enquiry_id IS NOT NULL AND NEW.external_message_id IS NOT NULL THEN
 PERFORM wa_credit_human_response(NEW.enquiry_id,NEW.message_id,NEW.actor_staff_id,NEW.dispatch_started_at,NEW.external_message_id,'authenticated_intent');
 END IF; RETURN NEW;
END $$;
-- Closed surveys remain separate from CRM lead/opportunity lifecycle.
CREATE OR REPLACE FUNCTION wa_service_answer(p_event uuid,p_hash text,p_answer text,p_now timestamptz,p_generation uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE e record; s record; i record; w record; manager uuid; task uuid; assignment uuid; action uuid; reason text;
BEGIN
 IF p_answer NOT IN ('satisfied','assistance') THEN RETURN NULL; END IF;
 SELECT ev.*,m.conversation_id FROM whatsapp_enquiry_events ev JOIN whatsapp_messages m ON m.id=ev.message_id WHERE ev.id=p_event INTO e;
 IF NOT FOUND OR e.origin<>'live_webhook' OR NOT e.effects_eligible OR NOT e.service_eligible OR e.activation_id IS DISTINCT FROM p_generation OR e.kind NOT IN ('customer_survey_answer','customer_message') THEN RETURN NULL; END IF;
 SELECT v.* FROM whatsapp_service_surveys v JOIN inquiries q ON q.id=v.inquiry_id JOIN whatsapp_conversations c ON c.id=q.conversation_id
 WHERE v.token_hash=p_hash AND c.id=e.conversation_id AND c.channel_id=e.channel_id AND c.woztell_member_id=e.member_id
 AND v.activation_id=p_generation AND v.state='sent' AND v.sent_at<=e.occurred_at AND v.expires_at>=p_now
 AND EXISTS(SELECT 1 FROM whatsapp_enquiry_activations a JOIN whatsapp_service_policies p ON p.id=a.policy_id WHERE a.id=p_generation AND a.ended_at IS NULL AND p.id=v.policy_id AND p.status='approved') FOR UPDATE OF v INTO s;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO i FROM inquiries WHERE id=s.inquiry_id;
 SELECT * INTO w FROM whatsapp_conversations WHERE id=i.conversation_id FOR UPDATE;
 IF p_answer='assistance' THEN
 SELECT NULLIF(rules->>'managerStaffId','')::uuid INTO manager FROM whatsapp_service_policies WHERE id=s.policy_id;
 IF manager IS NULL OR NOT EXISTS(SELECT 1 FROM staff_users u JOIN staff_roles r ON r.staff_user_id=u.id WHERE u.id=manager AND u.active AND r.role IN ('admin','manager')) THEN manager:=NULL; reason:='manager_unavailable'; END IF;
 INSERT INTO crm_activities(lead_id,contact_id,staff_user_id,activity_type,body,due_at)
 VALUES(i.crm_lead_id,i.crm_contact_id,manager,'task','WhatsApp enquiry assistance requested; review the linked service instance.',p_now) RETURNING id INTO task;
 IF manager IS NOT NULL THEN
  IF (w.assignment_lock AND COALESCE(w.confirmed_staff_id,w.assigned_agent_id) IS DISTINCT FROM manager) OR EXISTS(SELECT 1 FROM whatsapp_assignment_requests WHERE conversation_id=w.id AND state IN ('executing','unknown')) THEN reason:='protected_assignment_review';
  ELSIF NOT EXISTS(SELECT 1 FROM whatsapp_staff_channels WHERE staff_id=manager AND channel_id=w.channel_id AND eligible AND retired_at IS NULL) THEN reason:='manager_mapping_unavailable';
  ELSE
   INSERT INTO whatsapp_assignment_requests(conversation_id,desired_staff_id,version,reason) VALUES(w.id,manager,w.assignment_version+1,'service_assistance') RETURNING id INTO assignment;
   UPDATE whatsapp_conversations SET pending_assignment_id=assignment,assignment_version=assignment_version+1,assignment_lock=true WHERE id=w.id;
   INSERT INTO ops_jobs(job_type,payload_version,payload,idempotency_key,status,max_attempts,run_after)
   VALUES('woztell.enquiry.assign',1,jsonb_build_object('requestId',assignment),'wa.assignment:'||assignment,'queued',3,p_now) ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
 END IF;
 END IF;
 UPDATE whatsapp_service_surveys SET state='closed',answer=p_answer,answering_event_id=p_event,answered_at=p_now,manager_task_id=task,manager_assignment_id=assignment,exception_reason=reason WHERE id=s.id;
 INSERT INTO whatsapp_service_actions(inquiry_id,survey_id,purpose,due_at,policy_id,activation_id,state,block_reason)
 VALUES(i.id,s.id,CASE WHEN p_answer='satisfied' THEN 'survey_thanks' ELSE 'manager_ack' END,p_now,s.policy_id,p_generation,
 CASE WHEN p_answer='assistance' THEN 'blocked' ELSE 'queued' END,CASE WHEN p_answer='assistance' THEN COALESCE(reason,'manager_assignment_unconfirmed') ELSE NULL END) RETURNING id INTO action;
 INSERT INTO ops_jobs(job_type,payload_version,payload,idempotency_key,status,max_attempts,run_after)
 VALUES('woztell.enquiry.service',1,jsonb_build_object('actionId',action),'wa.service:'||action,'queued',5,p_now) ON CONFLICT(idempotency_key) DO NOTHING;
 UPDATE whatsapp_enquiry_events SET inquiry_id=i.id,processing_state='processed',processed_at=p_now WHERE id=e.id;
 RETURN s.id;
END $$;

-- Extend association without upgrading any old episode.
CREATE OR REPLACE FUNCTION wa_observe_episode(p_event uuid,p_hash text,p_invalid boolean) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE e record; m record; o record; snap jsonb; picked uuid; candidates uuid[]; review boolean := p_invalid; prop uuid;
BEGIN
 SELECT * INTO e FROM whatsapp_enquiry_events WHERE id=p_event FOR UPDATE;
 IF NOT FOUND OR e.kind<>'customer_message' OR e.origin<>'live_webhook' OR e.capture_mode NOT IN ('observe','active') OR e.processing_state='suppressed' THEN RETURN NULL; END IF;
 IF e.inquiry_id IS NOT NULL THEN RETURN e.inquiry_id; END IF;
 IF EXISTS(SELECT 1 FROM whatsapp_enquiry_messages WHERE event_id=p_event) THEN RETURN NULL; END IF;
 SELECT * INTO m FROM whatsapp_messages WHERE id=e.message_id;
 IF NOT FOUND OR m.direction::text<>'inbound' OR m.channel_id<>e.channel_id OR m.woztell_member_id<>e.member_id THEN RETURN NULL; END IF;
 PERFORM 1 FROM whatsapp_conversations WHERE id=m.conversation_id FOR UPDATE;
 SELECT * INTO o FROM whatsapp_link_opens WHERE false;
 IF p_hash IS NOT NULL AND NOT review THEN
  SELECT * INTO o FROM whatsapp_link_opens WHERE reference_hash=p_hash AND channel_id=e.channel_id;
  IF FOUND THEN snap:=o.context_snapshot; prop:=(snap->>'propertyId')::uuid; ELSE review:=true; END IF;
 END IF;
 IF NOT review THEN
 SELECT array_agg(id) INTO candidates FROM inquiries WHERE conversation_id=m.conversation_id AND source='whatsapp' AND status NOT IN ('closed','resolved','spam') AND (prop IS NULL OR property_id=prop);
 IF cardinality(candidates)=1 THEN picked:=candidates[1]; ELSIF cardinality(candidates)>1 THEN review:=true; END IF;
 END IF;
 -- An ambiguous follow-up is retained without fabricating a new root on every message.
 IF review AND EXISTS(SELECT 1 FROM inquiries WHERE conversation_id=m.conversation_id AND source='whatsapp' AND status NOT IN ('closed','resolved','spam')) THEN
  INSERT INTO whatsapp_enquiry_messages(message_id,event_id,association_review) VALUES(m.id,e.id,true) ON CONFLICT DO NOTHING;
  UPDATE whatsapp_enquiry_events SET association_review=true WHERE id=e.id; RETURN NULL;
 END IF;
 IF picked IS NULL THEN
 INSERT INTO inquiries(source,name,crm_contact_id,conversation_id,intake_message_id,property_id,public_listing_no,requested_staff_id,entry_point_type,placement_source,attribution_method,tracking_link_id,link_open_id,customer_message_at,webhook_received_at,service_state,association_review,effects_eligible,activation_id)
 VALUES('whatsapp',(SELECT name FROM crm_contacts WHERE id=m.contact_id),m.contact_id,m.conversation_id,m.id,prop,snap->>'publicListingNo',(snap->>'requestedStaffId')::uuid,COALESCE(snap->>'entryPointType','reception'),COALESCE(snap->>'placementSource','unknown'),CASE WHEN snap IS NULL THEN 'unknown' ELSE 'reference' END,o.link_id,o.id,e.occurred_at,e.received_at,'unmeasured',review OR snap IS NULL,e.effects_eligible,e.activation_id)
 ON CONFLICT(intake_message_id) WHERE source='whatsapp' AND intake_message_id IS NOT NULL DO UPDATE SET intake_message_id=EXCLUDED.intake_message_id RETURNING id INTO picked;
 END IF;
 INSERT INTO whatsapp_enquiry_messages(message_id,inquiry_id,event_id,association_review) VALUES(m.id,picked,e.id,review) ON CONFLICT DO NOTHING;
 UPDATE whatsapp_enquiry_events SET inquiry_id=picked,association_review=review WHERE id=e.id;
 RETURN picked;
END $$;
CREATE TABLE IF NOT EXISTS whatsapp_service_worker_heartbeats(worker_id text PRIMARY KEY,seen_at timestamptz NOT NULL,capabilities jsonb NOT NULL);
-- Database capability guard also protects new jobs from pre-Phase-4 deployed workers.
CREATE OR REPLACE FUNCTION wa_service_claim_capability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='running' AND OLD.status='queued' AND ((NEW.job_type LIKE 'woztell.enquiry.%' AND NOT(NEW.job_type='woztell.enquiry.process' AND NEW.payload_version=1)) OR (NEW.job_type='woztell.reply.deliver' AND NEW.payload_version=2)) THEN
  IF NOT COALESCE(NULLIF(current_setting('app.wa_worker_capabilities',true),'')::jsonb ? (NEW.job_type||'@'||NEW.payload_version::text),false) THEN RETURN NULL; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wa_service_claim_guard ON ops_jobs;
CREATE TRIGGER wa_service_claim_guard BEFORE UPDATE ON ops_jobs FOR EACH ROW EXECUTE FUNCTION wa_service_claim_capability();
