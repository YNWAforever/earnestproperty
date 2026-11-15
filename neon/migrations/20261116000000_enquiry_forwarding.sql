-- Approved notification contacts and photographed estate scopes only. No login,
-- Inbox assignment, customer consent, historical jobs or provider actions.
CREATE TABLE IF NOT EXISTS enquiry_notification_recipients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipient_key text NOT NULL UNIQUE CHECK(length(recipient_key) BETWEEN 1 AND 100),
 kind text NOT NULL CHECK(kind IN ('copy','manager','sales')),
 staff_id uuid REFERENCES staff_users(id),
 phone text NOT NULL CHECK(phone ~ '^852[456789][0-9]{7}$'),
 channel_id text CHECK(length(channel_id) BETWEEN 1 AND 160),
 destination_reference text CHECK(length(destination_reference) BETWEEN 1 AND 256),
 destination_type text NOT NULL DEFAULT 'recipient_id' CHECK(destination_type IN ('recipient_id','member_id')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 enabled boolean NOT NULL DEFAULT false,
 verification_ref text CHECK(length(trim(verification_ref)) BETWEEN 1 AND 500),
 verified_at timestamptz,
 permission_ref text CHECK(length(trim(permission_ref)) BETWEEN 1 AND 500),
 permission_granted boolean NOT NULL DEFAULT false,
 retired_at timestamptz,
 enabled_since timestamptz,
 last_inbound_at timestamptz,
 template_name text, template_language text, template_verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind='copy' AND recipient_key='copy' AND staff_id IS NULL AND phone='85297987774')
   OR (kind='manager' AND recipient_key IN ('manager:1','manager:2','manager:3'))
   OR (kind='sales' AND staff_id IS NOT NULL AND recipient_key='sales:'||staff_id::text)),
 CHECK (NOT enabled OR (channel_id IS NOT NULL AND destination_reference IS NOT NULL
   AND verified_at IS NOT NULL AND verification_ref IS NOT NULL AND permission_granted
   AND permission_ref IS NOT NULL AND retired_at IS NULL AND enabled_since IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS enquiry_estate_routes (
 scope_key text PRIMARY KEY CHECK(length(scope_key) BETWEEN 1 AND 160),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 160),
 estate_id uuid REFERENCES estates(id),
 aliases text[] NOT NULL CHECK(cardinality(aliases)>0 AND array_position(aliases,NULL) IS NULL),
 district_scope text,
 manager_recipient_key text NOT NULL REFERENCES enquiry_notification_recipients(recipient_key),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 enabled boolean NOT NULL DEFAULT false,
 approval_ref text NOT NULL CHECK(length(trim(approval_ref)) BETWEEN 1 AND 500),
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(manager_recipient_key IN ('manager:1','manager:2','manager:3'))
);
CREATE INDEX IF NOT EXISTS enquiry_estate_routes_estate ON enquiry_estate_routes(estate_id) WHERE estate_id IS NOT NULL;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS enquiry_routing_context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(enquiry_routing_context)='object');

