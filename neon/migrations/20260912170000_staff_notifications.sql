-- Additive staff handoff. No activation, destination or permissions are seeded.
ALTER TABLE whatsapp_enquiry_events ADD COLUMN IF NOT EXISTS notification_eligible boolean NOT NULL DEFAULT false;
ALTER TABLE whatsapp_enquiry_events ADD COLUMN IF NOT EXISTS notification_routing_eligible boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION wa_notification_capture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.notification_eligible:=NEW.origin='live_webhook' AND NEW.kind='customer_message' AND NEW.effects_eligible AND NEW.capture_mode='active' AND NEW.timing='fresh' AND NEW.identity_quality='provider_id' AND COALESCE(NEW.evidence->>'staffNotificationsEligible','false')='true';
  NEW.notification_routing_eligible:=NEW.notification_eligible AND COALESCE(NEW.evidence->>'staffRoutingEligible','false')='true';
 ELSIF (NEW.notification_eligible,NEW.notification_routing_eligible) IS DISTINCT FROM (OLD.notification_eligible,OLD.notification_routing_eligible) THEN RAISE EXCEPTION 'WA_NOTIFICATION_CAPTURE_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wa_notification_capture ON whatsapp_enquiry_events;
CREATE TRIGGER wa_notification_capture BEFORE INSERT OR UPDATE ON whatsapp_enquiry_events FOR EACH ROW EXECUTE FUNCTION wa_notification_capture();
CREATE TABLE IF NOT EXISTS staff_notification_ready_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL DEFAULT 'enquiry.handler.ready' CHECK(event_type='enquiry.handler.ready'),

 inquiry_id uuid NOT NULL REFERENCES inquiries(id),
  cause_event_id uuid NOT NULL REFERENCES whatsapp_enquiry_events(id),

 assignment_version bigint NOT NULL CHECK(assignment_version>=0),
  recipient_staff_id uuid NOT NULL REFERENCES staff_users(id),

 activation_generation uuid NOT NULL REFERENCES whatsapp_enquiry_activations(id),
  created_at timestamptz NOT NULL DEFAULT now(),

 UNIQUE(inquiry_id,assignment_version,recipient_staff_id,activation_generation)
);
CREATE TABLE IF NOT EXISTS staff_notification_intents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ready_event_id uuid NOT NULL UNIQUE REFERENCES staff_notification_ready_events(id),

 cause_event_id uuid NOT NULL REFERENCES whatsapp_enquiry_events(id),
  inquiry_id uuid NOT NULL REFERENCES inquiries(id),

 conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id),
  assignment_version bigint NOT NULL CHECK(assignment_version>=0),

 activation_generation uuid NOT NULL REFERENCES whatsapp_enquiry_activations(id),
  requested_staff_id_snapshot uuid REFERENCES staff_users(id),

 recipient_staff_id uuid NOT NULL REFERENCES staff_users(id),
  purpose text NOT NULL CHECK(purpose IN ('action_required','fyi')),

 acknowledgement_required boolean NOT NULL DEFAULT true,

 work_state text NOT NULL DEFAULT 'pending' CHECK(work_state IN ('pending','acknowledged','resolved','superseded','cancelled')),

 acknowledged_by uuid REFERENCES staff_users(id),
  acknowledged_at timestamptz,
  rendered_at timestamptz,

 help_requested_at timestamptz,
  help_reason text CHECK(length(help_reason)<=500),
  mismatch_reason text,
  resolution_reason text,

 logical_dedupe_key text NOT NULL UNIQUE CHECK(length(logical_dedupe_key)<=200),
  created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),

 CHECK((purpose='action_required')=acknowledgement_required),

 CHECK((acknowledged_by IS NULL)=(acknowledged_at IS NULL)),
  CHECK(acknowledged_by IS NULL OR (acknowledgement_required AND acknowledged_by=recipient_staff_id)),

 CHECK(work_state<>'acknowledged' OR acknowledged_at IS NOT NULL),

 UNIQUE(inquiry_id,assignment_version,recipient_staff_id,purpose,activation_generation)
);
CREATE INDEX IF NOT EXISTS staff_notifications_recipient_page ON staff_notification_intents(recipient_staff_id,work_state,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS staff_notifications_pending ON staff_notification_intents(created_at,id) WHERE work_state='pending';
CREATE TABLE IF NOT EXISTS staff_notification_endpoints(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff_users(id),

 transport text NOT NULL CHECK(transport IN ('inbox_private_note','staff_whatsapp')),
  channel_id text NOT NULL,

 destination_reference text NOT NULL CHECK(length(destination_reference) BETWEEN 1 AND 256),

 version integer NOT NULL DEFAULT 1 CHECK(version>0),
  verification_ref text,
  verified_at timestamptz,
  enabled boolean NOT NULL DEFAULT false,

 permission_granted boolean NOT NULL DEFAULT false,
  permission_ref text,
  quiet_hours_policy jsonb,

 last_inbound_at timestamptz,
  template_name text,
  template_language text,
  template_verified_at timestamptz,

 retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),

 CHECK(NOT enabled OR (verified_at IS NOT NULL AND verification_ref IS NOT NULL AND permission_granted AND permission_ref IS NOT NULL AND retired_at IS NULL)),

 UNIQUE(staff_id,transport,channel_id)
);
CREATE TABLE IF NOT EXISTS staff_notification_attempts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES staff_notification_intents(id),

 transport text NOT NULL CHECK(transport IN ('inbox_private_note','staff_whatsapp')),
  endpoint_id uuid REFERENCES staff_notification_endpoints(id),
  endpoint_version integer,

 destination_reference_snapshot text,
  channel_id_snapshot text,

 attempt_generation integer NOT NULL DEFAULT 1 CHECK(attempt_generation>0),

 dispatch_state text NOT NULL DEFAULT 'queued' CHECK(dispatch_state IN ('queued','dispatching','accepted','delivered','unknown','failed','suppressed')),

 attempt_key text NOT NULL UNIQUE CHECK(length(attempt_key)<=200),
  claim_id uuid,
  job_id uuid REFERENCES ops_jobs(id),

 evidence_kind text CHECK(evidence_kind IN ('private_note_posted','provider_accepted','provider_delivered')),
  provider_operation_id text,

 safe_error text CHECK(length(safe_error)<=160),
  dispatch_started_at timestamptz,
  finished_at timestamptz,

 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),

 UNIQUE(notification_id,transport,attempt_generation)
);
CREATE INDEX IF NOT EXISTS staff_notification_attempt_due ON staff_notification_attempts(dispatch_state,created_at,id);
CREATE TABLE IF NOT EXISTS staff_notification_routing_exceptions(
 inquiry_id uuid PRIMARY KEY REFERENCES inquiries(id),
  reason text NOT NULL,
  attended_staff_id uuid REFERENCES staff_users(id),

 state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS staff_notification_internal_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_event_key text UNIQUE NOT NULL,
  notification_attempt_id uuid REFERENCES staff_notification_attempts(id),

 channel_id text NOT NULL,
  member_id text NOT NULL,
  association_state text NOT NULL CHECK(association_state IN ('correlated','review')),

 event_kind text NOT NULL,
  protected_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION wa_staff_notification_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.recipient_staff_id,NEW.requested_staff_id_snapshot,NEW.assignment_version,NEW.activation_generation,NEW.inquiry_id,NEW.purpose,NEW.acknowledgement_required,NEW.ready_event_id,NEW.logical_dedupe_key) IS DISTINCT FROM (OLD.recipient_staff_id,OLD.requested_staff_id_snapshot,OLD.assignment_version,OLD.activation_generation,OLD.inquiry_id,OLD.purpose,OLD.acknowledgement_required,OLD.ready_event_id,OLD.logical_dedupe_key) THEN RAISE EXCEPTION 'STAFF_NOTIFICATION_HISTORY_IMMUTABLE'; END IF;
 IF OLD.acknowledged_by IS NOT NULL AND (NEW.acknowledged_by,NEW.acknowledged_at) IS DISTINCT FROM (OLD.acknowledged_by,OLD.acknowledged_at) THEN RAISE EXCEPTION 'STAFF_ACK_HISTORY_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS staff_notification_history ON staff_notification_intents;
