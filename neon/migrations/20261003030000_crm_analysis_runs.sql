CREATE TABLE crm_ai_analysis_runs (
  id uuid PRIMARY KEY,
  lead_id uuid REFERENCES crm_leads(id) ON DELETE SET NULL,
  actor_staff_id uuid NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  source_fingerprint text NOT NULL,
  prompt_version text NOT NULL,
  schema_version text NOT NULL,
  status text NOT NULL CHECK(status IN('running','completed','stale','denied','cancelled','failed')),
  result_kind text NOT NULL DEFAULT 'failed' CHECK(result_kind IN('model_validated','deterministic','fallback','failed')),
  provider text,
  resolved_model text,
  usage jsonb,
  output jsonb,
  validation_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes'
);
CREATE INDEX crm_ai_runs_lead_latest ON crm_ai_analysis_runs(lead_id,started_at DESC,id DESC);
ALTER TABLE crm_ai_profiles ADD COLUMN analysis_run_id uuid REFERENCES crm_ai_analysis_runs(id);
ALTER TABLE crm_ai_tags ADD COLUMN analysis_run_id uuid REFERENCES crm_ai_analysis_runs(id);

CREATE FUNCTION ep_crm_analysis_source_revision(p_lead uuid,p_channel text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT md5(jsonb_build_object(
    'policy','crm-analysis-v2','lead',to_jsonb(l),'contact',to_jsonb(c),'property',to_jsonb(p),
    'identity_peers',COALESCE((SELECT jsonb_agg(to_jsonb(peer) ORDER BY peer.id) FROM crm_contacts peer
      WHERE peer.id=c.id OR peer.normalized_phone=c.normalized_phone OR peer.whatsapp_member_id=c.whatsapp_member_id),'[]'::jsonb),
    'activities',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM crm_activities a WHERE a.lead_id=l.id),'[]'::jsonb),
    'conversations',COALESCE((SELECT jsonb_agg(to_jsonb(w) || jsonb_build_object('service_window_open',w.channel_id=p_channel AND w.last_inbound_at BETWEEN now()-interval '24 hours' AND now()) ORDER BY w.id)
      FROM whatsapp_conversations w WHERE w.contact_id=c.id),'[]'::jsonb),
    'canonical_group',to_jsonb(g),
    'estate',(SELECT to_jsonb(e) FROM estates e WHERE e.id=p.estate_id),
    'source_identity',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.source,s.external_listing_id,s.deal_type) FROM mls_source_state s JOIN property_public_members sm ON sm.property_id=s.property_id WHERE sm.public_listing_no=m.public_listing_no),'[]'::jsonb),
    'members',COALESCE((SELECT jsonb_agg(to_jsonb(pm) ORDER BY pm.property_id) FROM property_public_members pm WHERE pm.public_listing_no=m.public_listing_no),'[]'::jsonb),
    'offers',COALESCE((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM properties o JOIN property_public_members om ON om.property_id=o.id WHERE om.public_listing_no=m.public_listing_no),'[]'::jsonb),
    'protected',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.property_id,f.field_name) FROM property_sync_fields f JOIN property_public_members fm ON fm.property_id=f.property_id WHERE fm.public_listing_no=m.public_listing_no),'[]'::jsonb)
  )::text)
  FROM crm_leads l LEFT JOIN crm_contacts c ON c.id=l.contact_id LEFT JOIN properties p ON p.id=l.property_id
  LEFT JOIN property_public_members m ON m.property_id=p.id LEFT JOIN property_public_groups g ON g.public_listing_no=m.public_listing_no
  WHERE l.id=p_lead;
$$;

CREATE FUNCTION ep_assert_crm_analysis_snapshot(p_lead uuid,p_actor uuid,p_auth text,p_channel text,p_expected text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE lead_row crm_leads; current_revision text; group_no text; allowed_all boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('crm-ai-lead:'||p_lead::text));
  PERFORM 1 FROM staff_users WHERE id=p_actor AND active AND auth_user_id=p_auth FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_AI_DENIED'; END IF;
  PERFORM 1 FROM staff_roles WHERE staff_user_id=p_actor AND role IN('admin','manager','agent') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_AI_DENIED'; END IF;
  SELECT EXISTS(SELECT 1 FROM staff_roles WHERE staff_user_id=p_actor AND role IN('admin','manager')) INTO allowed_all;
  SELECT * INTO lead_row FROM crm_leads WHERE id=p_lead FOR UPDATE;
  IF NOT FOUND OR (NOT allowed_all AND lead_row.assigned_agent_id IS DISTINCT FROM p_actor) THEN RAISE EXCEPTION 'CRM_AI_DENIED'; END IF;
  PERFORM 1 FROM crm_contacts WHERE id=lead_row.contact_id FOR SHARE;
  PERFORM 1 FROM crm_contacts WHERE normalized_phone=(SELECT normalized_phone FROM crm_contacts WHERE id=lead_row.contact_id)
    OR whatsapp_member_id=(SELECT whatsapp_member_id FROM crm_contacts WHERE id=lead_row.contact_id) ORDER BY id FOR SHARE;
  PERFORM 1 FROM crm_activities WHERE lead_id=p_lead ORDER BY id FOR SHARE;
  PERFORM 1 FROM whatsapp_conversations WHERE contact_id=lead_row.contact_id ORDER BY id FOR SHARE;
  SELECT public_listing_no INTO group_no FROM property_public_members WHERE property_id=lead_row.property_id;
  PERFORM 1 FROM property_public_groups WHERE public_listing_no=group_no FOR UPDATE;
  PERFORM 1 FROM property_public_members WHERE public_listing_no=group_no ORDER BY property_id FOR SHARE;
  PERFORM 1 FROM properties WHERE id=lead_row.property_id OR id IN(SELECT property_id FROM property_public_members WHERE public_listing_no=group_no) ORDER BY id FOR SHARE;
  PERFORM 1 FROM property_sync_fields WHERE property_id IN(SELECT property_id FROM property_public_members WHERE public_listing_no=group_no) ORDER BY property_id,field_name FOR SHARE;
  PERFORM 1 FROM estates WHERE id=(SELECT estate_id FROM properties WHERE id=lead_row.property_id) FOR SHARE;
  PERFORM 1 FROM mls_source_state WHERE property_id IN(SELECT property_id FROM property_public_members WHERE public_listing_no=group_no) ORDER BY source,external_listing_id,deal_type FOR SHARE;
  SELECT ep_crm_analysis_source_revision(p_lead,p_channel) INTO current_revision;
  IF p_expected IS NOT NULL AND current_revision IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'CRM_AI_STALE'; END IF;
  RETURN current_revision;