CREATE OR REPLACE FUNCTION enquiry_notification_phone(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 WITH cleaned AS (SELECT regexp_replace(value,'[[:space:]()+.-]','','g') AS p)
 SELECT CASE WHEN p ~ '^852[456789][0-9]{7}$' THEN p
   WHEN p ~ '^[456789][0-9]{7}$' THEN '852'||p
   WHEN p ~ '^00852[456789][0-9]{7}$' THEN substr(p,3) ELSE NULL END FROM cleaned
$$;
CREATE OR REPLACE FUNCTION enquiry_notification_recipient_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_staff uuid; expected_phone text;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.recipient_key,NEW.kind) IS DISTINCT FROM (OLD.recipient_key,OLD.kind)
 THEN RAISE EXCEPTION 'ENQUIRY_RECIPIENT_IDENTITY_IMMUTABLE'; END IF;
 IF NEW.kind='manager' THEN
   SELECT x.staff_id,x.phone INTO expected_staff,expected_phone FROM (VALUES
     ('manager:1','81206a23-777c-45c0-a2c5-7b53757206ca'::uuid,'85266442444'),
     ('manager:2','fb4dfa8f-a892-458b-a4f9-7caf48a4a0a2'::uuid,'85291005322'),
     ('manager:3','48e258b4-6b1f-4f65-b5e8-2f10a34806ba'::uuid,'85266266608')
   ) x(recipient_key,staff_id,phone) WHERE x.recipient_key=NEW.recipient_key;
   IF NEW.phone IS DISTINCT FROM expected_phone OR (NEW.staff_id IS NOT NULL AND NEW.staff_id IS DISTINCT FROM expected_staff)
   THEN RAISE EXCEPTION 'ENQUIRY_MANAGER_CONTACT_CHANGED'; END IF;
 END IF;
 IF NEW.enabled THEN
   IF NEW.verified_at>now() OR NEW.verified_at IS NULL OR NEW.permission_granted IS DISTINCT FROM true
     OR NULLIF(trim(NEW.verification_ref),'') IS NULL OR NULLIF(trim(NEW.permission_ref),'') IS NULL
     OR NULLIF(trim(NEW.channel_id),'') IS NULL OR NULLIF(trim(NEW.destination_reference),'') IS NULL
     OR NEW.retired_at IS NOT NULL
   THEN RAISE EXCEPTION 'ENQUIRY_RECIPIENT_NOT_VERIFIED'; END IF;
   IF NEW.destination_type='recipient_id' AND NEW.destination_reference IS DISTINCT FROM NEW.phone
   THEN RAISE EXCEPTION 'ENQUIRY_RECIPIENT_PHONE_DESTINATION_MISMATCH'; END IF;
   IF NEW.kind<>'copy' AND NOT EXISTS(SELECT 1 FROM staff_users s WHERE s.id=NEW.staff_id
     AND s.active AND s.show_on_website AND ((NEW.kind='sales' AND NEW.phone=enquiry_notification_phone(s.whatsapp))
       OR (NEW.kind='manager' AND NEW.phone IN (enquiry_notification_phone(s.phone),enquiry_notification_phone(s.whatsapp)))))
   THEN RAISE EXCEPTION 'ENQUIRY_RECIPIENT_PUBLIC_CONTACT_INVALID'; END IF;
   IF TG_OP='INSERT' THEN NEW.enabled_since:=clock_timestamp();
   ELSIF NOT OLD.enabled OR NEW.channel_id IS DISTINCT FROM OLD.channel_id THEN NEW.enabled_since:=clock_timestamp();
   ELSE NEW.enabled_since:=OLD.enabled_since; END IF;
 END IF;
 IF TG_OP='UPDATE' THEN
   IF (NEW.staff_id,NEW.phone,NEW.channel_id,NEW.destination_reference,NEW.destination_type,NEW.enabled,NEW.verification_ref,NEW.verified_at,NEW.permission_ref,NEW.permission_granted,NEW.retired_at,NEW.template_name,NEW.template_language,NEW.template_verified_at)
     IS DISTINCT FROM (OLD.staff_id,OLD.phone,OLD.channel_id,OLD.destination_reference,OLD.destination_type,OLD.enabled,OLD.verification_ref,OLD.verified_at,OLD.permission_ref,OLD.permission_granted,OLD.retired_at,OLD.template_name,OLD.template_language,OLD.template_verified_at)
   THEN NEW.version:=OLD.version+1; ELSE NEW.version:=OLD.version; END IF;
 END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enquiry_notification_recipient_version ON enquiry_notification_recipients;