CREATE TRIGGER staff_notification_history BEFORE UPDATE ON staff_notification_intents FOR EACH ROW EXECUTE FUNCTION wa_staff_notification_history();
CREATE OR REPLACE FUNCTION wa_capture_staff_ready(p_inquiry uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE i record; w record; e record; rid uuid; nid uuid; why text; attended uuid; mismatch text;
BEGIN
 SELECT conversation_id INTO i FROM inquiries WHERE id=p_inquiry;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO w FROM whatsapp_conversations WHERE id=i.conversation_id FOR UPDATE;
 SELECT * INTO i FROM inquiries WHERE id=p_inquiry FOR UPDATE;
 SELECT ev.* INTO e FROM whatsapp_enquiry_events ev WHERE ev.message_id=i.intake_message_id AND ev.notification_eligible AND ev.inquiry_id=i.id AND ev.activation_id=i.activation_id LIMIT 1;
 IF NOT FOUND OR i.status IN ('closed','resolved','spam') OR NOT i.effects_eligible OR i.first_human_response_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM whatsapp_enquiry_activations a WHERE a.id=e.activation_id AND a.ended_at IS NULL) THEN RETURN NULL; END IF;
 IF e.notification_routing_eligible AND NOT i.association_review AND NOT w.assignment_lock AND w.confirmed_staff_id IS NULL AND w.pending_assignment_id IS NULL AND i.requested_staff_id IS NOT NULL AND EXISTS(SELECT 1 FROM staff_users s JOIN whatsapp_staff_channels m ON m.staff_id=s.id WHERE s.id=i.requested_staff_id AND s.active AND EXISTS(SELECT 1 FROM staff_roles role WHERE role.staff_user_id=s.id AND role.role IN ('agent','manager','admin')) AND m.channel_id=w.channel_id AND m.eligible AND m.retired_at IS NULL) THEN
 INSERT INTO whatsapp_assignment_requests(conversation_id,desired_staff_id,version,reason) VALUES(w.id,i.requested_staff_id,w.assignment_version+1,'requested_staff') RETURNING id INTO rid;
 UPDATE whatsapp_conversations SET pending_assignment_id=rid,assignment_version=assignment_version+1 WHERE id=w.id;
 INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key) VALUES('woztell.enquiry.assign',1,jsonb_build_object('requestId',rid),'queued',3,now(),'wa.assignment:'||rid);
 RETURN NULL;
 END IF;
 UPDATE staff_notification_intents SET work_state='superseded',resolution_reason='handler_generation_changed',updated_at=now() WHERE inquiry_id=i.id AND work_state IN ('pending','acknowledged') AND (assignment_version<>w.assignment_version OR recipient_staff_id IS DISTINCT FROM w.confirmed_staff_id);
 mismatch:=CASE WHEN i.requested_staff_id IS NOT NULL AND i.requested_staff_id IS DISTINCT FROM w.confirmed_staff_id THEN CASE WHEN w.assignment_lock THEN 'protected_assignment' WHEN EXISTS(SELECT 1 FROM whatsapp_assignment_requests r WHERE r.id=w.pending_assignment_id AND (r.reason='existing_coordinator' OR (r.finished_at IS NOT NULL AND r.finished_at<=e.received_at))) THEN 'existing_coordinator' WHEN NOT EXISTS(SELECT 1 FROM staff_users s JOIN whatsapp_staff_channels m ON m.staff_id=s.id AND m.channel_id=w.channel_id WHERE s.id=i.requested_staff_id AND s.active AND m.eligible AND m.retired_at IS NULL) AND EXISTS(SELECT 1 FROM whatsapp_assignment_requests r WHERE r.id=w.pending_assignment_id AND r.reason IN ('offer_owner','duty_pool','reception','approved_fallback')) THEN 'requested_staff_unavailable' ELSE 'unjustified_mismatch' END ELSE NULL END;
 why:=CASE WHEN i.association_review THEN 'reference_association_review' WHEN w.confirmed_staff_id IS NULL THEN 'handler_unverified' WHEN mismatch='unjustified_mismatch' THEN 'requested_handler_mismatch' WHEN NOT EXISTS(SELECT 1 FROM whatsapp_assignment_requests r WHERE r.id=w.pending_assignment_id AND r.version=w.assignment_version AND r.desired_staff_id=w.confirmed_staff_id AND r.state='confirmed' AND r.evidence->>'authoritative'='true') THEN 'assignment_evidence_unverified' WHEN NOT EXISTS(SELECT 1 FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id JOIN whatsapp_staff_channels m ON m.staff_id=s.id AND m.channel_id=w.channel_id WHERE s.id=w.confirmed_staff_id AND s.active AND r.role IN ('agent','manager','admin') AND m.eligible AND m.retired_at IS NULL) THEN 'handler_ineligible' ELSE NULL END;
 IF why IS NOT NULL THEN
 SELECT s.id INTO attended FROM whatsapp_enquiry_activations a JOIN whatsapp_service_policies p ON p.id=a.policy_id JOIN staff_users s ON s.id=NULLIF(p.rules->>'managerStaffId','')::uuid JOIN staff_roles r ON r.staff_user_id=s.id WHERE a.id=e.activation_id AND p.status='approved' AND s.active AND r.role IN ('manager','admin') LIMIT 1;
 INSERT INTO staff_notification_routing_exceptions(inquiry_id,reason,attended_staff_id) VALUES(i.id,why,attended) ON CONFLICT(inquiry_id) DO UPDATE SET reason=EXCLUDED.reason,attended_staff_id=EXCLUDED.attended_staff_id,state='open',updated_at=now();
 RETURN NULL;
 END IF;
 UPDATE staff_notification_routing_exceptions SET state='resolved',updated_at=now() WHERE inquiry_id=i.id;
 INSERT INTO staff_notification_ready_events(inquiry_id,cause_event_id,assignment_version,recipient_staff_id,activation_generation) VALUES(i.id,e.id,w.assignment_version,w.confirmed_staff_id,e.activation_id) ON CONFLICT DO NOTHING RETURNING id INTO rid;
 IF rid IS NULL THEN RETURN NULL; END IF;
 INSERT INTO staff_notification_intents(ready_event_id,cause_event_id,inquiry_id,conversation_id,assignment_version,activation_generation,requested_staff_id_snapshot,recipient_staff_id,purpose,mismatch_reason,logical_dedupe_key)
 VALUES(rid,e.id,i.id,w.id,w.assignment_version,e.activation_id,i.requested_staff_id,w.confirmed_staff_id,'action_required',mismatch,md5(jsonb_build_array(i.id,w.assignment_version,w.confirmed_staff_id,'action_required',e.activation_id)::text)) RETURNING id INTO nid;
 INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key) VALUES('woztell.enquiry.staff.notify',1,jsonb_build_object('notificationId',nid),'queued',5,now(),'wa.staff.notify:'||nid);
 RETURN nid;
