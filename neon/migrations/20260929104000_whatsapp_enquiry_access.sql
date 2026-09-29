-- Query responsibility is separate from the provider's whole-thread assignee.
ALTER TABLE inquiries
  ADD COLUMN IF NOT EXISTS enquiry_owner_staff_id uuid REFERENCES staff_users(id),
  ADD COLUMN IF NOT EXISTS enquiry_resolution jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(enquiry_resolution)='object'),
  ADD COLUMN IF NOT EXISTS enquiry_version bigint NOT NULL DEFAULT 0 CHECK(enquiry_version>=0),
  ADD COLUMN IF NOT EXISTS provider_thread_review boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS whatsapp_enquiry_revisions (
  inquiry_id uuid NOT NULL REFERENCES inquiries(id),
  version bigint NOT NULL CHECK(version>0),
  actor_id uuid NOT NULL REFERENCES staff_users(id),
  reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 300),
  previous_value jsonb NOT NULL CHECK(jsonb_typeof(previous_value)='object'),
  next_value jsonb NOT NULL CHECK(jsonb_typeof(next_value)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(inquiry_id,version)
);
CREATE OR REPLACE FUNCTION wa_enquiry_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'WA_ENQUIRY_REVISION_IMMUTABLE'; END $$;
DROP TRIGGER IF EXISTS wa_enquiry_revision_no_change ON whatsapp_enquiry_revisions;
CREATE TRIGGER wa_enquiry_revision_no_change BEFORE UPDATE OR DELETE
 ON whatsapp_enquiry_revisions FOR EACH ROW EXECUTE FUNCTION wa_enquiry_revision_immutable();

-- Every read path can reuse this DB predicate. Caller identity is the verified
-- staff user id from server auth, never a client-supplied role or branch label.
CREATE OR REPLACE FUNCTION wa_can_read_enquiry(p_actor uuid,p_inquiry uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((
   SELECT a.active AND (
     EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role::text='admin')
     OR (EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role::text='manager')
       AND a.branch_id IS NOT NULL
       AND a.branch_id=COALESCE(owner.branch_id,assignee.branch_id))
     OR (EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role::text='agent')
       AND (i.enquiry_owner_staff_id=a.id OR c.assigned_agent_id=a.id))
   )
   FROM inquiries i JOIN whatsapp_conversations c ON c.id=i.conversation_id
   JOIN staff_users a ON a.id=p_actor
   LEFT JOIN staff_users owner ON owner.id=i.enquiry_owner_staff_id
   LEFT JOIN staff_users assignee ON assignee.id=c.assigned_agent_id
   WHERE i.id=p_inquiry AND i.source='whatsapp'
 ),false)
$$;
CREATE OR REPLACE FUNCTION wa_can_correct_enquiry(p_actor uuid,p_inquiry uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((
   SELECT a.active AND (
     EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role::text='admin')
     OR (EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role::text='manager')
       AND a.branch_id IS NOT NULL
       AND a.branch_id=COALESCE(owner.branch_id,assignee.branch_id))
   )
   FROM inquiries i JOIN whatsapp_conversations c ON c.id=i.conversation_id
   JOIN staff_users a ON a.id=p_actor
   LEFT JOIN staff_users owner ON owner.id=i.enquiry_owner_staff_id
   LEFT JOIN staff_users assignee ON assignee.id=c.assigned_agent_id
   WHERE i.id=p_inquiry AND i.source='whatsapp'
 ),false)
$$;
CREATE OR REPLACE FUNCTION wa_can_read_conversation(p_actor uuid,p_conversation uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((
   SELECT a.active AND (
     EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role::text='admin')
     OR (EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role::text='manager')
       AND a.branch_id IS NOT NULL AND a.branch_id=assignee.branch_id)
     OR (EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role::text='agent')
       AND c.assigned_agent_id=a.id)
   )
   FROM whatsapp_conversations c JOIN staff_users a ON a.id=p_actor
   LEFT JOIN staff_users assignee ON assignee.id=c.assigned_agent_id
   WHERE c.id=p_conversation
 ),false)
$$;