CREATE TRIGGER enquiry_notification_recipient_version BEFORE INSERT OR UPDATE ON enquiry_notification_recipients FOR EACH ROW EXECUTE FUNCTION enquiry_notification_recipient_version();
CREATE OR REPLACE FUNCTION enquiry_estate_route_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.scope_key IS DISTINCT FROM OLD.scope_key THEN RAISE EXCEPTION 'ENQUIRY_ROUTE_IDENTITY_IMMUTABLE'; END IF;
 IF (NEW.label,NEW.estate_id,NEW.aliases,NEW.district_scope,NEW.manager_recipient_key,NEW.enabled,NEW.approval_ref,NEW.source_hash)
   IS DISTINCT FROM (OLD.label,OLD.estate_id,OLD.aliases,OLD.district_scope,OLD.manager_recipient_key,OLD.enabled,OLD.approval_ref,OLD.source_hash)
 THEN NEW.version:=OLD.version+1; ELSE NEW.version:=OLD.version; END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enquiry_estate_route_version ON enquiry_estate_routes;
CREATE TRIGGER enquiry_estate_route_version BEFORE UPDATE ON enquiry_estate_routes FOR EACH ROW EXECUTE FUNCTION enquiry_estate_route_version();

INSERT INTO enquiry_notification_recipients(recipient_key,kind,staff_id,phone) VALUES
 ('copy','copy',NULL,'85297987774'),
 ('manager:1','manager',(SELECT id FROM staff_users WHERE id='81206a23-777c-45c0-a2c5-7b53757206ca'),'85266442444'),
 ('manager:2','manager',(SELECT id FROM staff_users WHERE id='fb4dfa8f-a892-458b-a4f9-7caf48a4a0a2'),'85291005322'),
 ('manager:3','manager',(SELECT id FROM staff_users WHERE id='48e258b4-6b1f-4f65-b5e8-2f10a34806ba'),'85266266608')
