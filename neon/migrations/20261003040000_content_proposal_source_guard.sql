ALTER TABLE ai_content_proposals ADD COLUMN source_db_revision text;
ALTER TABLE ai_content_proposals ADD COLUMN requested_auth_user_id text;
ALTER TABLE ai_content_proposals ADD COLUMN knowledge_dependencies jsonb;

CREATE FUNCTION ep_content_source_revision(p_type text,p_id uuid)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE source_row jsonb; group_no text;
BEGIN
  CASE p_type
    WHEN 'listing' THEN
      SELECT to_jsonb(p) INTO source_row FROM properties p WHERE id=p_id;
      SELECT public_listing_no INTO group_no FROM property_public_members WHERE property_id=p_id;
      source_row:=jsonb_build_object('listing',source_row,
        'estate',(SELECT to_jsonb(e) FROM estates e WHERE e.id=(SELECT estate_id FROM properties WHERE id=p_id)),
        'agent',(SELECT to_jsonb(s) FROM staff_users s WHERE s.id=(SELECT agent_id FROM properties WHERE id=p_id)),
        'canonical_group',(SELECT to_jsonb(g) FROM property_public_groups g WHERE g.public_listing_no=group_no),
        'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY property_id) FROM property_public_members m WHERE public_listing_no=group_no),
        'offers',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM properties o JOIN property_public_members m ON m.property_id=o.id WHERE m.public_listing_no=group_no),
        'protected',(SELECT jsonb_agg(to_jsonb(f) ORDER BY f.property_id,f.field_name) FROM property_sync_fields f JOIN property_public_members m ON m.property_id=f.property_id WHERE m.public_listing_no=group_no),
        'source_identity',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.source,s.external_listing_id,s.deal_type) FROM mls_source_state s JOIN property_public_members m ON m.property_id=s.property_id WHERE m.public_listing_no=group_no));
    WHEN 'estate' THEN SELECT to_jsonb(e) INTO source_row FROM estates e WHERE id=p_id;
    WHEN 'article' THEN SELECT to_jsonb(a) INTO source_row FROM articles a WHERE id=p_id;
    WHEN 'faq' THEN SELECT to_jsonb(f) INTO source_row FROM faqs f WHERE id=p_id;
    WHEN 'video' THEN SELECT to_jsonb(v) INTO source_row FROM cms_videos v WHERE id=p_id;
    ELSE RETURN NULL;
  END CASE;
  RETURN md5(jsonb_build_object('policy','content-source-v2','type',p_type,'source',source_row)::text);
END;
$$;

CREATE FUNCTION ep_assert_content_snapshot(p_type text,p_id uuid,p_actor uuid,p_auth text,p_expected text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE source_row jsonb; allowed_all boolean; current_revision text; group_no text;
BEGIN
  PERFORM 1 FROM staff_users WHERE id=p_actor AND active AND auth_user_id=p_auth FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COPILOT_FORBIDDEN'; END IF;
  PERFORM 1 FROM staff_roles WHERE staff_user_id=p_actor AND role IN('admin','manager','agent') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COPILOT_FORBIDDEN'; END IF;
  SELECT EXISTS(SELECT 1 FROM staff_roles WHERE staff_user_id=p_actor AND role IN('admin','manager')) INTO allowed_all;
  IF p_type<>'listing' AND NOT allowed_all THEN RAISE EXCEPTION 'COPILOT_FORBIDDEN'; END IF;
  CASE p_type
    WHEN 'listing' THEN
      SELECT to_jsonb(p) INTO source_row FROM properties p WHERE id=p_id FOR SHARE;
      IF source_row IS NULL OR (NOT allowed_all AND (source_row->>'agent_id' IS DISTINCT FROM p_actor::text OR source_row->>'status'<>'active')) THEN RAISE EXCEPTION 'COPILOT_FORBIDDEN'; END IF;
      SELECT public_listing_no INTO group_no FROM property_public_members WHERE property_id=p_id;
      PERFORM 1 FROM property_public_groups WHERE public_listing_no=group_no FOR UPDATE;
      PERFORM 1 FROM property_public_members WHERE public_listing_no=group_no ORDER BY property_id FOR SHARE;
      PERFORM 1 FROM properties WHERE id IN(SELECT property_id FROM property_public_members WHERE public_listing_no=group_no) ORDER BY id FOR SHARE;
      PERFORM 1 FROM property_sync_fields WHERE property_id IN(SELECT property_id FROM property_public_members WHERE public_listing_no=group_no) ORDER BY property_id,field_name FOR SHARE;
      PERFORM 1 FROM mls_source_state WHERE property_id IN(SELECT property_id FROM property_public_members WHERE public_listing_no=group_no) ORDER BY source,external_listing_id,deal_type FOR SHARE;
      PERFORM 1 FROM estates WHERE id=(SELECT estate_id FROM properties WHERE id=p_id) FOR SHARE;
      PERFORM 1 FROM staff_users WHERE id=(SELECT agent_id FROM properties WHERE id=p_id) FOR SHARE;
    WHEN 'estate' THEN SELECT to_jsonb(e) INTO source_row FROM estates e WHERE id=p_id FOR SHARE;
    WHEN 'article' THEN SELECT to_jsonb(a) INTO source_row FROM articles a WHERE id=p_id FOR SHARE;
    WHEN 'faq' THEN SELECT to_jsonb(f) INTO source_row FROM faqs f WHERE id=p_id FOR SHARE;
    WHEN 'video' THEN SELECT to_jsonb(v) INTO source_row FROM cms_videos v WHERE id=p_id FOR SHARE;
    ELSE RAISE EXCEPTION 'COPILOT_FORBIDDEN';
  END CASE;
  IF source_row IS NULL THEN RAISE EXCEPTION 'COPILOT_FORBIDDEN'; END IF;
  current_revision:=ep_content_source_revision(p_type,p_id);
  IF p_expected IS NOT NULL AND current_revision IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'COPILOT_STALE_PROPOSAL'; END IF;
  RETURN current_revision;
END;
$$;

CREATE FUNCTION ep_assert_content_proposal(p_proposal uuid,p_actor uuid,p_auth text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE proposal_row ai_content_proposals;
BEGIN
  SELECT * INTO proposal_row FROM ai_content_proposals WHERE id=p_proposal AND requested_by=p_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COPILOT_FORBIDDEN'; END IF;
  IF proposal_row.source_db_revision IS NULL OR proposal_row.knowledge_dependencies IS NULL THEN RAISE EXCEPTION 'COPILOT_STALE_PROPOSAL'; END IF;
  IF proposal_row.requested_auth_user_id IS DISTINCT FROM p_auth THEN RAISE EXCEPTION 'COPILOT_FORBIDDEN'; END IF;
  PERFORM ep_assert_content_snapshot(proposal_row.resource_type,proposal_row.resource_id,p_actor,p_auth,proposal_row.source_db_revision);
END;
$$;

CREATE FUNCTION ep_assert_content_dependencies_valid(p_valid boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_valid IS DISTINCT FROM true THEN RAISE EXCEPTION 'COPILOT_STALE_PROPOSAL'; END IF;
END;
$$;