-- One DB transaction authorizes, compares version, rechecks current authority,
-- writes only this enquiry, and appends an immutable revision. No provider action.
CREATE OR REPLACE FUNCTION wa_correct_enquiry(
  p_actor uuid,p_inquiry uuid,p_expected bigint,p_change jsonb,p_reason text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE current_row record; conv record; actor_row record; next_owner uuid;
  next_resolution jsonb; next_property uuid; next_requested uuid;
  mapping_id uuid; selected_mapping_version integer; needs_review boolean;
  previous_value jsonb; next_value jsonb; changed record;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 3 AND 300
    OR jsonb_typeof(p_change)<>'object' OR p_change='{}'::jsonb
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_change) AS key
      WHERE key NOT IN ('propertyId','requestedStaffId','ownerStaffId'))
  THEN RAISE EXCEPTION 'WA_ENQUIRY_CORRECTION_INVALID'; END IF;
  SELECT * INTO current_row FROM inquiries WHERE id=p_inquiry AND source='whatsapp' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WA_ENQUIRY_NOT_FOUND'; END IF;
  IF NOT wa_can_correct_enquiry(p_actor,p_inquiry)
  THEN RAISE EXCEPTION 'WA_ENQUIRY_FORBIDDEN'; END IF;
  IF current_row.enquiry_version<>p_expected
  THEN RAISE EXCEPTION 'WA_ENQUIRY_VERSION_STALE'; END IF;
  SELECT * INTO actor_row FROM staff_users WHERE id=p_actor AND active;
  SELECT * INTO conv FROM whatsapp_conversations WHERE id=current_row.conversation_id FOR UPDATE;
  next_owner:=current_row.enquiry_owner_staff_id;
  next_resolution:=current_row.enquiry_resolution;
  IF p_change ? 'ownerStaffId' THEN
    next_owner:=NULLIF(p_change->>'ownerStaffId','')::uuid;
    IF next_owner IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM staff_users s WHERE s.id=next_owner AND s.active
       AND (EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=p_actor AND r.role::text='admin')
         OR (actor_row.branch_id IS NOT NULL AND s.branch_id=actor_row.branch_id))
    ) THEN RAISE EXCEPTION 'WA_ENQUIRY_OWNER_UNAVAILABLE'; END IF;
  END IF;
  IF p_change ? 'propertyId' THEN
    next_property:=NULLIF(p_change->>'propertyId','')::uuid;
    IF next_property IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM whatsapp_enquiry_reference_links l
      JOIN mls_source_state s
        ON s.source=CASE WHEN l.source='28hse' THEN '28hse_agent_540' ELSE 'propertyhk' END
       AND s.scope_id=l.scope_id AND s.external_listing_id=l.external_listing_id
       AND s.deal_type::text=l.deal_type
      JOIN properties p ON p.id=s.property_id AND p.status::text='active'
      WHERE l.inquiry_id=p_inquiry AND s.property_id=next_property
        AND s.source_status='active' AND s.last_accepted_at>=now()-interval '30 days'
    ) THEN RAISE EXCEPTION 'WA_ENQUIRY_PUBLICATION_STALE'; END IF;
    next_resolution:=jsonb_set(next_resolution,'{propertyId}',p_change->'propertyId',true);
  END IF;
  IF p_change ? 'requestedStaffId' THEN
    next_requested:=NULLIF(p_change->>'requestedStaffId','')::uuid;
    IF next_requested IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM staff_users s WHERE s.id=next_requested AND s.active
    ) THEN RAISE EXCEPTION 'WA_ENQUIRY_REQUESTED_STAFF_UNAVAILABLE'; END IF;
    SELECT NULLIF(pi.resolution->(l.ref_index)->'snapshot'->>'mappingId','')::uuid,
           NULLIF(pi.resolution->(l.ref_index)->'snapshot'->>'mappingVersion','')::integer
      INTO mapping_id,selected_mapping_version
      FROM whatsapp_enquiry_reference_links l
      JOIN whatsapp_portal_interpretations pi ON pi.id=l.interpretation_id
      WHERE l.inquiry_id=p_inquiry AND l.ref_index=0
      ORDER BY l.created_at DESC LIMIT 1;
    IF mapping_id IS NOT NULL AND next_requested IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM staff_external_references r JOIN staff_users s ON s.id=r.staff_id AND s.active
      WHERE r.id=mapping_id AND r.mapping_version=selected_mapping_version
        AND r.staff_id=next_requested AND r.valid_from<=now()
        AND (r.valid_until IS NULL OR r.valid_until>now()) AND r.verified_at<=now()
    ) THEN RAISE EXCEPTION 'WA_ENQUIRY_STAFF_MAPPING_STALE'; END IF;
    next_resolution:=jsonb_set(next_resolution,'{requestedStaffId}',p_change->'requestedStaffId',true);
  END IF;
  next_property:=CASE WHEN next_resolution ? 'propertyId'
    THEN NULLIF(next_resolution->>'propertyId','')::uuid ELSE current_row.property_id END;
  next_requested:=CASE WHEN next_resolution ? 'requestedStaffId'
    THEN NULLIF(next_resolution->>'requestedStaffId','')::uuid ELSE current_row.requested_staff_id END;
  -- Recheck even when the command only changes owner: previously selected
  -- publication and staff authority may have expired since interpretation.
  IF next_property IS NOT NULL
    AND EXISTS(SELECT 1 FROM whatsapp_enquiry_reference_links WHERE inquiry_id=p_inquiry)
    AND NOT EXISTS(
      SELECT 1 FROM whatsapp_enquiry_reference_links l
      JOIN mls_source_state s
        ON s.source=CASE WHEN l.source='28hse' THEN '28hse_agent_540' ELSE 'propertyhk' END
       AND s.scope_id=l.scope_id AND s.external_listing_id=l.external_listing_id
       AND s.deal_type::text=l.deal_type
      JOIN properties p ON p.id=s.property_id AND p.status::text='active'
      WHERE l.inquiry_id=p_inquiry AND s.property_id=next_property
        AND s.source_status='active' AND s.last_accepted_at>=now()-interval '30 days'
    ) THEN RAISE EXCEPTION 'WA_ENQUIRY_PUBLICATION_STALE'; END IF;
  SELECT NULLIF(pi.resolution->(l.ref_index)->'snapshot'->>'mappingId','')::uuid,
         NULLIF(pi.resolution->(l.ref_index)->'snapshot'->>'mappingVersion','')::integer
    INTO mapping_id,selected_mapping_version
    FROM whatsapp_enquiry_reference_links l
    JOIN whatsapp_portal_interpretations pi ON pi.id=l.interpretation_id
    WHERE l.inquiry_id=p_inquiry AND l.ref_index=0
    ORDER BY l.created_at DESC LIMIT 1;
  IF mapping_id IS NOT NULL AND next_requested IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM staff_external_references r JOIN staff_users s ON s.id=r.staff_id AND s.active
    WHERE r.id=mapping_id AND r.mapping_version=selected_mapping_version
      AND r.staff_id=next_requested AND r.valid_from<=now()
      AND (r.valid_until IS NULL OR r.valid_until>now()) AND r.verified_at<=now()
  ) THEN RAISE EXCEPTION 'WA_ENQUIRY_STAFF_MAPPING_STALE'; END IF;
  needs_review:=next_owner IS NULL OR conv.confirmed_staff_id IS DISTINCT FROM next_owner
    OR next_property IS NULL OR (next_requested IS NOT NULL AND next_requested<>next_owner)
    OR EXISTS(SELECT 1 FROM whatsapp_enquiry_reference_links l
      WHERE l.inquiry_id=p_inquiry AND EXISTS(
        SELECT 1 FROM whatsapp_enquiry_reference_links other
        WHERE other.event_id=l.event_id AND other.ref_index<>l.ref_index));
  previous_value:=jsonb_build_object('propertyId',current_row.property_id,
    'requestedStaffId',current_row.requested_staff_id,
    'ownerStaffId',current_row.enquiry_owner_staff_id,
    'resolution',current_row.enquiry_resolution,
    'providerThreadReview',current_row.provider_thread_review);
  UPDATE inquiries SET enquiry_owner_staff_id=next_owner,
      enquiry_resolution=next_resolution,enquiry_version=enquiry_version+1,
      provider_thread_review=(next_owner IS NULL OR conv.confirmed_staff_id IS DISTINCT FROM next_owner),
      association_review=needs_review,updated_at=now()
    WHERE id=p_inquiry AND enquiry_version=p_expected
    RETURNING id,enquiry_version,enquiry_owner_staff_id,enquiry_resolution,
      provider_thread_review,association_review INTO changed;
  IF NOT FOUND THEN RAISE EXCEPTION 'WA_ENQUIRY_VERSION_STALE'; END IF;
  next_value:=jsonb_build_object('ownerStaffId',changed.enquiry_owner_staff_id,
    'resolution',changed.enquiry_resolution,
    'providerThreadReview',changed.provider_thread_review,
    'associationReview',changed.association_review);
  INSERT INTO whatsapp_enquiry_revisions(inquiry_id,version,actor_id,reason,previous_value,next_value)
    VALUES(p_inquiry,changed.enquiry_version,p_actor,trim(p_reason),previous_value,next_value);
  RETURN jsonb_build_object('inquiryId',changed.id,'version',changed.enquiry_version,
    'ownerStaffId',changed.enquiry_owner_staff_id,'resolution',changed.enquiry_resolution,
    'providerThreadReview',changed.provider_thread_review,
    'associationReview',changed.association_review);
END $$;
