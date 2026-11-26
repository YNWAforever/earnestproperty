-- Resolve the owner's designated copy from the staff directory on every use.
CREATE FUNCTION enquiry_forwarding_copy_contact() RETURNS TABLE(staff_id uuid,phone text)
LANGUAGE sql STABLE AS $$
 SELECT id, number FROM staff_users s
 CROSS JOIN LATERAL (SELECT coalesce(enquiry_notification_phone(s.whatsapp),enquiry_notification_phone(s.phone)) AS number) n
 WHERE s.id='64d5a2d6-e602-4760-9709-63b0414f6a83' AND s.active AND number IS NOT NULL AND number<>'85297987774'
$$;

ALTER TABLE enquiry_notification_recipients DROP CONSTRAINT enquiry_notification_recipients_check,
 ALTER COLUMN phone DROP NOT NULL;
-- Retain the copy row and all historical attempt references. On an empty directory
-- leave a disabled, unbound slot for the first authenticated activation.
UPDATE enquiry_notification_recipients SET (staff_id,phone)=(SELECT staff_id,phone FROM enquiry_forwarding_copy_contact()),
 enabled=false,enabled_since=NULL,verification_ref=NULL,verified_at=NULL,permission_ref=NULL,permission_granted=false,
 channel_id=NULL,destination_reference=NULL,destination_type='recipient_id',template_name=NULL,template_language=NULL,
 template_verified_at=NULL,last_inbound_at=NULL,retired_at=NULL WHERE recipient_key='copy';
ALTER TABLE enquiry_notification_recipients ADD CONSTRAINT enquiry_notification_recipients_check CHECK (
 (kind='copy' AND recipient_key='copy' AND ((staff_id IS NULL AND phone IS NULL AND NOT enabled) OR
 (staff_id IS NOT NULL AND staff_id='64d5a2d6-e602-4760-9709-63b0414f6a83' AND phone IS NOT NULL AND phone<>'85297987774')))
 OR (kind='manager' AND phone IS NOT NULL AND recipient_key IN ('manager:1','manager:2','manager:3'))
 OR (kind='sales' AND phone IS NOT NULL AND staff_id IS NOT NULL AND recipient_key='sales:'||staff_id::text));

CREATE FUNCTION enquiry_check_copy_contact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.enabled AND NOT EXISTS(SELECT 1 FROM enquiry_forwarding_copy_contact() c WHERE c.staff_id=NEW.staff_id AND c.phone=NEW.phone)
 THEN RAISE EXCEPTION 'ENQUIRY_COPY_STAFF_CONTACT_INVALID'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enquiry_validate_copy_contact BEFORE INSERT OR UPDATE ON enquiry_notification_recipients
 FOR EACH ROW WHEN (NEW.kind='copy') EXECUTE FUNCTION enquiry_check_copy_contact();

CREATE OR REPLACE FUNCTION enquiry_forwarding_is_enabled(channel text DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM enquiry_notification_recipients r WHERE r.recipient_key='copy' AND r.kind='copy'
   AND EXISTS(SELECT 1 FROM enquiry_forwarding_copy_contact() c WHERE c.staff_id=r.staff_id AND c.phone=r.phone)
    AND r.enabled AND r.retired_at IS NULL AND r.permission_granted AND r.permission_ref IS NOT NULL
   AND r.verification_ref IS NOT NULL AND r.verified_at<=now() AND r.enabled_since<=now()
   AND NULLIF(trim(r.channel_id),'') IS NOT NULL AND NULLIF(trim(r.destination_reference),'') IS NOT NULL
   AND (channel IS NULL OR r.channel_id=channel))
$$;

CREATE OR REPLACE FUNCTION enquiry_info_phone_snapshot(app text,channel text,target text) RETURNS jsonb LANGUAGE sql STABLE AS $$
 WITH public_staff AS (
  SELECT id,active,show_on_website,enquiry_notification_phone(phone) AS phone,enquiry_notification_phone(whatsapp) AS whatsapp FROM staff_users WHERE active AND show_on_website
 ), managers(key,staff_id,phone) AS (VALUES
  ('manager:1','81206a23-777c-45c0-a2c5-7b53757206ca'::uuid,'85266442444'),
  ('manager:2','fb4dfa8f-a892-458b-a4f9-7caf48a4a0a2'::uuid,'85291005322'),
  ('manager:3','48e258b4-6b1f-4f65-b5e8-2f10a34806ba'::uuid,'85266266608')
 ), recipients AS (
  SELECT jsonb_build_object('key','copy','kind','copy','staffId',c.staff_id,'phone',c.phone) AS value,'copy' AS key FROM enquiry_forwarding_copy_contact() c WHERE c.phone=target
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