ON CONFLICT(recipient_key) DO NOTHING;
CREATE OR REPLACE FUNCTION enquiry_estate_alias_key(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT upper(replace(regexp_replace(normalize(value,NFKC),'[[:space:][:punct:]]','','g'),'台','臺'))
$$;
WITH photo(scope_key,label,aliases,district_scope,manager_recipient_key) AS (VALUES
 ('photo:1:sham-tseng:1','豪景花園',ARRAY['豪景花園'],'sham-tseng','manager:1'),
 ('photo:1:sham-tseng:2','帝華軒',ARRAY['帝華軒'],'sham-tseng','manager:1'),
 ('photo:1:sham-tseng:3','龍騰閣',ARRAY['龍騰閣'],'sham-tseng','manager:1'),
 ('photo:1:sham-tseng:4','逸璟龍灣',ARRAY['逸璟龍灣'],'sham-tseng','manager:1'),
 ('photo:1:sham-tseng:5','深井汀九村屋',ARRAY['深井汀九村屋','深井村屋','汀九村屋','深井/汀九村屋'],'sham-tseng','manager:1'),
 ('photo:1:castle-peak-road:1','滿名山',ARRAY['滿名山'],'castle-peak-road','manager:1'),
 ('photo:1:castle-peak-road:2','星堤',ARRAY['星堤'],'castle-peak-road','manager:1'),
 ('photo:1:castle-peak-road:3','上源',ARRAY['上源'],'castle-peak-road','manager:1'),
 ('photo:1:castle-peak-road:4','The Carmel',ARRAY['The Carmel'],'castle-peak-road','manager:1'),
 ('photo:1:castle-peak-road:5','南岸',ARRAY['南岸'],'castle-peak-road','manager:1'),
 ('photo:1:castle-peak-road:6','愛琴海岸',ARRAY['愛琴海岸'],'castle-peak-road','manager:1'),
 ('photo:1:castle-peak-road:7','帝御',ARRAY['帝御'],'castle-peak-road','manager:1'),
 ('photo:1:castle-peak-road:8','凱和山',ARRAY['凱和山'],'castle-peak-road','manager:1'),
 ('photo:1:castle-peak-road:9','愛琴灣',ARRAY['愛琴灣'],'castle-peak-road','manager:1'),
 ('photo:1:castle-peak-road:10','海澄軒',ARRAY['海澄軒'],'castle-peak-road','manager:1'),
 ('photo:1:castle-peak-road:11','龍珠島',ARRAY['龍珠島'],'castle-peak-road','manager:1'),
 ('photo:1:castle-peak-road:12','碧翠花園',ARRAY['碧翠花園'],'castle-peak-road','manager:1'),
 ('photo:1:castle-peak-road:13','海譽',ARRAY['海譽'],'castle-peak-road','manager:1'),
 ('photo:1:castle-peak-road:14','青榕臺',ARRAY['青榕臺'],'castle-peak-road','manager:1'),
 ('photo:1:castle-peak-road:15','海景花園',ARRAY['海景花園'],'castle-peak-road','manager:1'),
 ('photo:1:castle-peak-road:16','翠峰小築',ARRAY['翠峰小築'],'castle-peak-road','manager:1'),
 ('photo:1:castle-peak-road:17','容龍居',ARRAY['容龍居'],'castle-peak-road','manager:1'),
 ('photo:1:castle-peak-road:18','翠濤居',ARRAY['翠濤居'],'castle-peak-road','manager:1'),
 ('photo:1:castle-peak-road:19','棕月灣',ARRAY['棕月灣'],'castle-peak-road','manager:1'),
 ('photo:1:castle-peak-road:20','青山別墅',ARRAY['青山別墅'],'castle-peak-road','manager:1'),
 ('photo:1:castle-peak-road:21','蟠龍半島',ARRAY['蟠龍半島'],'castle-peak-road','manager:1'),
 ('photo:1:castle-peak-road:22','青麗灣別墅',ARRAY['青麗灣別墅'],'castle-peak-road','manager:1'),
 ('photo:2:sham-tseng:1','浪翠園',ARRAY['浪翠園'],'sham-tseng','manager:2'),
 ('photo:2:sham-tseng:2','麗都花園',ARRAY['麗都花園'],'sham-tseng','manager:2'),
 ('photo:2:sham-tseng:3','海雲軒',ARRAY['海雲軒'],'sham-tseng','manager:2'),
 ('photo:2:sham-tseng:4','嘉御龍庭',ARRAY['嘉御龍庭'],'sham-tseng','manager:2'),
 ('photo:2:sham-tseng:5','皇璧',ARRAY['皇璧','皇壁'],'sham-tseng','manager:2'),
 ('photo:2:sham-tseng:6','新麗苑',ARRAY['新麗苑'],'sham-tseng','manager:2'),
 ('photo:2:sham-tseng:7','金麗苑',ARRAY['金麗苑'],'sham-tseng','manager:2'),
 ('photo:2:castle-peak-road:1','NAPA',ARRAY['NAPA'],'castle-peak-road','manager:2'),
 ('photo:2:castle-peak-road:2','Oma Oma',ARRAY['Oma Oma'],'castle-peak-road','manager:2'),
 ('photo:2:castle-peak-road:3','黃金海灣',ARRAY['黃金海灣'],'castle-peak-road','manager:2'),
 ('photo:2:castle-peak-road:4','帝濤灣',ARRAY['帝濤灣'],'castle-peak-road','manager:2'),
 ('photo:2:castle-peak-road:5','漣山',ARRAY['漣山'],'castle-peak-road','manager:2'),
 ('photo:2:castle-peak-road:6','瑜翠園',ARRAY['瑜翠園'],'castle-peak-road','manager:2'),
 ('photo:2:castle-peak-road:7','雅德苑',ARRAY['雅德苑'],'castle-peak-road','manager:2'),
 ('photo:2:castle-peak-road:8','雅翠苑',ARRAY['雅翠苑'],'castle-peak-road','manager:2'),
 ('photo:2:castle-peak-road:9','春和海景花園',ARRAY['春和海景花園'],'castle-peak-road','manager:2'),
 ('photo:3:sham-tseng:1','碧堤半島',ARRAY['碧堤半島'],'sham-tseng','manager:3'),
 ('photo:3:sham-tseng:2','海韻花園',ARRAY['海韻花園'],'sham-tseng','manager:3'),
 ('photo:3:sham-tseng:3','縉皇居',ARRAY['縉皇居'],'sham-tseng','manager:3'),
 ('photo:3:sham-tseng:4','海韻臺',ARRAY['海韻臺'],'sham-tseng','manager:3'),
 ('photo:3:castle-peak-road:1','琨崙',ARRAY['琨崙'],'castle-peak-road','manager:3'),
 ('photo:3:castle-peak-road:2','黃金海岸',ARRAY['黃金海岸'],'castle-peak-road','manager:3'),
 ('photo:3:castle-peak-road:3','OMA by the Sea',ARRAY['OMA by the Sea'],'castle-peak-road','manager:3'),
 ('photo:3:castle-peak-road:4','飛揚',ARRAY['飛揚'],'castle-peak-road','manager:3'),
 ('photo:3:castle-peak-road:5','浪濤灣',ARRAY['浪濤灣'],'castle-peak-road','manager:3'),
 ('photo:3:castle-peak-road:6','海慧花園',ARRAY['海慧花園'],'castle-peak-road','manager:3'),
 ('photo:3:castle-peak-road:7','屯門閣',ARRAY['屯門閣'],'castle-peak-road','manager:3')
)
INSERT INTO enquiry_estate_routes(scope_key,label,estate_id,aliases,district_scope,manager_recipient_key,enabled,approval_ref,source_hash)
SELECT p.scope_key,p.label,(SELECT CASE WHEN count(*)=1 THEN min(e.id::text)::uuid END FROM estates e
 WHERE enquiry_estate_alias_key(e.name_zh)=ANY(SELECT enquiry_estate_alias_key(a) FROM unnest(p.aliases) a)
 OR enquiry_estate_alias_key(e.name_en)=ANY(SELECT enquiry_estate_alias_key(a) FROM unnest(p.aliases) a)),
 p.aliases,p.district_scope,p.manager_recipient_key,true,'user-20261116-enquiry-forwarding-goal5c39c5b8','53c362f1ae9ec48e8cdd753bde4bf96a3354a0d432a58964e75c7b3f4a4a1c12'
FROM photo p ON CONFLICT(scope_key) DO NOTHING;

ALTER TABLE staff_notification_attempts
 ADD COLUMN IF NOT EXISTS forwarding_inquiry_id uuid REFERENCES inquiries(id),
 ADD COLUMN IF NOT EXISTS forwarding_recipient_id uuid REFERENCES enquiry_notification_recipients(id),
 ADD COLUMN IF NOT EXISTS recipient_version integer CHECK(recipient_version>0),
 ADD COLUMN IF NOT EXISTS routing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(routing_snapshot)='object');
