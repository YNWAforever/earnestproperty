-- Phase 2: additive, observation only. No policy approval, routing mapping or public placements seeded.
CREATE TABLE IF NOT EXISTS whatsapp_tracking_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE CHECK(code ~ '^[A-Za-z0-9_-]{16,64}$'),
 current_version integer NOT NULL DEFAULT 1 CHECK(current_version>0), created_by uuid REFERENCES staff_users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS whatsapp_tracking_link_versions (
 link_id uuid NOT NULL REFERENCES whatsapp_tracking_links(id), version integer NOT NULL CHECK(version>0),
 channel_id text NOT NULL, placement_source text NOT NULL CHECK(placement_source IN ('website','28hse','youtube','other')),
 entry_point_type text NOT NULL CHECK(entry_point_type IN ('sales','reception')),
 public_listing_no text, property_id uuid REFERENCES properties(id), deal_type text CHECK(deal_type IN ('sale','rent')),
 requested_staff_id uuid REFERENCES staff_users(id), branch_id text, external_listing_id text, video_id text,
 enabled boolean NOT NULL DEFAULT false, placement_verified_at timestamptz, created_by uuid REFERENCES staff_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(link_id,version), CHECK((property_id IS NULL AND public_listing_no IS NULL AND deal_type IS NULL) OR (property_id IS NOT NULL AND public_listing_no IS NOT NULL AND deal_type IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS whatsapp_link_opens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reference_hash text NOT NULL UNIQUE CHECK(length(reference_hash)=64),
 link_id uuid NOT NULL, link_version integer NOT NULL, channel_id text NOT NULL,
 context_snapshot jsonb NOT NULL, opened_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(link_id,link_version) REFERENCES whatsapp_tracking_link_versions(link_id,version)
);
CREATE OR REPLACE FUNCTION wa_immutable_attribution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'WhatsApp attribution is immutable; use a new version or authorised retention operation'; END $$;
DROP TRIGGER IF EXISTS wa_link_version_immutable ON whatsapp_tracking_link_versions;
CREATE TRIGGER wa_link_version_immutable BEFORE UPDATE OR DELETE ON whatsapp_tracking_link_versions FOR EACH ROW EXECUTE FUNCTION wa_immutable_attribution();
DROP TRIGGER IF EXISTS wa_link_open_immutable ON whatsapp_link_opens;
CREATE TRIGGER wa_link_open_immutable BEFORE UPDATE OR DELETE ON whatsapp_link_opens FOR EACH ROW EXECUTE FUNCTION wa_immutable_attribution();
CREATE TABLE IF NOT EXISTS whatsapp_link_rate_buckets (
 bucket_key text PRIMARY KEY CHECK(length(bucket_key)=64), window_start timestamptz NOT NULL, request_count integer NOT NULL CHECK(request_count>0)
);
CREATE TABLE IF NOT EXISTS whatsapp_service_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version integer NOT NULL CHECK(version>0),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','retired')), rules jsonb NOT NULL DEFAULT '{}'::jsonb,
 copy_version text, approved_by uuid REFERENCES staff_users(id), effective_at timestamptz,
 CHECK(status<>'approved' OR (approved_by IS NOT NULL AND effective_at IS NOT NULL AND copy_version IS NOT NULL))
);
ALTER TABLE inquiries ALTER COLUMN name DROP NOT NULL;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='inquiries'::regclass AND conname='inquiries_whatsapp_nullable_name') THEN
 ALTER TABLE inquiries ADD CONSTRAINT inquiries_whatsapp_nullable_name CHECK(source='whatsapp' OR name IS NOT NULL);
 END IF;
END $$;
ALTER TABLE inquiries
 ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES whatsapp_conversations(id),
 ADD COLUMN IF NOT EXISTS crm_lead_id uuid REFERENCES crm_leads(id),
 ADD COLUMN IF NOT EXISTS intake_message_id uuid REFERENCES whatsapp_messages(id),
 ADD COLUMN IF NOT EXISTS public_listing_no text,
 ADD COLUMN IF NOT EXISTS requested_staff_id uuid REFERENCES staff_users(id),
 ADD COLUMN IF NOT EXISTS entry_point_type text CHECK(entry_point_type IN ('sales','reception')),
 ADD COLUMN IF NOT EXISTS placement_source text CHECK(placement_source IN ('website','28hse','youtube','unknown','other')),
 ADD COLUMN IF NOT EXISTS attribution_method text CHECK(attribution_method IN ('reference','explicit_customer_statement','unknown')),
 ADD COLUMN IF NOT EXISTS tracking_link_id uuid REFERENCES whatsapp_tracking_links(id),
 ADD COLUMN IF NOT EXISTS link_open_id uuid REFERENCES whatsapp_link_opens(id),
 ADD COLUMN IF NOT EXISTS customer_message_at timestamptz,
 ADD COLUMN IF NOT EXISTS webhook_received_at timestamptz,
 ADD COLUMN IF NOT EXISTS service_policy_id uuid REFERENCES whatsapp_service_policies(id),
 ADD COLUMN IF NOT EXISTS response_due_at timestamptz,
 ADD COLUMN IF NOT EXISTS first_human_response_at timestamptz,
 ADD COLUMN IF NOT EXISTS first_human_response_message_id uuid REFERENCES whatsapp_messages(id),
 ADD COLUMN IF NOT EXISTS first_human_response_staff_id uuid REFERENCES staff_users(id),
 ADD COLUMN IF NOT EXISTS service_state text NOT NULL DEFAULT 'unmeasured',
 ADD COLUMN IF NOT EXISTS association_review boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS effects_eligible boolean NOT NULL DEFAULT false CHECK(effects_eligible=false);
