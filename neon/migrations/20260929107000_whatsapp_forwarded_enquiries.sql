-- Manual handoffs are not signed inbound WhatsApp events. Keep provenance and
-- unverified original-customer text separate from CRM contact/reply identity.
CREATE TABLE IF NOT EXISTS whatsapp_forwarded_enquiries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL,
 forwarded_by uuid NOT NULL REFERENCES staff_users(id),
 crm_lead_id uuid UNIQUE REFERENCES crm_leads(id),
 raw_text text NOT NULL CHECK(length(raw_text) BETWEEN 1 AND 4000),
 source_url text,
 original_customer_contact text,
 original_received_at timestamptz,
 note text,
 business_source text NOT NULL,
 follow_up_title text,
 follow_up_due_at timestamptz,
 responsible_staff_id uuid REFERENCES staff_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(forwarded_by,request_id)
);
CREATE INDEX IF NOT EXISTS wa_forwarded_lead ON whatsapp_forwarded_enquiries(crm_lead_id);

CREATE OR REPLACE FUNCTION wa_capture_forwarded_enquiry(
 p_actor uuid,p_request uuid,p_text text,p_source_url text,
 p_customer_contact text,p_original_received timestamptz,p_note text,
 p_business_source text,p_follow_up_title text,p_follow_up_due timestamptz,
 p_responsible uuid
) RETURNS TABLE(lead_id uuid,created boolean) LANGUAGE plpgsql AS $$
DECLARE actor_row staff_users%ROWTYPE; owner_row staff_users%ROWTYPE;
        reserved uuid; previous whatsapp_forwarded_enquiries%ROWTYPE;
        target_owner uuid; new_lead uuid;
BEGIN
 SELECT * INTO actor_row FROM staff_users WHERE id=p_actor AND active;
 IF NOT FOUND OR NOT EXISTS(
  SELECT 1 FROM staff_roles WHERE staff_user_id=p_actor AND role::text IN ('admin','manager','agent')
 ) THEN RAISE EXCEPTION 'WA_FORWARD_ACTOR_FORBIDDEN'; END IF;
 IF p_request IS NULL OR p_text IS NULL OR length(btrim(p_text))<1 OR length(p_text)>4000
  OR p_business_source IS NULL OR length(btrim(p_business_source))<2 OR length(p_business_source)>80
  OR length(coalesce(p_customer_contact,''))>200 OR length(coalesce(p_note,''))>1000
  OR length(coalesce(p_source_url,''))>1000
  OR (p_source_url IS NOT NULL AND p_source_url !~* '^https://[^[:space:]]+$')
  OR (nullif(btrim(p_follow_up_title),'') IS NULL) <> (p_follow_up_due IS NULL)
  OR length(coalesce(p_follow_up_title,''))>200
 THEN RAISE EXCEPTION 'WA_FORWARD_INVALID'; END IF;
 target_owner:=coalesce(p_responsible,p_actor);
 SELECT * INTO owner_row FROM staff_users WHERE id=target_owner AND active;
 IF NOT FOUND OR (target_owner<>p_actor AND NOT EXISTS(
   SELECT 1 FROM staff_roles WHERE staff_user_id=p_actor AND role::text='admin'
 ) AND (NOT EXISTS(SELECT 1 FROM staff_roles WHERE staff_user_id=p_actor AND role::text='manager')
   OR actor_row.branch_id IS NULL OR owner_row.branch_id IS DISTINCT FROM actor_row.branch_id))
 THEN RAISE EXCEPTION 'WA_FORWARD_OWNER_SCOPE'; END IF;
 INSERT INTO whatsapp_forwarded_enquiries(request_id,forwarded_by,raw_text,source_url,
   original_customer_contact,original_received_at,note,business_source,follow_up_title,
   follow_up_due_at,responsible_staff_id)
 VALUES(p_request,p_actor,btrim(p_text),p_source_url,nullif(btrim(p_customer_contact),''),
   p_original_received,nullif(btrim(p_note),''),btrim(p_business_source),
   nullif(btrim(p_follow_up_title),''),p_follow_up_due,target_owner)
 ON CONFLICT(forwarded_by,request_id) DO NOTHING RETURNING id INTO reserved;
 IF reserved IS NULL THEN
  SELECT * INTO previous FROM whatsapp_forwarded_enquiries
   WHERE forwarded_by=p_actor AND request_id=p_request FOR UPDATE;
  IF NOT FOUND OR (previous.raw_text,previous.source_url,previous.original_customer_contact,
   previous.original_received_at,previous.note,previous.business_source,
   previous.follow_up_title,previous.follow_up_due_at,previous.responsible_staff_id)
   IS DISTINCT FROM (btrim(p_text),p_source_url,nullif(btrim(p_customer_contact),''),
   p_original_received,nullif(btrim(p_note),''),btrim(p_business_source),
   nullif(btrim(p_follow_up_title),''),p_follow_up_due,target_owner)
  THEN RAISE EXCEPTION 'WA_FORWARD_REQUEST_CONFLICT'; END IF;
  lead_id:=previous.crm_lead_id; created:=false; RETURN NEXT; RETURN;
 END IF;
 INSERT INTO crm_leads(assigned_agent_id,stage,intent,source,note)
 VALUES(target_owner,'new','buyer','manual_forward',LEFT(btrim(p_text),500))
 RETURNING id INTO new_lead;
 UPDATE whatsapp_forwarded_enquiries SET crm_lead_id=new_lead WHERE id=reserved;
 IF p_follow_up_title IS NOT NULL THEN
  INSERT INTO crm_activities(lead_id,staff_user_id,activity_type,body,due_at)
  VALUES(new_lead,target_owner,'follow_up',btrim(p_follow_up_title),p_follow_up_due);
 END IF;
 lead_id:=new_lead; created:=true; RETURN NEXT;