ALTER TABLE staff_notification_attempts DROP CONSTRAINT IF EXISTS staff_attempt_one_subject;
ALTER TABLE staff_notification_attempts ADD CONSTRAINT staff_attempt_one_subject CHECK(num_nonnulls(notification_id,lead_id,forwarding_inquiry_id)=1);
ALTER TABLE staff_notification_attempts DROP CONSTRAINT IF EXISTS staff_attempt_one_destination_source;
ALTER TABLE staff_notification_attempts ADD CONSTRAINT staff_attempt_one_destination_source CHECK(num_nonnulls(endpoint_id,forwarding_recipient_id)<=1);
ALTER TABLE staff_notification_attempts DROP CONSTRAINT IF EXISTS staff_attempt_forward_transport;
ALTER TABLE staff_notification_attempts ADD CONSTRAINT staff_attempt_forward_transport CHECK(forwarding_recipient_id IS NULL OR (transport='staff_whatsapp' AND notification_id IS NULL AND recipient_version IS NOT NULL));
CREATE INDEX IF NOT EXISTS staff_attempts_forward_inquiry ON staff_notification_attempts(forwarding_inquiry_id) WHERE forwarding_inquiry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS staff_attempts_forward_lead_recipient ON staff_notification_attempts(lead_id,forwarding_recipient_id) WHERE lead_id IS NOT NULL AND forwarding_recipient_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS staff_attempts_forward_inquiry_recipient ON staff_notification_attempts(forwarding_inquiry_id,forwarding_recipient_id) WHERE forwarding_inquiry_id IS NOT NULL AND forwarding_recipient_id IS NOT NULL;
CREATE OR REPLACE FUNCTION wa_staff_attempt_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recipient record;
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.forwarding_recipient_id IS NOT NULL THEN
     SELECT * INTO recipient FROM enquiry_notification_recipients WHERE id=NEW.forwarding_recipient_id;
     IF NOT FOUND OR (NEW.recipient_version IS NOT NULL AND NEW.recipient_version<>recipient.version)
     THEN RAISE EXCEPTION 'ENQUIRY_ATTEMPT_RECIPIENT_CHANGED'; END IF;
     NEW.recipient_version:=recipient.version;
     NEW.destination_reference_snapshot:=recipient.destination_reference;
     NEW.channel_id_snapshot:=recipient.channel_id;
   ELSE
     SELECT destination_reference,channel_id INTO NEW.destination_reference_snapshot,NEW.channel_id_snapshot FROM staff_notification_endpoints WHERE id=NEW.endpoint_id;
   END IF;
 ELSIF (NEW.endpoint_id,NEW.endpoint_version,NEW.destination_reference_snapshot,NEW.channel_id_snapshot,NEW.transport,NEW.notification_id,NEW.lead_id,NEW.forwarding_inquiry_id,NEW.forwarding_recipient_id,NEW.recipient_version,NEW.routing_snapshot,NEW.attempt_generation,NEW.attempt_key)
   IS DISTINCT FROM (OLD.endpoint_id,OLD.endpoint_version,OLD.destination_reference_snapshot,OLD.channel_id_snapshot,OLD.transport,OLD.notification_id,OLD.lead_id,OLD.forwarding_inquiry_id,OLD.forwarding_recipient_id,OLD.recipient_version,OLD.routing_snapshot,OLD.attempt_generation,OLD.attempt_key)
 THEN RAISE EXCEPTION 'STAFF_ATTEMPT_TARGET_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION enquiry_forwarding_is_enabled(channel text DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM enquiry_notification_recipients r WHERE r.recipient_key='copy' AND r.kind='copy'
   AND r.enabled AND r.retired_at IS NULL AND r.permission_granted AND r.permission_ref IS NOT NULL
   AND r.verification_ref IS NOT NULL AND r.verified_at<=now() AND r.enabled_since<=now()
   AND NULLIF(trim(r.channel_id),'') IS NOT NULL AND NULLIF(trim(r.destination_reference),'') IS NOT NULL
   AND (channel IS NULL OR r.channel_id=channel))