END $$;
CREATE OR REPLACE FUNCTION wa_staff_ready_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inquiry uuid;
BEGIN
 IF TG_TABLE_NAME='whatsapp_enquiry_events' THEN
  IF NEW.inquiry_id IS NOT NULL AND NEW.inquiry_id IS DISTINCT FROM OLD.inquiry_id THEN PERFORM wa_capture_staff_ready(NEW.inquiry_id); END IF;
 ELSE
  IF (NEW.confirmed_staff_id,NEW.assignment_version) IS DISTINCT FROM (OLD.confirmed_staff_id,OLD.assignment_version) THEN
   FOR inquiry IN SELECT id FROM inquiries WHERE conversation_id=NEW.id AND source='whatsapp' AND status NOT IN ('closed','resolved','spam') LOOP PERFORM wa_capture_staff_ready(inquiry); END LOOP;
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wa_staff_event_ready ON whatsapp_enquiry_events;
CREATE TRIGGER wa_staff_event_ready AFTER UPDATE OF inquiry_id ON whatsapp_enquiry_events FOR EACH ROW EXECUTE FUNCTION wa_staff_ready_transition();
DROP TRIGGER IF EXISTS wa_staff_assignment_ready ON whatsapp_conversations;
CREATE TRIGGER wa_staff_assignment_ready AFTER UPDATE OF confirmed_staff_id,assignment_version ON whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION wa_staff_ready_transition();
CREATE OR REPLACE FUNCTION wa_staff_reply_resolution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.first_human_response_at IS NOT NULL AND OLD.first_human_response_at IS NULL THEN
 UPDATE staff_notification_intents SET work_state='resolved',resolution_reason='resolved_by_customer_reply',updated_at=now() WHERE inquiry_id=NEW.id AND work_state IN ('pending','acknowledged');
 END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wa_staff_reply_resolution ON inquiries;
