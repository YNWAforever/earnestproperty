-- Informational phone copies only. No arm, review, backfill, CRM or authentication grant is seeded.
CREATE TABLE enquiry_forwarding_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 purpose text NOT NULL DEFAULT 'enq_forward_info' CHECK(purpose='enq_forward_info'),
 app_id text NOT NULL CHECK(app_id ~ '^[A-Za-z0-9_-]{1,160}$'),
 channel_id text NOT NULL CHECK(channel_id ~ '^[A-Za-z0-9_-]{1,160}$'),
 subject_kind text NOT NULL CHECK(subject_kind IN ('policy','recipient_phone','sender_member','receipt')),
 subject_key text NOT NULL CHECK(length(subject_key) BETWEEN 1 AND 256),
 revision integer NOT NULL CHECK(revision>0),
 previous_decision_id uuid REFERENCES enquiry_forwarding_decisions(id) ON DELETE RESTRICT,
 decision text NOT NULL,
 phone text CHECK(phone ~ '^852[456789][0-9]{7}$'),
 staff_id uuid REFERENCES staff_users(id) ON DELETE RESTRICT,
 member_id text CHECK(member_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 receipt_id uuid REFERENCES whatsapp_inbound_receipts(id) ON DELETE RESTRICT,
 related_decision_id uuid REFERENCES enquiry_forwarding_decisions(id) ON DELETE RESTRICT,
 profile_hash text CHECK(profile_hash ~ '^[a-f0-9]{64}$'),
 conflict_hash text CHECK(conflict_hash ~ '^[a-f0-9]{64}$'),
 identity_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(identity_snapshot)='object' AND octet_length(identity_snapshot::text)<=131072),
 evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=32768),
 authority_kind text NOT NULL CHECK(authority_kind IN ('owner_instruction','staff_session','system_policy')),
 actor_staff_id uuid REFERENCES staff_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(app_id,channel_id,subject_kind,subject_key,revision),
 CHECK((revision=1 AND previous_decision_id IS NULL) OR (revision>1 AND previous_decision_id IS NOT NULL)),
 CHECK((authority_kind='staff_session' AND actor_staff_id IS NOT NULL) OR (authority_kind IN ('owner_instruction','system_policy') AND actor_staff_id IS NULL)),
 CHECK(
  (subject_kind='policy' AND subject_key='policy' AND decision IN ('armed','paused','revoked') AND phone IS NULL AND staff_id IS NULL AND member_id IS NULL AND receipt_id IS NULL AND related_decision_id IS NULL)
  OR (subject_kind='recipient_phone' AND subject_key=phone AND decision IN ('approved','revoked') AND phone IS NOT NULL AND member_id IS NULL AND receipt_id IS NULL AND related_decision_id IS NULL AND profile_hash IS NOT NULL AND conflict_hash IS NOT NULL)
  OR (subject_kind='sender_member' AND subject_key=member_id AND decision IN ('staff_bound','customer_confirmed','revoked') AND member_id IS NOT NULL AND receipt_id IS NULL AND (decision<>'staff_bound' OR (phone IS NOT NULL AND related_decision_id IS NOT NULL AND profile_hash IS NOT NULL AND conflict_hash IS NOT NULL)))
  OR (subject_kind='receipt' AND subject_key=receipt_id::text AND decision IN ('held','released_customer','released_staff') AND receipt_id IS NOT NULL)
 )
);
REVOKE ALL ON enquiry_forwarding_decisions FROM PUBLIC;
CREATE INDEX enquiry_info_armed_witness ON enquiry_forwarding_decisions(app_id,channel_id,revision DESC) WHERE subject_kind='policy' AND decision='armed';
CREATE INDEX enquiry_info_member_phone ON enquiry_forwarding_decisions(app_id,channel_id,phone) WHERE subject_kind='sender_member';