$$;
-- Reusable eligibility is also checked by the read-only resolver immediately
-- before dispatch. It never activates customer auto-replies or assignments.
CREATE OR REPLACE FUNCTION enquiry_forwarding_whatsapp_eligible(subject uuid,channel text DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM inquiries i
   JOIN whatsapp_enquiry_events e ON e.inquiry_id=i.id AND e.message_id=i.intake_message_id
   JOIN whatsapp_messages m ON m.id=e.message_id AND m.conversation_id=i.conversation_id
   JOIN whatsapp_conversations w ON w.id=m.conversation_id
   JOIN crm_contacts customer ON customer.id=m.contact_id
   JOIN enquiry_notification_recipients copy ON copy.recipient_key='copy'
   WHERE i.id=subject AND i.source='whatsapp' AND i.status NOT IN ('closed','resolved','spam')
     AND enquiry_forwarding_is_enabled(e.channel_id) AND (channel IS NULL OR e.channel_id=channel)
     AND e.origin='live_webhook' AND e.kind='customer_message' AND e.capture_mode IN ('observe','active')
     AND e.timing='fresh' AND e.identity_quality='provider_id' AND e.processing_state<>'suppressed'
     AND e.occurred_at BETWEEN e.received_at-interval '15 minutes' AND e.received_at+interval '1 minute'
     AND e.received_at BETWEEN copy.enabled_since AND now()+interval '1 minute' AND i.created_at>=copy.enabled_since
     AND m.direction::text='inbound' AND m.channel_id=e.channel_id AND m.woztell_member_id=e.member_id
     AND w.channel_id=e.channel_id AND w.woztell_member_id=e.member_id
     AND m.contact_id=w.contact_id AND i.crm_contact_id=w.contact_id
     AND NOT EXISTS(SELECT 1 FROM enquiry_notification_recipients r WHERE r.phone IN (enquiry_notification_phone(e.member_id),enquiry_notification_phone(customer.normalized_phone),enquiry_notification_phone(customer.phone)) OR (r.channel_id=e.channel_id AND r.destination_reference=e.member_id))
     AND NOT EXISTS(SELECT 1 FROM staff_users s WHERE s.active AND (enquiry_notification_phone(e.member_id) IN (enquiry_notification_phone(s.phone),enquiry_notification_phone(s.whatsapp)) OR enquiry_notification_phone(customer.normalized_phone) IN (enquiry_notification_phone(s.phone),enquiry_notification_phone(s.whatsapp)) OR enquiry_notification_phone(customer.phone) IN (enquiry_notification_phone(s.phone),enquiry_notification_phone(s.whatsapp))))
     AND NOT EXISTS(SELECT 1 FROM staff_notification_internal_events x WHERE x.channel_id=e.channel_id AND x.member_id=e.member_id)
 )