CREATE TRIGGER wa_staff_reply_resolution AFTER UPDATE OF first_human_response_at ON inquiries FOR EACH ROW EXECUTE FUNCTION wa_staff_reply_resolution();

CREATE OR REPLACE FUNCTION wa_staff_job_payload() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.job_type IN ('woztell.enquiry.staff.notify','woztell.enquiry.staff.notify.reconcile','woztell.enquiry.staff.ack.check') THEN
 IF NEW.payload_version<>1 OR jsonb_typeof(NEW.payload)<>'object' OR NOT (NEW.payload ? 'notificationId') OR NEW.payload - 'notificationId'<>'{}'::jsonb OR NOT EXISTS(SELECT 1 FROM staff_notification_intents WHERE id=(NEW.payload->>'notificationId')::uuid) THEN RAISE EXCEPTION 'STAFF_NOTIFICATION_JOB_INVALID'; END IF;
 END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wa_staff_job_payload ON ops_jobs;
CREATE TRIGGER wa_staff_job_payload BEFORE INSERT OR UPDATE OF payload,payload_version,job_type ON ops_jobs FOR EACH ROW EXECUTE FUNCTION wa_staff_job_payload();

CREATE OR REPLACE FUNCTION wa_staff_endpoint_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.staff_id IS DISTINCT FROM OLD.staff_id THEN RAISE EXCEPTION 'STAFF_ENDPOINT_OWNER_IMMUTABLE'; END IF;
 IF (NEW.destination_reference,NEW.transport,NEW.channel_id,NEW.verification_ref,NEW.verified_at,NEW.enabled,NEW.permission_granted,NEW.permission_ref,NEW.quiet_hours_policy,NEW.template_name,NEW.template_language,NEW.template_verified_at,NEW.retired_at) IS DISTINCT FROM (OLD.destination_reference,OLD.transport,OLD.channel_id,OLD.verification_ref,OLD.verified_at,OLD.enabled,OLD.permission_granted,OLD.permission_ref,OLD.quiet_hours_policy,OLD.template_name,OLD.template_language,OLD.template_verified_at,OLD.retired_at) THEN NEW.version:=OLD.version+1; ELSE NEW.version:=OLD.version; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wa_staff_endpoint_version ON staff_notification_endpoints;