END $$;
-- Explicit CRM contact edit: scopes on the lead at commit, leaves phone and
-- consent/window fields untouched, and records one audit row for a change.
CREATE OR REPLACE FUNCTION wa_update_lead_contact(
 p_actor uuid,p_lead uuid,p_name text,p_email text
) RETURNS TABLE(contact_id uuid) LANGUAGE plpgsql AS $$
DECLARE chosen uuid; current_name text; current_email text;
BEGIN
 IF length(coalesce(p_name,''))>160 OR length(coalesce(p_email,''))>254
  OR (p_email IS NOT NULL AND btrim(p_email)<>'' AND
   btrim(p_email) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
 THEN RAISE EXCEPTION 'WA_CONTACT_INVALID'; END IF;
 SELECT l.contact_id INTO chosen FROM crm_leads l
 JOIN staff_users actor ON actor.id=p_actor AND actor.active
 WHERE l.id=p_lead AND (l.assigned_agent_id=p_actor OR EXISTS(
  SELECT 1 FROM staff_roles WHERE staff_user_id=p_actor AND role::text IN ('admin','manager')))
 FOR UPDATE OF l;
 IF chosen IS NULL THEN RAISE EXCEPTION 'WA_CONTACT_SCOPE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM staff_roles WHERE staff_user_id=p_actor AND role::text IN ('admin','manager'))
  AND EXISTS(SELECT 1 FROM crm_leads other WHERE other.contact_id=chosen
    AND other.assigned_agent_id IS DISTINCT FROM p_actor)
 THEN RAISE EXCEPTION 'WA_CONTACT_SCOPE'; END IF;
 SELECT name,email INTO current_name,current_email FROM crm_contacts WHERE id=chosen FOR UPDATE;
 IF (current_name,current_email) IS DISTINCT FROM
  (nullif(btrim(p_name),''),nullif(btrim(p_email),'')) THEN
  UPDATE crm_contacts SET name=nullif(btrim(p_name),''),email=nullif(btrim(p_email),''),
   updated_at=now() WHERE id=chosen;
  INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata)
   VALUES(p_actor,'lead.contact.update','crm_contact',chosen,
    jsonb_build_object('leadId',p_lead,'fields',jsonb_build_array('name','email')));
 END IF;
 contact_id:=chosen; RETURN NEXT;
END $$;