END;
$$;

CREATE FUNCTION ep_begin_crm_analysis_run(p_run uuid,p_lead uuid,p_actor uuid,p_auth text,p_channel text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE current_revision text; previous_run crm_ai_analysis_runs; new_run crm_ai_analysis_runs;
BEGIN
  current_revision:=ep_assert_crm_analysis_snapshot(p_lead,p_actor,p_auth,p_channel);
  SELECT * INTO previous_run FROM crm_ai_analysis_runs WHERE id=p_run;
  IF FOUND THEN
    IF previous_run.actor_staff_id IS DISTINCT FROM p_actor OR previous_run.lead_id IS DISTINCT FROM p_lead THEN RAISE EXCEPTION 'CRM_AI_DENIED'; END IF;
    IF previous_run.status='running' AND previous_run.expires_at<=now() THEN
      UPDATE crm_ai_analysis_runs SET status='failed',completed_at=now(),validation_code='UNKNOWN_PROVIDER_OUTCOME'
        WHERE id=p_run RETURNING * INTO previous_run;
    END IF;
    RETURN to_jsonb(previous_run) || jsonb_build_object('started',false,'current_source_fingerprint',current_revision);
  END IF;
  UPDATE crm_ai_analysis_runs SET status='cancelled',completed_at=now(),validation_code='SUPERSEDED'
    WHERE lead_id=p_lead AND status='running';
  INSERT INTO crm_ai_analysis_runs(id,lead_id,actor_staff_id,source_fingerprint,prompt_version,schema_version,status)
    VALUES(p_run,p_lead,p_actor,current_revision,'crm-analysis-20261003','crm-analysis-v2','running') RETURNING * INTO new_run;
  RETURN to_jsonb(new_run)||jsonb_build_object('started',true,'current_source_fingerprint',current_revision);
END;
$$;

CREATE FUNCTION ep_assert_crm_analysis_run(p_run uuid,p_lead uuid,p_actor uuid,p_auth text,p_channel text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE run_row crm_ai_analysis_runs;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('crm-ai-lead:'||p_lead::text));
  SELECT * INTO run_row FROM crm_ai_analysis_runs WHERE id=p_run AND lead_id=p_lead AND actor_staff_id=p_actor FOR UPDATE;
  IF NOT FOUND OR run_row.status<>'running' OR run_row.expires_at<=now() THEN RAISE EXCEPTION 'CRM_AI_CANCELLED'; END IF;
  PERFORM ep_assert_crm_analysis_snapshot(p_lead,p_actor,p_auth,p_channel,run_row.source_fingerprint);
END;
$$;

CREATE FUNCTION ep_assert_crm_tag(p_tag uuid,p_actor uuid,p_auth text,p_channel text,p_approve boolean)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE tag_row crm_ai_tags; run_row crm_ai_analysis_runs;
BEGIN
  SELECT * INTO tag_row FROM crm_ai_tags WHERE id=p_tag;
  IF NOT FOUND OR tag_row.lead_id IS NULL THEN RAISE EXCEPTION 'CRM_AI_DENIED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('crm-ai-lead:'||tag_row.lead_id::text));
  SELECT * INTO tag_row FROM crm_ai_tags WHERE id=p_tag FOR UPDATE;
  IF p_approve THEN
    SELECT * INTO run_row FROM crm_ai_analysis_runs WHERE id=tag_row.analysis_run_id AND lead_id=tag_row.lead_id AND status='completed' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_AI_STALE'; END IF;
  END IF;
  PERFORM ep_assert_crm_analysis_snapshot(tag_row.lead_id,p_actor,p_auth,p_channel,CASE WHEN p_approve THEN run_row.source_fingerprint ELSE NULL END);
END;
$$;