CREATE TRIGGER wa_staff_endpoint_version BEFORE UPDATE ON staff_notification_endpoints FOR EACH ROW EXECUTE FUNCTION wa_staff_endpoint_version();
CREATE OR REPLACE FUNCTION wa_staff_attempt_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
 SELECT destination_reference,channel_id INTO NEW.destination_reference_snapshot,NEW.channel_id_snapshot FROM staff_notification_endpoints WHERE id=NEW.endpoint_id;
 ELSIF (NEW.endpoint_id,NEW.endpoint_version,NEW.destination_reference_snapshot,NEW.channel_id_snapshot,NEW.transport,NEW.notification_id,NEW.attempt_generation,NEW.attempt_key) IS DISTINCT FROM (OLD.endpoint_id,OLD.endpoint_version,OLD.destination_reference_snapshot,OLD.channel_id_snapshot,OLD.transport,OLD.notification_id,OLD.attempt_generation,OLD.attempt_key) THEN RAISE EXCEPTION 'STAFF_ATTEMPT_TARGET_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wa_staff_attempt_snapshot ON staff_notification_attempts;
CREATE TRIGGER wa_staff_attempt_snapshot BEFORE INSERT OR UPDATE ON staff_notification_attempts FOR EACH ROW EXECUTE FUNCTION wa_staff_attempt_snapshot();
