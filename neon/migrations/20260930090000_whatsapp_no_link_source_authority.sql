-- Preserve the original follow-up function migration. Portal reference labels
-- and MLS authority namespaces differ for 28Hse; recheck the same namespace the
-- resolver verified. All existing capture, ownership and provider guards remain.
CREATE OR REPLACE FUNCTION wa_prepare_no_link_followup(p_event uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE e record; i record; w record; l record; candidate uuid; requested uuid;
  published uuid; reason text; decision text; request_id uuid; prior record;
BEGIN
  SELECT * INTO e FROM whatsapp_enquiry_events WHERE id=p_event FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('decision','review','reason','event_missing'); END IF;
  SELECT d.* INTO prior FROM whatsapp_no_link_effect_decisions d WHERE d.event_id=p_event;
  IF FOUND THEN RETURN jsonb_build_object('decision',prior.decision,'reason',prior.reason,
    'inquiryId',prior.inquiry_id,'staffId',prior.candidate_staff_id); END IF;
  SELECT * INTO l FROM whatsapp_enquiry_reference_links
    WHERE event_id=p_event AND ref_index=0;
  IF NOT FOUND OR e.inquiry_id IS NULL THEN
    RETURN jsonb_build_object('decision','review','reason','association_missing');
  END IF;
  SELECT * INTO i FROM inquiries WHERE id=e.inquiry_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('decision','review','reason','enquiry_missing'); END IF;
  SELECT * INTO w FROM whatsapp_conversations WHERE id=i.conversation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('decision','review','reason','conversation_missing'); END IF;
  reason:=NULL;
  IF e.origin<>'live_webhook' OR e.capture_mode<>'active'
    OR NOT e.effects_eligible OR NOT e.notification_eligible
    OR COALESCE(e.evidence->>'noLinkEffectsEligible','false')<>'true'
    OR e.timing<>'fresh' OR e.identity_quality<>'provider_id'
    OR e.activation_id IS NULL OR NOT EXISTS(
      SELECT 1 FROM whatsapp_enquiry_activations a
      WHERE a.id=e.activation_id AND a.ended_at IS NULL)
  THEN reason:='capture_not_active';
  ELSIF (SELECT count(*) FROM whatsapp_enquiry_reference_links WHERE event_id=p_event)<>1
    OR l.inquiry_id IS DISTINCT FROM i.id OR l.conversation_id IS DISTINCT FROM w.id
    OR e.channel_id IS DISTINCT FROM w.channel_id
    OR i.status IN ('closed','resolved','spam') OR NOT i.association_review
    OR i.enquiry_version>0
    OR l.resolution->>'status' IS DISTINCT FROM 'resolved'
    OR l.resolution->'reasons' IS DISTINCT FROM '[]'::jsonb
    OR l.property_id IS NULL OR l.scope_id IS NULL OR l.external_listing_id IS NULL
    OR l.deal_type IS NULL
  THEN reason:='reference_review';
  END IF;
  requested:=NULLIF(l.resolution->>'requestedStaffId','')::uuid;
  published:=NULLIF(l.resolution->>'publicationOwnerId','')::uuid;
  candidate:=COALESCE(requested,published);
  IF reason IS NULL AND (candidate IS NULL OR (requested IS NOT NULL AND published IS NOT NULL
      AND requested<>published))
  THEN reason:='staff_conflict_or_missing'; END IF;
  IF reason IS NULL AND NOT EXISTS(
    SELECT 1 FROM whatsapp_portal_source_scopes scope
    JOIN mls_source_state source ON source.scope_id=scope.scope_id
      AND source.source=CASE WHEN l.source='28hse' THEN '28hse_agent_540' ELSE 'propertyhk' END
      AND source.external_listing_id=l.external_listing_id
      AND source.deal_type::text=l.deal_type
    JOIN properties p ON p.id=source.property_id AND p.status::text='active'
    WHERE scope.channel_id=e.channel_id AND scope.source=CASE WHEN l.source='28hse' THEN '28hse_agent_540' ELSE 'propertyhk' END
      AND scope.scope_id=l.scope_id AND scope.enabled AND scope.verified_at<=now()
      AND source.property_id=l.property_id AND source.source_status='active'
      AND source.last_accepted_at>=now()-interval '30 days'
      AND p.agent_id=candidate
  ) THEN reason:='publication_stale_or_owner_changed'; END IF;
  IF reason IS NULL AND requested IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM staff_external_references ref
    JOIN staff_users s ON s.id=ref.staff_id AND s.active
    WHERE ref.id=NULLIF(l.resolution->'snapshot'->>'mappingId','')::uuid
      AND ref.mapping_version=NULLIF(l.resolution->'snapshot'->>'mappingVersion','')::integer
      AND ref.staff_id=requested AND ref.valid_from<=now()
      AND (ref.valid_until IS NULL OR ref.valid_until>now())
      AND ref.verified_at<=now()
  ) THEN reason:='staff_mapping_stale'; END IF;
  IF reason IS NULL AND NOT EXISTS(
    SELECT 1 FROM staff_users s JOIN staff_roles role ON role.staff_user_id=s.id
    JOIN whatsapp_staff_channels channel ON channel.staff_id=s.id
    WHERE s.id=candidate AND s.active AND role.role IN ('agent','manager','admin')
      AND channel.channel_id=w.channel_id AND channel.eligible
      AND channel.retired_at IS NULL AND channel.review_enforced
      AND channel.review_basis='provider_verified'
  ) THEN reason:='provider_mapping_unverified'; END IF;
  IF reason IS NULL AND (w.assigned_agent_id IS NOT NULL
      AND (w.assigned_agent_id<>candidate OR w.confirmed_staff_id IS DISTINCT FROM candidate))
    THEN reason:='protected_existing_relationship'; END IF;
  IF reason IS NULL AND EXISTS(SELECT 1 FROM whatsapp_assignment_requests r
        WHERE r.conversation_id=w.id AND r.state IN ('pending','executing','unknown'))
    THEN reason:='assignment_in_flight'; END IF;
  IF reason IS NULL AND w.assigned_agent_id IS NULL
      AND (NOT e.notification_routing_eligible OR w.assignment_lock)
    THEN reason:='routing_not_ready'; END IF;
  IF reason IS NOT NULL THEN
    decision:='review';
    INSERT INTO whatsapp_no_link_effect_decisions(event_id,inquiry_id,decision,reason,candidate_staff_id)
      VALUES(p_event,i.id,decision,reason,candidate);
    RETURN jsonb_build_object('decision',decision,'reason',reason,'inquiryId',i.id,'staffId',candidate);
  END IF;
  UPDATE inquiries SET enquiry_owner_staff_id=candidate,association_review=false,
    provider_thread_review=(w.confirmed_staff_id IS DISTINCT FROM candidate),
    effects_eligible=true,activation_id=e.activation_id,updated_at=now()
    WHERE id=i.id AND association_review AND source='whatsapp';
  IF w.confirmed_staff_id=candidate THEN
    decision:='staff_ready'; reason:='provider_confirmed';
    PERFORM wa_capture_staff_ready(i.id);
  ELSE
    INSERT INTO whatsapp_assignment_requests(conversation_id,desired_staff_id,version,reason)
      VALUES(w.id,candidate,w.assignment_version+1,'verified_no_link_owner') RETURNING id INTO request_id;
    UPDATE whatsapp_conversations SET pending_assignment_id=request_id,
      assignment_version=assignment_version+1 WHERE id=w.id;
    INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key)
      VALUES('woztell.enquiry.assign',1,jsonb_build_object('requestId',request_id),
        'queued',3,now(),'wa.assignment:'||request_id)
      ON CONFLICT(idempotency_key) DO NOTHING;
    decision:='assignment_pending'; reason:='await_provider_readback';
  END IF;
  INSERT INTO whatsapp_no_link_effect_decisions(event_id,inquiry_id,decision,reason,candidate_staff_id)
    VALUES(p_event,i.id,decision,reason,candidate);
  RETURN jsonb_build_object('decision',decision,'reason',reason,'inquiryId',i.id,'staffId',candidate);
END $$;
