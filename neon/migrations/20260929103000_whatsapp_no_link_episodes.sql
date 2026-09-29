-- New additive correction: NULL property is never a wildcard.
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
 SELECT array_agg(id) INTO candidates FROM inquiries WHERE conversation_id=m.conversation_id AND source='whatsapp' AND status NOT IN ('closed','resolved','spam') AND ((prop IS NULL AND property_id IS NULL) OR (prop IS NOT NULL AND property_id=prop));
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


-- One customer event may mention several refs. The original single inquiry_id is
-- retained as a compatibility pointer, never the complete reference set.
CREATE TABLE IF NOT EXISTS whatsapp_enquiry_reference_links (
  event_id uuid NOT NULL REFERENCES whatsapp_enquiry_events(id),
  ref_index integer NOT NULL CHECK(ref_index BETWEEN 0 AND 999),
  receipt_id uuid NOT NULL REFERENCES whatsapp_inbound_receipts(id),
  interpretation_id uuid NOT NULL REFERENCES whatsapp_portal_interpretations(id),
  conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id),
  reference_key text NOT NULL CHECK(reference_key ~ '^[a-f0-9]{64}$'),
  source text NOT NULL CHECK(source IN ('28hse','propertyhk')),
  scope_id text,
  external_listing_id text,
  deal_type text CHECK(deal_type IN ('sale','rent')),
  property_id uuid REFERENCES properties(id),
  inquiry_id uuid REFERENCES inquiries(id),
  association_review boolean NOT NULL DEFAULT true,
  resolution jsonb NOT NULL CHECK(jsonb_typeof(resolution)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(event_id,ref_index)
);
CREATE INDEX IF NOT EXISTS wa_enquiry_ref_open_lookup
  ON whatsapp_enquiry_reference_links(conversation_id,reference_key,inquiry_id)
  WHERE inquiry_id IS NOT NULL;

-- This function only records and associates. It cannot request provider routing,
-- send a reply, or notify staff. Those need separate permission and effect gates.
CREATE OR REPLACE FUNCTION wa_associate_no_link(
  p_event uuid,p_receipt uuid,p_interpretation uuid,p_refs jsonb
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE e record; m record; item jsonb; idx integer := 0; picked uuid;
  primary_id uuid; candidates uuid[]; key text; multi boolean;
BEGIN
  IF jsonb_typeof(p_refs)<>'array' OR jsonb_array_length(p_refs) NOT BETWEEN 1 AND 1000
  THEN RAISE EXCEPTION 'WA_PORTAL_REFS_INVALID'; END IF;
  SELECT * INTO e FROM whatsapp_enquiry_events WHERE id=p_event FOR UPDATE;
  IF NOT FOUND OR e.kind<>'customer_message' OR e.origin<>'live_webhook'
     OR e.capture_mode NOT IN ('observe','active') OR e.processing_state='suppressed'
  THEN RETURN NULL; END IF;
  IF e.inquiry_id IS NOT NULL THEN RETURN e.inquiry_id; END IF;
  IF EXISTS(SELECT 1 FROM whatsapp_enquiry_reference_links WHERE event_id=p_event) THEN
    SELECT inquiry_id INTO primary_id FROM whatsapp_enquiry_reference_links
    WHERE event_id=p_event ORDER BY ref_index LIMIT 1;
    RETURN primary_id;
  END IF;
  PERFORM 1 FROM whatsapp_inbound_receipts r
   WHERE r.id=p_receipt AND r.app_id=e.app_id AND r.channel_id=e.channel_id
     AND r.member_id=e.member_id
     AND (r.identity_key=e.external_message_id
       OR e.external_message_id='wa-ambiguous:'||r.id::text);
  IF NOT FOUND THEN RAISE EXCEPTION 'WA_PORTAL_RECEIPT_SCOPE_INVALID'; END IF;
  PERFORM 1 FROM whatsapp_portal_interpretations
    WHERE id=p_interpretation AND receipt_id=p_receipt;
  IF NOT FOUND THEN RAISE EXCEPTION 'WA_PORTAL_INTERPRETATION_REQUIRED'; END IF;
  SELECT * INTO m FROM whatsapp_messages WHERE id=e.message_id;
  IF NOT FOUND OR m.direction::text<>'inbound' OR m.channel_id<>e.channel_id
    OR m.woztell_member_id<>e.member_id THEN RAISE EXCEPTION 'WA_PORTAL_MESSAGE_SCOPE_INVALID'; END IF;
  PERFORM 1 FROM whatsapp_conversations WHERE id=m.conversation_id FOR UPDATE;
  multi:=jsonb_array_length(p_refs)>1;
  FOR item IN SELECT value FROM jsonb_array_elements(p_refs) LOOP
    key:=item->>'referenceKey';
    IF key IS NULL OR key !~ '^[a-f0-9]{64}$'
      OR item->>'source' NOT IN ('28hse','propertyhk')
      OR (item->>'dealType' IS NOT NULL AND item->>'dealType' NOT IN ('sale','rent'))
    THEN RAISE EXCEPTION 'WA_PORTAL_REF_INVALID'; END IF;
    SELECT array_agg(DISTINCT q.id) INTO candidates
      FROM whatsapp_enquiry_reference_links l JOIN inquiries q ON q.id=l.inquiry_id
      WHERE l.conversation_id=m.conversation_id AND l.reference_key=key
        AND q.source='whatsapp' AND q.status NOT IN ('closed','resolved','spam');
    picked:=NULL;
    IF cardinality(candidates)=1 THEN picked:=candidates[1]; END IF;
    IF idx=0 AND picked IS NULL THEN
      INSERT INTO inquiries(source,name,crm_contact_id,conversation_id,intake_message_id,
        property_id,requested_staff_id,entry_point_type,placement_source,attribution_method,
        customer_message_at,webhook_received_at,service_state,association_review,effects_eligible)
      VALUES('whatsapp',(SELECT name FROM crm_contacts WHERE id=m.contact_id),m.contact_id,
        m.conversation_id,m.id,NULLIF(item->>'propertyId','')::uuid,
        NULLIF(item->>'requestedStaffId','')::uuid,'reception',
        CASE WHEN item->>'source'='28hse' THEN '28hse' ELSE 'other' END,
        'explicit_customer_statement',e.occurred_at,e.received_at,'unmeasured',true,false)
      RETURNING id INTO picked;
    END IF;
    INSERT INTO whatsapp_enquiry_reference_links(event_id,ref_index,receipt_id,
      interpretation_id,conversation_id,reference_key,source,scope_id,
      external_listing_id,deal_type,property_id,inquiry_id,association_review,resolution)
    VALUES(p_event,idx,p_receipt,p_interpretation,m.conversation_id,key,
      item->>'source',item->>'scopeId',item->>'externalListingId',item->>'dealType',
      NULLIF(item->>'propertyId','')::uuid,picked,true,item);
    IF idx=0 THEN primary_id:=picked; END IF;
    idx:=idx+1;
  END LOOP;
  INSERT INTO whatsapp_enquiry_messages(message_id,inquiry_id,event_id,association_review)
    VALUES(m.id,primary_id,e.id,true) ON CONFLICT DO NOTHING;
  UPDATE whatsapp_enquiry_events SET inquiry_id=primary_id,association_review=true
    WHERE id=e.id;
  RETURN primary_id;
END $$;