CREATE UNIQUE INDEX IF NOT EXISTS inquiries_whatsapp_root_message ON inquiries(intake_message_id) WHERE source='whatsapp' AND intake_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inquiries_whatsapp_conversation ON inquiries(conversation_id,created_at DESC) WHERE source='whatsapp';
ALTER TABLE whatsapp_enquiry_events ADD COLUMN IF NOT EXISTS inquiry_id uuid REFERENCES inquiries(id), ADD COLUMN IF NOT EXISTS association_review boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS whatsapp_enquiry_messages (
 message_id uuid PRIMARY KEY REFERENCES whatsapp_messages(id), inquiry_id uuid REFERENCES inquiries(id),
 event_id uuid NOT NULL UNIQUE REFERENCES whatsapp_enquiry_events(id), association_review boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS whatsapp_service_surveys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inquiry_id uuid NOT NULL REFERENCES inquiries(id), instance_version integer NOT NULL CHECK(instance_version>0),
 token_hash text UNIQUE, due_at timestamptz, expires_at timestamptz, state text NOT NULL DEFAULT 'draft',
 answering_event_id uuid UNIQUE REFERENCES whatsapp_enquiry_events(id), answer text, message_id uuid REFERENCES whatsapp_messages(id),
 UNIQUE(inquiry_id,instance_version)
);
-- Serialize all episode association per conversation. Reference evidence never changes contact identity.
CREATE OR REPLACE FUNCTION wa_observe_episode(p_event uuid,p_hash text,p_invalid boolean) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE e record; m record; o record; snap jsonb; picked uuid; candidates uuid[]; review boolean := p_invalid; prop uuid;
BEGIN
 SELECT * INTO e FROM whatsapp_enquiry_events WHERE id=p_event FOR UPDATE;
 IF NOT FOUND OR e.kind<>'customer_message' OR e.origin<>'live_webhook' OR e.capture_mode<>'observe' OR e.effects_eligible OR e.processing_state='suppressed' THEN RETURN NULL; END IF;
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
 INSERT INTO inquiries(source,name,crm_contact_id,conversation_id,intake_message_id,property_id,public_listing_no,requested_staff_id,entry_point_type,placement_source,attribution_method,tracking_link_id,link_open_id,customer_message_at,webhook_received_at,service_state,association_review,effects_eligible)
 VALUES('whatsapp',(SELECT name FROM crm_contacts WHERE id=m.contact_id),m.contact_id,m.conversation_id,m.id,prop,snap->>'publicListingNo',(snap->>'requestedStaffId')::uuid,COALESCE(snap->>'entryPointType','reception'),COALESCE(snap->>'placementSource','unknown'),CASE WHEN snap IS NULL THEN 'unknown' ELSE 'reference' END,o.link_id,o.id,e.occurred_at,e.received_at,'unmeasured',review OR snap IS NULL,false)
 ON CONFLICT(intake_message_id) WHERE source='whatsapp' AND intake_message_id IS NOT NULL DO UPDATE SET intake_message_id=EXCLUDED.intake_message_id RETURNING id INTO picked;
 END IF;
 INSERT INTO whatsapp_enquiry_messages(message_id,inquiry_id,event_id,association_review) VALUES(m.id,picked,e.id,review) ON CONFLICT DO NOTHING;
 UPDATE whatsapp_enquiry_events SET inquiry_id=picked,association_review=review WHERE id=e.id;
 RETURN picked;
END $$;
COMMENT ON TABLE whatsapp_link_opens IS 'Placement evidence only; no browser identity, IP, raw message, or marketing consent. Retention deletion requires separately authorised maintenance.';


-- Approved policy contents are versioned evidence; retirement does not rewrite the approved calendar/copy.
CREATE OR REPLACE FUNCTION wa_approved_policy_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status IN ('approved','retired') THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'WA_APPROVED_POLICY_IMMUTABLE'; END IF;
  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') OR
     (OLD.status='retired' AND NEW.status<>'retired') OR NEW.status NOT IN ('approved','retired') THEN
   RAISE EXCEPTION 'WA_APPROVED_POLICY_IMMUTABLE';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wa_policy_immutable ON whatsapp_service_policies;
CREATE TRIGGER wa_policy_immutable BEFORE UPDATE OR DELETE ON whatsapp_service_policies FOR EACH ROW EXECUTE FUNCTION wa_approved_policy_immutable();