CREATE FUNCTION enquiry_info_hash(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT encode(digest(value::text,'sha256'),'hex') $$;
CREATE FUNCTION enquiry_info_head(app text,channel text,kind text,key text) RETURNS enquiry_forwarding_decisions LANGUAGE sql STABLE AS $$
 SELECT d FROM enquiry_forwarding_decisions d WHERE d.app_id=app AND d.channel_id=channel AND d.subject_kind=kind AND d.subject_key=key ORDER BY d.revision DESC LIMIT 1
$$;
CREATE FUNCTION enquiry_info_latest_arm(app text,channel text) RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT id FROM enquiry_forwarding_decisions WHERE app_id=app AND channel_id=channel AND subject_kind='policy' AND decision='armed' ORDER BY revision DESC LIMIT 1
$$;

-- The contact/conversation predicates intentionally preserve D11's exact and refusal-leaning
-- digits/suffix semantics. Owned parity tests compare the empty set with BOTH legacy guards.
CREATE FUNCTION enquiry_info_phone_snapshot(app text,channel text,target text) RETURNS jsonb LANGUAGE sql STABLE AS $$
 WITH public_staff AS (
  SELECT id,active,show_on_website,enquiry_notification_phone(phone) AS phone,enquiry_notification_phone(whatsapp) AS whatsapp FROM staff_users WHERE active AND show_on_website
 ), managers(key,staff_id,phone) AS (VALUES
  ('manager:1','81206a23-777c-45c0-a2c5-7b53757206ca'::uuid,'85266442444'),
  ('manager:2','fb4dfa8f-a892-458b-a4f9-7caf48a4a0a2'::uuid,'85291005322'),
  ('manager:3','48e258b4-6b1f-4f65-b5e8-2f10a34806ba'::uuid,'85266266608')
 ), recipients AS (
  SELECT jsonb_build_object('key','copy','kind','copy','staffId',NULL,'phone','85297987774') AS value,'copy' AS key WHERE target='85297987774'
  UNION ALL SELECT jsonb_build_object('key','sales:'||s.id::text,'kind','sales','staffId',s.id,'phone',s.whatsapp,'businessPhone',s.phone,'whatsapp',s.whatsapp,'active',s.active,'public',s.show_on_website),'sales:'||s.id::text FROM public_staff s WHERE s.whatsapp=target
  UNION ALL SELECT jsonb_build_object('key',m.key,'kind','manager','staffId',s.id,'phone',m.phone,'businessPhone',s.phone,'whatsapp',s.whatsapp,'active',s.active,'public',s.show_on_website),m.key FROM managers m JOIN public_staff s ON s.id=m.staff_id WHERE m.phone=target AND m.phone IN (s.phone,s.whatsapp)
 ), contact_digits AS (
  SELECT c.*,regexp_replace(c.whatsapp_member_id,'\D','','g') AS md,regexp_replace(c.normalized_phone,'\D','','g') AS pd FROM crm_contacts c
 ), contacts AS (
  SELECT jsonb_build_object('id',id,'normalizedPhone',normalized_phone,'memberId',whatsapp_member_id) AS value,id FROM contact_digits
  WHERE whatsapp_member_id=target OR normalized_phone=target
   OR (length(target)>=8 AND (target IN (md,right(md,8),'852'||right(md,8)) OR (length(md)>=8 AND right(target,8)=right(md,8))))
   OR (length(target)>=8 AND (target IN (pd,right(pd,8),'852'||right(pd,8)) OR (length(pd)>=8 AND right(target,8)=right(pd,8))))
 ), conversation_digits AS (
  SELECT w.*,regexp_replace(w.woztell_member_id,'\D','','g') AS md FROM whatsapp_conversations w WHERE w.channel_id=channel
 ), conversations AS (
  SELECT jsonb_build_object('id',id,'channelId',channel_id,'memberId',woztell_member_id,'contactId',contact_id) AS value,id FROM conversation_digits
  WHERE woztell_member_id=target OR (length(target)>=8 AND (target IN (md,right(md,8),'852'||right(md,8)) OR (length(md)>=8 AND right(target,8)=right(md,8))))
   OR contact_id IN (SELECT id FROM contacts) OR woztell_member_id IN (SELECT value->>'memberId' FROM contacts)
 ), snapshots AS (
  SELECT COALESCE((SELECT jsonb_agg(value ORDER BY key) FROM recipients),'[]'::jsonb) AS profiles,
   jsonb_build_object('contacts',COALESCE((SELECT jsonb_agg(value ORDER BY id) FROM contacts),'[]'::jsonb),'conversations',COALESCE((SELECT jsonb_agg(value ORDER BY id) FROM conversations),'[]'::jsonb)) AS conflicts
 ) SELECT jsonb_build_object('phone',target,'profileHash',enquiry_info_hash(profiles),'conflictHash',enquiry_info_hash(conflicts),
  'eligible',jsonb_array_length(profiles)>0,'originalGuardAllows',jsonb_array_length(conflicts->'contacts')=0 AND jsonb_array_length(conflicts->'conversations')=0,
  'identitySnapshot',jsonb_build_object('recipients',profiles,'conflicts',conflicts)) FROM snapshots
$$;

CREATE FUNCTION enquiry_info_phone_approval_valid(decision_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH reviewed AS (SELECT d.*,enquiry_info_phone_snapshot(d.app_id,d.channel_id,d.phone) AS current_snapshot FROM enquiry_forwarding_decisions d WHERE id=decision_id AND subject_kind='recipient_phone' AND decision='approved')
 SELECT COALESCE(bool_and((enquiry_info_head(app_id,channel_id,'recipient_phone',phone)).id=id AND (current_snapshot->>'eligible')::boolean AND current_snapshot->>'profileHash'=profile_hash AND current_snapshot->>'conflictHash'=conflict_hash),false) FROM reviewed
$$;

CREATE FUNCTION enquiry_info_recipient_allowed(app text,channel text,target text) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH current_state AS (SELECT enquiry_info_phone_snapshot(app,channel,target) AS snapshot,enquiry_info_head(app,channel,'recipient_phone',target) AS review,enquiry_info_head(app,channel,'policy','policy') AS policy)
 SELECT COALESCE((policy).decision='armed' AND (snapshot->>'eligible')::boolean AND ((review).decision IS NULL OR (review).decision<>'revoked') AND ((snapshot->>'originalGuardAllows')::boolean OR enquiry_info_phone_approval_valid((review).id)),false) FROM current_state
$$;
CREATE FUNCTION enquiry_info_member_binding_valid(decision_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE(bool_and(d.decision='staff_bound' AND (enquiry_info_head(d.app_id,d.channel_id,'sender_member',d.member_id)).id=d.id AND enquiry_info_phone_approval_valid(d.related_decision_id)),false) FROM enquiry_forwarding_decisions d WHERE d.id=decision_id AND d.subject_kind='sender_member'
$$;

CREATE FUNCTION enquiry_info_member_proof_valid(proof jsonb,app text,channel text,target text,member text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE r whatsapp_inbound_receipts; a audit_logs; matched boolean; proof_app text;
BEGIN
 IF proof->>'kind'='accepted_ingress' THEN
  SELECT * INTO r FROM whatsapp_inbound_receipts WHERE id=(proof->>'receiptId')::uuid;
  RETURN COALESCE(r.app_id=app AND r.channel_id=channel AND r.origin='live_webhook' AND r.member_id=member AND r.body_digest ~ '^[a-f0-9]{64}$'
   AND r.normalized_event->>'appId'=app AND r.normalized_event->>'channelId'=channel AND r.normalized_event->>'woztellMemberId'=member
   AND r.normalized_event->>'direction'='inbound' AND enquiry_notification_phone(r.normalized_event->>'fromPhone')=target,false);
 ELSIF proof->>'kind'='provider_audit' THEN
  SELECT * INTO a FROM audit_logs WHERE id=(proof->>'auditId')::uuid AND action='whatsapp.enquiry_forwarding.provider_checked' AND created_at>now()-interval '24 hours' AND created_at<=clock_timestamp();
  IF NOT FOUND OR a.metadata->'channel'->>'configuredChannelId' IS DISTINCT FROM channel
    OR a.metadata->'members'->>'checked' IS DISTINCT FROM 'true' OR a.metadata->'members'->>'complete' IS DISTINCT FROM 'true' THEN RETURN false; END IF;
  -- Older reports did not retain app id. Corroborate those with an actual scoped receipt;
  -- a caller's claimed app id cannot upgrade an unscoped historical report.
  proof_app:=COALESCE(a.metadata->'channel'->>'appId',a.metadata->'infoForwarding'->>'appId');
  IF proof_app IS NOT NULL AND proof_app<>app THEN RETURN false; END IF;
  IF a.metadata->'channel'->>'appId' IS NOT NULL AND a.metadata->'infoForwarding'->>'appId' IS NOT NULL AND a.metadata->'channel'->>'appId' IS DISTINCT FROM a.metadata->'infoForwarding'->>'appId' THEN RETURN false; END IF;
  IF proof_app IS NULL THEN
   IF NOT enquiry_info_member_proof_valid(jsonb_build_object('kind','accepted_ingress','receiptId',proof->>'receiptId'),app,channel,target,member) THEN RETURN false; END IF;
  END IF;
  SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(a.metadata->'members'->'matched') m WHERE m->>'phone'=target AND m->>'memberId'=member AND m->>'proofHash'=proof->>'proofHash' AND m->>'proofHash' ~ '^[a-f0-9]{64}$') INTO matched;
  RETURN COALESCE(matched,false);
 END IF;
 RETURN false;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value THEN RETURN false;
END $$;

CREATE FUNCTION enquiry_info_decision_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous enquiry_forwarding_decisions; related enquiry_forwarding_decisions; current_member enquiry_forwarding_decisions; snapshot jsonb; r whatsapp_inbound_receipts; authority jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('enq-info:policy:'||NEW.app_id||':'||NEW.channel_id,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('enq-info:subject:'||NEW.app_id||':'||NEW.channel_id||':'||NEW.subject_kind||':'||NEW.subject_key,0));
 previous:=enquiry_info_head(NEW.app_id,NEW.channel_id,NEW.subject_kind,NEW.subject_key);
 IF NEW.revision<>COALESCE(previous.revision,0)+1 OR NEW.previous_decision_id IS DISTINCT FROM previous.id THEN RAISE EXCEPTION 'ENQUIRY_INFO_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 IF NEW.authority_kind='staff_session' THEN
  IF NOT EXISTS(SELECT 1 FROM staff_users s JOIN staff_roles reviewer_role ON reviewer_role.staff_user_id=s.id WHERE s.id=NEW.actor_staff_id AND s.active AND reviewer_role.role IN ('admin','manager')) THEN RAISE EXCEPTION 'ENQUIRY_INFO_REVIEWER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 ELSIF NEW.authority_kind='owner_instruction' THEN
  authority:=NEW.evidence->'ownerInstruction';
  IF NEW.actor_staff_id IS NOT NULL OR jsonb_typeof(authority) IS DISTINCT FROM 'object' OR length(COALESCE(authority->>'goalId','')) NOT BETWEEN 5 AND 160
   OR length(COALESCE(authority->>'sourceReference','')) NOT BETWEEN 3 AND 500 OR COALESCE(authority->>'sourceSha256','') !~ '^[a-f0-9]{64}$'
   OR length(COALESCE(authority->>'statement','')) NOT BETWEEN 3 AND 4000 OR length(COALESCE(authority->>'recorderReference','')) NOT BETWEEN 3 AND 300
   OR authority->>'receivedAt' IS NULL OR (authority->>'receivedAt')::timestamptz>clock_timestamp() THEN RAISE EXCEPTION 'ENQUIRY_INFO_OWNER_AUTHORITY_REQUIRED'; END IF;
  IF NEW.decision IN ('customer_confirmed','released_customer','released_staff','held') THEN RAISE EXCEPTION 'ENQUIRY_INFO_OWNER_IMPORT_SCOPE_INVALID'; END IF;
 ELSIF NEW.authority_kind='system_policy' THEN
  IF NEW.actor_staff_id IS NOT NULL OR NOT COALESCE(((NEW.subject_kind='receipt' AND NEW.decision='held') OR (NEW.subject_kind='sender_member' AND NEW.decision='staff_bound' AND NEW.evidence->>'derived'='true' AND NEW.evidence->'memberEvidence'->>'kind'='accepted_ingress')),false) THEN RAISE EXCEPTION 'ENQUIRY_INFO_SYSTEM_APPROVAL_FORBIDDEN'; END IF;
 END IF;
 IF NEW.subject_kind='policy' AND NEW.decision='armed' THEN
  IF NEW.authority_kind='owner_instruction' AND COALESCE(NEW.evidence->'ownerInstruction'->>'photoSha256','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'ENQUIRY_INFO_OWNER_PHOTO_AUTHORITY_REQUIRED'; END IF;
  IF NEW.authority_kind NOT IN ('staff_session','owner_instruction') OR NOT EXISTS(
   SELECT 1 FROM enquiry_notification_recipients c JOIN audit_logs a ON a.id=(NEW.evidence->>'providerProofAuditId')::uuid
   WHERE c.recipient_key='copy' AND c.enabled AND c.channel_id=NEW.channel_id AND c.version=(NEW.evidence->>'copyVersion')::integer
    AND c.xmin::text::bigint=(txid_current()%4294967296)
    AND a.action='whatsapp.enquiry_forwarding.provider_checked' AND a.created_at>now()-interval '24 hours'
    AND a.metadata->'channel'->>'configuredChannelId'=NEW.channel_id
    AND a.metadata->'infoForwarding'->>'ready'='true' AND a.metadata->'infoForwarding'->>'purpose'='enq_forward_info'
    AND a.metadata->'infoForwarding'->>'appId'=NEW.app_id AND a.metadata->'infoForwarding'->>'channelId'=NEW.channel_id
  ) THEN RAISE EXCEPTION 'ENQUIRY_INFO_ATOMIC_ARM_CONTEXT_REQUIRED'; END IF;
 END IF;
 IF NEW.related_decision_id IS NOT NULL THEN
  SELECT * INTO related FROM enquiry_forwarding_decisions WHERE id=NEW.related_decision_id;
  IF NOT FOUND OR related.app_id<>NEW.app_id OR related.channel_id<>NEW.channel_id OR related.purpose<>NEW.purpose THEN RAISE EXCEPTION 'ENQUIRY_INFO_RELATED_SCOPE_MISMATCH'; END IF;
 END IF;
 IF NEW.subject_kind='recipient_phone' THEN
  snapshot:=enquiry_info_phone_snapshot(NEW.app_id,NEW.channel_id,NEW.phone);
  IF NEW.decision='approved' AND (NOT (snapshot->>'eligible')::boolean OR NEW.profile_hash IS DISTINCT FROM snapshot->>'profileHash' OR NEW.conflict_hash IS DISTINCT FROM snapshot->>'conflictHash') THEN RAISE EXCEPTION 'ENQUIRY_INFO_IDENTITY_CHANGED' USING ERRCODE='40001'; END IF;
  NEW.profile_hash:=snapshot->>'profileHash'; NEW.conflict_hash:=snapshot->>'conflictHash'; NEW.identity_snapshot:=snapshot->'identitySnapshot';
  IF NEW.staff_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'identitySnapshot'->'recipients') p WHERE p->>'staffId'=NEW.staff_id::text) THEN RAISE EXCEPTION 'ENQUIRY_INFO_STAFF_PHONE_MISMATCH'; END IF;
 ELSIF NEW.subject_kind='sender_member' AND NEW.decision='staff_bound' THEN
  IF related.subject_kind IS DISTINCT FROM 'recipient_phone' OR related.phone IS DISTINCT FROM NEW.phone OR NOT enquiry_info_phone_approval_valid(related.id)
   OR NOT enquiry_info_member_proof_valid(NEW.evidence->'memberEvidence',NEW.app_id,NEW.channel_id,NEW.phone,NEW.member_id) THEN RAISE EXCEPTION 'ENQUIRY_INFO_MEMBER_BINDING_UNPROVED'; END IF;
  IF NEW.staff_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(related.identity_snapshot->'recipients') p WHERE p->>'staffId'=NEW.staff_id::text) THEN RAISE EXCEPTION 'ENQUIRY_INFO_STAFF_PHONE_MISMATCH'; END IF;
  NEW.profile_hash:=related.profile_hash; NEW.conflict_hash:=related.conflict_hash; NEW.identity_snapshot:=related.identity_snapshot;
 ELSIF NEW.subject_kind='sender_member' AND NEW.decision='customer_confirmed' THEN
  IF previous.decision='staff_bound' AND enquiry_info_phone_approval_valid(previous.related_decision_id) THEN RAISE EXCEPTION 'ENQUIRY_INFO_ACTIVE_STAFF_BINDING'; END IF;
 ELSIF NEW.subject_kind='receipt' THEN
  SELECT * INTO r FROM whatsapp_inbound_receipts WHERE id=NEW.receipt_id;
  IF NOT FOUND OR r.app_id<>NEW.app_id OR r.channel_id<>NEW.channel_id OR r.enquiry_forwarding_arm_id IS NULL THEN RAISE EXCEPTION 'ENQUIRY_INFO_RECEIPT_SCOPE_MISMATCH'; END IF;
  NEW.member_id:=r.member_id;
  IF NEW.decision='held' THEN
   IF previous.id IS NOT NULL THEN RAISE EXCEPTION 'ENQUIRY_INFO_RECEIPT_ALREADY_DECIDED'; END IF;
   NEW.related_decision_id:=r.enquiry_forwarding_arm_id;
  ELSE
   current_member:=enquiry_info_head(NEW.app_id,NEW.channel_id,'sender_member',r.member_id);
   IF previous.decision IS DISTINCT FROM 'held' OR NEW.related_decision_id IS DISTINCT FROM current_member.id
    OR (NEW.decision='released_staff' AND (current_member.decision IS DISTINCT FROM 'staff_bound' OR NOT enquiry_info_phone_approval_valid(current_member.related_decision_id)))
    OR (NEW.decision='released_customer' AND current_member.decision IS DISTINCT FROM 'customer_confirmed') THEN RAISE EXCEPTION 'ENQUIRY_INFO_RELEASE_REVIEW_REQUIRED'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;

ALTER TABLE whatsapp_inbound_receipts ADD COLUMN enquiry_forwarding_arm_id uuid REFERENCES enquiry_forwarding_decisions(id) ON DELETE RESTRICT;
CREATE FUNCTION enquiry_info_receipt_arm_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.enquiry_forwarding_arm_id IS DISTINCT FROM OLD.enquiry_forwarding_arm_id THEN RAISE EXCEPTION 'ENQUIRY_INFO_RECEIPT_ARM_IMMUTABLE'; END IF;
 IF NEW.enquiry_forwarding_arm_id IS NOT NULL AND (NEW.origin<>'live_webhook' OR NEW.body_digest !~ '^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'ENQUIRY_INFO_RECEIPT_ADMISSION_INVALID'; END IF;
 IF NEW.enquiry_forwarding_arm_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM enquiry_forwarding_decisions d WHERE d.id=NEW.enquiry_forwarding_arm_id AND d.purpose='enq_forward_info' AND d.subject_kind='policy' AND d.decision='armed' AND d.app_id=NEW.app_id AND d.channel_id=NEW.channel_id) THEN RAISE EXCEPTION 'ENQUIRY_INFO_RECEIPT_ARM_SCOPE_MISMATCH'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enquiry_info_receipt_arm_guard BEFORE INSERT OR UPDATE ON whatsapp_inbound_receipts FOR EACH ROW EXECUTE FUNCTION enquiry_info_receipt_arm_guard();
CREATE TRIGGER enquiry_info_insert_guard BEFORE INSERT ON enquiry_forwarding_decisions FOR EACH ROW EXECUTE FUNCTION enquiry_info_decision_insert_guard();
CREATE FUNCTION enquiry_info_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ENQUIRY_INFO_APPEND_ONLY'; END $$;
CREATE TRIGGER enquiry_info_append_only BEFORE UPDATE OR DELETE ON enquiry_forwarding_decisions FOR EACH ROW EXECUTE FUNCTION enquiry_info_append_only();

-- One controlled CAS writer. Callers acquire the policy/identity/subject locks in
-- preceding statements at READ COMMITTED; no lock-and-read CTE snapshot is used.
CREATE FUNCTION enquiry_info_append_decision(app text,channel text,kind text,key text,value text,expected integer,phone_value text,staff uuid,member text,receipt uuid,related uuid,profile text,conflicts text,proof jsonb,authority text,actor uuid) RETURNS enquiry_forwarding_decisions LANGUAGE plpgsql VOLATILE AS $$
DECLARE previous enquiry_forwarding_decisions; result enquiry_forwarding_decisions;
BEGIN
 previous:=enquiry_info_head(app,channel,kind,key);
 IF COALESCE(previous.revision,0)<>expected THEN RAISE EXCEPTION 'ENQUIRY_INFO_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 INSERT INTO enquiry_forwarding_decisions(app_id,channel_id,subject_kind,subject_key,revision,previous_decision_id,decision,phone,staff_id,member_id,receipt_id,related_decision_id,profile_hash,conflict_hash,evidence,authority_kind,actor_staff_id)
 VALUES(app,channel,kind,key,expected+1,previous.id,value,phone_value,staff,member,receipt,related,profile,conflicts,COALESCE(proof,'{}'::jsonb),authority,actor) RETURNING * INTO result;
 RETURN result;
END $$;

CREATE FUNCTION enquiry_info_system_hold(app text,channel text,receipt uuid,proof jsonb DEFAULT '{}'::jsonb) RETURNS enquiry_forwarding_decisions LANGUAGE plpgsql VOLATILE AS $$
DECLARE previous enquiry_forwarding_decisions;
BEGIN
 previous:=enquiry_info_head(app,channel,'receipt',receipt::text);
 IF previous.decision='held' THEN RETURN previous; END IF;
 IF previous.id IS NOT NULL THEN RAISE EXCEPTION 'ENQUIRY_INFO_RECEIPT_ALREADY_DECIDED'; END IF;
 RETURN enquiry_info_append_decision(app,channel,'receipt',receipt::text,'held',0,NULL,NULL,NULL,receipt,NULL,NULL,NULL,COALESCE(proof,'{}'::jsonb)||jsonb_build_object('reason','sender_identity_unresolved'),'system_policy',NULL);
END $$;

CREATE FUNCTION enquiry_info_derive_staff_binding(app text,channel text,receipt uuid,phone_review uuid) RETURNS enquiry_forwarding_decisions LANGUAGE plpgsql VOLATILE AS $$
DECLARE r whatsapp_inbound_receipts; approved enquiry_forwarding_decisions; previous enquiry_forwarding_decisions;
BEGIN
 SELECT * INTO r FROM whatsapp_inbound_receipts WHERE id=receipt AND app_id=app AND channel_id=channel AND enquiry_forwarding_arm_id IS NOT NULL;
 SELECT * INTO approved FROM enquiry_forwarding_decisions WHERE id=phone_review;
 IF r.id IS NULL OR approved.id IS NULL OR approved.app_id<>app OR approved.channel_id<>channel OR NOT enquiry_info_phone_approval_valid(approved.id)
  OR NOT enquiry_info_member_proof_valid(jsonb_build_object('kind','accepted_ingress','receiptId',receipt),app,channel,approved.phone,r.member_id) THEN RAISE EXCEPTION 'ENQUIRY_INFO_MEMBER_BINDING_UNPROVED'; END IF;
 previous:=enquiry_info_head(app,channel,'sender_member',r.member_id);
 IF previous.decision='staff_bound' AND previous.related_decision_id=phone_review AND previous.phone=approved.phone THEN RETURN previous; END IF;
 IF previous.id IS NOT NULL THEN RAISE EXCEPTION 'ENQUIRY_INFO_MEMBER_REVIEW_REQUIRED'; END IF;
 RETURN enquiry_info_append_decision(app,channel,'sender_member',r.member_id,'staff_bound',0,approved.phone,approved.staff_id,r.member_id,NULL,phone_review,approved.profile_hash,approved.conflict_hash,
  jsonb_build_object('derived',true,'memberEvidence',jsonb_build_object('kind','accepted_ingress','receiptId',receipt)),'system_policy',NULL);
END $$;
REVOKE ALL ON FUNCTION enquiry_info_append_decision(text,text,text,text,text,integer,text,uuid,text,uuid,uuid,text,text,jsonb,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION enquiry_info_system_hold(text,text,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION enquiry_info_derive_staff_binding(text,text,uuid,uuid) FROM PUBLIC;