$$;
CREATE OR REPLACE FUNCTION enquiry_enqueue_forward(source text,subject uuid,channel text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE job uuid;
BEGIN
 IF source IS NULL OR source NOT IN ('website','whatsapp') OR NOT enquiry_forwarding_is_enabled(channel) THEN RETURN NULL; END IF;
 IF source='website' AND NOT EXISTS(SELECT 1 FROM crm_leads l JOIN enquiry_notification_recipients copy ON copy.recipient_key='copy'
   WHERE l.id=subject AND l.source='website' AND l.created_at>=copy.enabled_since) THEN RETURN NULL; END IF;
 IF source='whatsapp' AND NOT enquiry_forwarding_whatsapp_eligible(subject,channel) THEN RETURN NULL; END IF;
 INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key)
 VALUES('woztell.enquiry.forward',1,jsonb_build_object('source',source,'subjectId',subject::text),'queued',3,now(),'enquiry-forward:'||source||':'||subject::text)
 ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO job;
 RETURN job;
END $$;
CREATE OR REPLACE FUNCTION enquiry_forwarding_intake_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='crm_leads' THEN
   IF NEW.source='website' THEN PERFORM enquiry_enqueue_forward('website',NEW.id); END IF;
 ELSIF NEW.inquiry_id IS NOT NULL AND NEW.inquiry_id IS DISTINCT FROM OLD.inquiry_id THEN
   PERFORM enquiry_enqueue_forward('whatsapp',NEW.inquiry_id,NEW.channel_id);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enquiry_forwarding_website_intake ON crm_leads;
CREATE TRIGGER enquiry_forwarding_website_intake AFTER INSERT ON crm_leads FOR EACH ROW EXECUTE FUNCTION enquiry_forwarding_intake_trigger();
DROP TRIGGER IF EXISTS enquiry_forwarding_whatsapp_intake ON whatsapp_enquiry_events;
CREATE TRIGGER enquiry_forwarding_whatsapp_intake AFTER UPDATE OF inquiry_id ON whatsapp_enquiry_events FOR EACH ROW EXECUTE FUNCTION enquiry_forwarding_intake_trigger();
