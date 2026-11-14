-- A reviewed source representative wins over other imports even when its source
-- does not supply an update date. Never manufacture source_updated_at to rank it.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS source_authority TEXT
  CHECK (source_authority IS NULL OR source_authority = '28hse');
COMMENT ON COLUMN properties.source_authority IS
  'Explicit approved source representative; set only by audited source-authority reconciliation.';

-- Keep staff handover and admin edits on the same current offering as public reads.
-- Complete latest definitions retain the native V2 ownership, authorization,
-- optimistic-version, audit, identity and reviewed-withdrawal behavior.
CREATE OR REPLACE FUNCTION admin_property_protect_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_no text; v_patch jsonb; v_raw jsonb; v_canonical text;
BEGIN
 IF current_setting('app.admin_property_write',true)='on' THEN RETURN NEW; END IF;
 v_canonical := NULLIF(upper(regexp_replace(trim(NEW.canonical_property_no),'\s+','','g')),'');
 -- Corrected canonical identity targets the new group, never leaks old overrides.
 IF TG_OP='UPDATE' AND NEW.canonical_property_no IS NOT DISTINCT FROM OLD.canonical_property_no THEN
   SELECT public_listing_no INTO v_no FROM property_public_members WHERE property_id=NEW.id;
 END IF;
 IF NEW.ingestion_identity_policy = 'no-hermes-v2' THEN
   -- V2 source identity corrections do not move issued membership or override ownership.
   IF TG_OP='UPDATE' THEN
     SELECT public_listing_no INTO v_no FROM property_public_members WHERE property_id=NEW.id;
   END IF;
   v_no := coalesce(v_no, NEW.listing_no);
 ELSIF v_no IS NULL THEN
   SELECT public_listing_no INTO v_no FROM property_public_groups WHERE canonical_property_no=v_canonical
   ORDER BY (public_listing_no=v_canonical) DESC,created_at,public_listing_no LIMIT 1;
 END IF;
 IF v_no IS NULL THEN v_no:=NEW.listing_no; END IF;
 -- Staff lifecycle handover is an explicit application boundary, never inferred
 -- from a source agent change. Its statement clears this transaction-local flag.
 IF TG_OP='UPDATE' AND NEW.agent_id IS DISTINCT FROM OLD.agent_id
    AND current_setting('app.staff_property_handover',true)=NEW.agent_id::text THEN
   IF NEW.id=(SELECT p.id FROM properties p JOIN property_public_members m ON m.property_id=p.id
     WHERE m.public_listing_no=v_no AND p.deal_type=NEW.deal_type
     ORDER BY CASE WHEN p.source_authority = '28hse' THEN 0 ELSE 1 END, p.source_updated_at DESC NULLS LAST,p.last_seen_at DESC NULLS LAST,
       p.updated_at DESC NULLS LAST,p.created_at DESC,p.id ASC LIMIT 1) THEN
     INSERT INTO admin_property_overrides(property_no) VALUES(v_no) ON CONFLICT(property_no) DO NOTHING;
     UPDATE admin_property_overrides SET
       sale=CASE WHEN NEW.deal_type::text='sale' THEN sale||jsonb_build_object('agent_id',NEW.agent_id) ELSE sale END,
       rent=CASE WHEN NEW.deal_type::text='rent' THEN rent||jsonb_build_object('agent_id',NEW.agent_id) ELSE rent END,
       revision=revision+1,updated_at=clock_timestamp() WHERE property_no=v_no;
   END IF;
   RETURN NEW;
 END IF;
 SELECT shared || CASE NEW.deal_type::text WHEN 'sale' THEN sale WHEN 'rent' THEN rent ELSE '{}'::jsonb END
 INTO v_patch FROM admin_property_overrides WHERE property_no=v_no;
 IF v_patch IS NULL OR v_patch='{}'::jsonb THEN RETURN NEW; END IF;
 v_raw:=to_jsonb(NEW);
 INSERT INTO admin_property_source_snapshots(property_no,property_id,operation,payload) VALUES(v_no,NEW.id,TG_OP,v_raw);
 -- Defense in depth: even malformed directly-written override JSON cannot change identity/source keys.
 SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO v_patch FROM jsonb_each(v_patch)
 WHERE key=ANY(ARRAY['title_zh','title_en','estate_id','district_slug','address','saleable_area','bedrooms','bathrooms','floor','description','images','seo_title','seo_description','video_url','price','rent','status','agent_id']);
 NEW:=jsonb_populate_record(NEW,v_patch);
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION admin_property_manage(p_no text,p_expected text,p_scope text,p_payload jsonb,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE
 v_manager boolean; v_agent boolean; v_ids uuid[]; v_all_ids uuid[]; v_target uuid;
 v_patch jsonb; v_effective jsonb; v_deal_patch jsonb; v_key text; v_value jsonb; v_before jsonb; v_after jsonb;
 v_fields text; v_template properties%ROWTYPE; v_new properties%ROWTYPE;
 v_old_setting text; v_canonical text;
BEGIN
 IF p_scope IS NULL OR p_scope NOT IN ('shared','sale','rent','all') OR p_no IS NULL OR p_expected IS NULL OR
    jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload='{}'::jsonb THEN RAISE EXCEPTION 'INVALID_PROPERTY_PATCH'; END IF;
 FOR v_key,v_value IN SELECT key,value FROM jsonb_each(p_payload) LOOP
   IF NOT (v_key=ANY(CASE p_scope WHEN 'shared' THEN ARRAY['title_zh','title_en','estate_id','district_slug','address','saleable_area','bedrooms','bathrooms','floor','description','images','seo_title','seo_description','video_url']
     WHEN 'sale' THEN ARRAY['price','status','description','agentId'] WHEN 'rent' THEN ARRAY['rent','status','description','agentId'] ELSE ARRAY['status'] END)) THEN RAISE EXCEPTION 'INVALID_PROPERTY_PATCH'; END IF;
   IF v_key IN ('price','rent','saleable_area','bedrooms','bathrooms') THEN
     IF v_value <> 'null'::jsonb AND (jsonb_typeof(v_value)<>'number' OR (v_value::text)::numeric<0) THEN RAISE EXCEPTION 'INVALID_PROPERTY_PATCH'; END IF;
     IF v_key IN ('saleable_area','bedrooms','bathrooms') AND v_value<>'null'::jsonb AND (v_value::text)::numeric<>trunc((v_value::text)::numeric) THEN RAISE EXCEPTION 'INVALID_PROPERTY_PATCH'; END IF;
   ELSIF v_key='images' THEN
     IF jsonb_typeof(v_value)<>'array' THEN RAISE EXCEPTION 'INVALID_PROPERTY_PATCH'; END IF;
     IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_value) x WHERE jsonb_typeof(x)<>'string') THEN RAISE EXCEPTION 'INVALID_PROPERTY_PATCH'; END IF;
   ELSE
     IF v_value<>'null'::jsonb AND jsonb_typeof(v_value)<>'string' THEN RAISE EXCEPTION 'INVALID_PROPERTY_PATCH'; END IF;
     IF v_key IN ('title_zh','district_slug','status') AND (v_value='null'::jsonb OR trim(v_value#>>'{}')='') THEN RAISE EXCEPTION 'INVALID_PROPERTY_PATCH'; END IF;
     IF v_key IN ('estate_id','agentId') AND v_value<>'null'::jsonb AND (v_value#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'INVALID_PROPERTY_PATCH'; END IF;
   END IF;
 END LOOP;
 IF p_payload ? 'status' AND NOT ((p_payload->>'status')=ANY(CASE p_scope WHEN 'sale' THEN ARRAY['draft','active','sold','offline','inactive'] WHEN 'rent' THEN ARRAY['draft','active','rented','offline','inactive'] ELSE ARRAY['offline','inactive'] END)) THEN RAISE EXCEPTION 'INVALID_PROPERTY_PATCH'; END IF;
 LOCK TABLE properties IN SHARE ROW EXCLUSIVE MODE;
 SELECT coalesce(bool_or(r.role::text IN ('admin','manager')),false),coalesce(bool_or(r.role::text='agent'),false)
 INTO v_manager,v_agent FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=p_actor AND s.active;
 IF NOT (v_manager OR v_agent) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM 1 FROM property_public_groups WHERE public_listing_no=p_no FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PROPERTY_NOT_FOUND'; END IF;
 PERFORM p.id FROM properties p JOIN property_public_members m ON m.property_id=p.id WHERE m.public_listing_no=p_no ORDER BY p.id FOR UPDATE OF p;
 SELECT array_agg(id ORDER BY id) INTO v_all_ids FROM (
  SELECT DISTINCT ON (p.deal_type) p.id FROM properties p JOIN property_public_members m ON m.property_id=p.id
  WHERE m.public_listing_no=p_no ORDER BY p.deal_type,CASE WHEN p.source_authority = '28hse' THEN 0 ELSE 1 END, p.source_updated_at DESC NULLS LAST,p.last_seen_at DESC NULLS LAST,p.updated_at DESC NULLS LAST,p.created_at DESC,p.id ASC
 ) ranked;
 IF v_all_ids IS NULL THEN RAISE EXCEPTION 'PROPERTY_NOT_FOUND'; END IF;
 IF p_scope IN ('shared','all') THEN v_ids:=v_all_ids;
 ELSE SELECT array_agg(id) INTO v_ids FROM properties WHERE id=ANY(v_all_ids) AND deal_type::text=p_scope; END IF;
 -- Missing-offer creation requires ownership of every current offering.
 IF NOT v_manager AND EXISTS(SELECT 1 FROM properties WHERE id=ANY(coalesce(v_ids,v_all_ids)) AND agent_id IS DISTINCT FROM p_actor) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF NOT v_manager AND p_payload ? 'agentId' AND (p_payload->>'agentId') IS DISTINCT FROM p_actor::text THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_payload ? 'agentId' AND p_payload->>'agentId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM staff_users WHERE id=(p_payload->>'agentId')::uuid AND active) THEN RAISE EXCEPTION 'INVALID_PROPERTY_AGENT'; END IF;
 IF admin_property_group_version(p_no) IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'ADMIN_PROPERTY_CONFLICT'; END IF;
 v_patch:=p_payload;
 IF v_patch ? 'agentId' THEN v_patch:=(v_patch-'agentId') || jsonb_build_object('agent_id',v_patch->'agentId'); END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb) INTO v_before FROM properties p WHERE id=ANY(coalesce(v_ids,ARRAY[]::uuid[]));
 INSERT INTO admin_property_source_snapshots(property_no,property_id,operation,payload)
 SELECT p_no,p.id,'ADMIN_BEFORE',to_jsonb(p) FROM properties p WHERE id=ANY(coalesce(v_ids,ARRAY[]::uuid[]));
 INSERT INTO admin_property_overrides(property_no,updated_by) VALUES(p_no,p_actor) ON CONFLICT(property_no) DO NOTHING;
 UPDATE admin_property_overrides SET
 shared=CASE WHEN p_scope='shared' THEN shared||v_patch ELSE shared END,
 sale=CASE WHEN p_scope IN ('sale','all') THEN sale||v_patch ELSE sale END,
 rent=CASE WHEN p_scope IN ('rent','all') THEN rent||v_patch ELSE rent END,
 revision=revision+1,updated_by=p_actor,updated_at=clock_timestamp() WHERE property_no=p_no;
 v_old_setting:=current_setting('app.admin_property_write',true);
 PERFORM set_config('app.admin_property_write','on',true);
 IF v_ids IS NULL AND p_scope IN ('sale','rent') THEN
   SELECT * INTO v_template FROM properties WHERE id=ANY(v_all_ids) ORDER BY id LIMIT 1;
   -- Manual rows can lack a canonical number. Persist the existing issued group
   -- as the new offer's canonical authority; transient membership alone would
   -- split again when physical-field updates invoke identity revalidation.
   UPDATE property_public_groups SET canonical_property_no=coalesce(canonical_property_no,upper(regexp_replace(trim(p_no),'\s+','','g'))),updated_at=clock_timestamp()
     WHERE public_listing_no=p_no RETURNING canonical_property_no INTO v_canonical;
   -- Explicit column list deliberately excludes external source IDs, hashes and sync ownership.
   INSERT INTO properties(listing_no,canonical_property_no,title_zh,title_en,deal_type,estate_id,district_slug,address,saleable_area,bedrooms,bathrooms,floor,description,images,seo_title,seo_description,video_url,agent_id,status)
   VALUES('ADMIN-'||gen_random_uuid()::text,v_canonical,v_template.title_zh,v_template.title_en,p_scope::deal_type,v_template.estate_id,v_template.district_slug,v_template.address,v_template.saleable_area,v_template.bedrooms,v_template.bathrooms,v_template.floor,v_template.description,v_template.images,v_template.seo_title,v_template.seo_description,v_template.video_url,CASE WHEN v_manager THEN v_template.agent_id ELSE p_actor END,'draft') RETURNING id INTO v_target;
   -- An unlinked manual group retains its issued identity on adding its other deal.
   UPDATE property_public_members SET public_listing_no=p_no WHERE property_id=v_target;
   v_ids:=ARRAY[v_target];
 END IF;
 SELECT string_agg(format('%I = v.%I',key,key),',') INTO v_fields FROM jsonb_each(v_patch);
 FOREACH v_target IN ARRAY v_ids LOOP
   v_effective:=v_patch;
   IF p_scope='shared' AND v_patch ? 'description' THEN
     SELECT CASE p.deal_type::text WHEN 'sale' THEN o.sale ELSE o.rent END INTO v_deal_patch
       FROM properties p JOIN admin_property_overrides o ON o.property_no=p_no WHERE p.id=v_target;
     IF v_deal_patch ? 'description' THEN v_effective:=v_effective || jsonb_build_object('description',v_deal_patch->'description'); END IF;
   END IF;
   EXECUTE format('UPDATE properties SET %s,updated_at=clock_timestamp() FROM jsonb_populate_record(NULL::properties,$1) v WHERE properties.id=$2',v_fields) USING v_effective,v_target;
 END LOOP;
 PERFORM set_config('app.admin_property_write',coalesce(v_old_setting,''),true);
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO v_after FROM properties p WHERE id=ANY(v_ids);
 INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata)
 VALUES(p_actor,'property.manage','property_group',v_ids[1],jsonb_build_object('propertyNo',p_no,'scope',p_scope,'patch',p_payload,'before',v_before,'after',v_after,'expectedVersion',p_expected));
 RETURN jsonb_build_object('ok',true);
END $$;

-- The mapping-guard migration renamed this implementation to _v1. Replace only
-- its offering selector; retain the public wrapper and all mapping/role locks.
CREATE OR REPLACE FUNCTION wa_commit_link_batch_chunk_v1(
 p_actor uuid,p_batch uuid,p_chunk uuid,p_token_hash text,p_chunk_hash text,
 p_rows jsonb,p_channel text,p_codes jsonb
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
 snap whatsapp_link_batch_previews%ROWTYPE;
 previous whatsapp_link_batch_operations%ROWTYPE;
 r jsonb; d jsonb; rk uuid; pk text; offer_id uuid; source_id uuid;
 wanted_staff uuid; ref_staff uuid; effective_staff uuid; ref_id uuid; reserved uuid; candidate uuid;
 candidates integer; reason text; blocked boolean := false; output jsonb := '[]'::jsonb;
 created uuid; result_code text; result_version integer; item jsonb; code text;
BEGIN
 IF jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 50 THEN
   RAISE EXCEPTION 'WA_LINK_BATCH_LIMIT';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_batch::text,0));
 SELECT * INTO previous FROM whatsapp_link_batch_operations WHERE batch_id=p_batch AND chunk_id=p_chunk;
 IF FOUND THEN
   IF previous.actor_staff_id<>p_actor OR previous.payload_hash<>p_chunk_hash THEN
     RAISE EXCEPTION 'BATCH_PAYLOAD_CONFLICT';
   END IF;
   RETURN jsonb_build_object('batchId',p_batch,'chunkId',p_chunk,'state',previous.state,'rows',previous.result);
 END IF;
 SELECT * INTO snap FROM whatsapp_link_batch_previews WHERE batch_id=p_batch FOR UPDATE;
 IF NOT FOUND OR snap.actor_staff_id<>p_actor OR snap.token_hash<>p_token_hash OR snap.channel_id<>p_channel OR snap.expires_at<=now() THEN
   RAISE EXCEPTION 'BATCH_PREVIEW_EXPIRED_OR_UNAUTHORIZED';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM staff_users s JOIN staff_roles sr ON sr.staff_user_id=s.id
   WHERE s.id=p_actor AND s.active AND sr.role IN ('admin','manager')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) x GROUP BY x->>'rowKey' HAVING count(*)>1) THEN
   RAISE EXCEPTION 'WA_LINK_DUPLICATE_ROW_KEY';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) x GROUP BY x->>'placementKey' HAVING count(*)>1) THEN
   RAISE EXCEPTION 'WA_LINK_DUPLICATE_PLACEMENT';
 END IF;
 -- Lock all placements in a stable order. Competing actors cannot each mint the same placement.
 FOR pk IN SELECT DISTINCT x->>'placementKey' FROM jsonb_array_elements(p_rows) x ORDER BY 1 LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended(pk,0));
 END LOOP;
 FOR r IN SELECT x FROM jsonb_array_elements(p_rows) x LOOP
   rk := (r->>'rowKey')::uuid; pk := r->>'placementKey'; d := r->'input'; reason := NULL;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snap.rows) x WHERE x->>'rowKey'=rk::text AND x=r) THEN
     RAISE EXCEPTION 'BATCH_PAYLOAD_CONFLICT';
   END IF;
   IF EXISTS(SELECT 1 FROM whatsapp_link_batch_rows x WHERE x.batch_id=p_batch AND x.row_key=rk) THEN
     reason := 'BATCH_ROW_ALREADY_COMMITTED';
   END IF;
   IF d->>'enabled'<>'true' OR d->>'placementVerified'<>'true' THEN reason := 'PLACEMENT_UNVERIFIED'; END IF;
   wanted_staff := NULLIF(d->>'requestedStaffId','')::uuid;
   ref_id := NULLIF(d->>'referenceMappingId','')::uuid;
   source_id := NULLIF(d->>'propertyId','')::uuid;
   IF source_id IS NOT NULL THEN
     SELECT p.id INTO offer_id FROM property_public_members pm JOIN properties p ON p.id=pm.property_id
      WHERE pm.public_listing_no=d->>'publicListingNo' AND p.deal_type::text=d->>'dealType'
      ORDER BY CASE WHEN p.source_authority = '28hse' THEN 0 ELSE 1 END, p.source_updated_at DESC NULLS LAST,p.last_seen_at DESC NULLS LAST,
        p.updated_at DESC NULLS LAST,p.created_at DESC,p.id ASC LIMIT 1;
     IF offer_id IS DISTINCT FROM source_id OR NOT EXISTS(SELECT 1 FROM properties p WHERE p.id=offer_id AND p.status::text='active')
       THEN reason := 'WA_LINK_PUBLIC_OFFER_UNAVAILABLE'; END IF;
   ELSIF d->>'entryPointType'='sales' THEN reason := 'WA_LINK_OFFER_CONTEXT_REQUIRED'; END IF;
   ref_staff := NULL;
   IF ref_id IS NOT NULL THEN
     SELECT sr.staff_id INTO ref_staff FROM staff_external_references sr WHERE sr.id=ref_id
       AND sr.valid_from<=now() AND (sr.valid_until IS NULL OR sr.valid_until>now()) AND sr.verified_at<=now();
     IF ref_staff IS NULL OR (wanted_staff IS NOT NULL AND ref_staff<>wanted_staff)
       THEN reason := 'STAFF_REFERENCE_CONFLICT_OR_EXPIRED'; END IF;
   END IF;
   effective_staff := COALESCE(wanted_staff,ref_staff);
   IF effective_staff IS NOT NULL AND NOT EXISTS(
     SELECT 1 FROM staff_users s JOIN staff_roles sr ON sr.staff_user_id=s.id
      JOIN whatsapp_staff_channels m ON m.staff_id=s.id AND m.channel_id=p_channel
      WHERE s.id=effective_staff AND s.active AND sr.role IN ('admin','manager','agent')
       AND m.eligible AND m.retired_at IS NULL AND m.verified_at IS NOT NULL AND m.verification_ref IS NOT NULL
   ) THEN reason := 'WA_LINK_STAFF_NOT_READY'; END IF;
   SELECT x.link_id INTO reserved FROM whatsapp_tracking_link_placements x WHERE x.placement_key=pk;
   SELECT count(*)::integer,min(l.id::text)::uuid INTO candidates,candidate
     FROM whatsapp_tracking_links l JOIN whatsapp_tracking_link_versions v ON v.link_id=l.id AND v.version=l.current_version
     WHERE v.enabled AND v.placement_verified_at IS NOT NULL AND v.channel_id=p_channel
      AND v.placement_source=d->>'placementSource' AND v.entry_point_type=d->>'entryPointType'
      AND v.public_listing_no IS NOT DISTINCT FROM d->>'publicListingNo'
      AND v.property_id IS NOT DISTINCT FROM source_id
      AND v.deal_type IS NOT DISTINCT FROM d->>'dealType'
      AND v.requested_staff_id IS NOT DISTINCT FROM wanted_staff
      AND v.reference_mapping_id IS NOT DISTINCT FROM ref_id
      AND v.branch_id IS NOT DISTINCT FROM d->>'branchId'
      AND v.external_listing_id IS NOT DISTINCT FROM d->>'externalListingId'
      AND v.video_id IS NOT DISTINCT FROM d->>'videoId'
      AND (EXISTS(SELECT 1 FROM whatsapp_tracking_link_placements x WHERE x.link_id=l.id AND x.placement_key=pk)
        OR (NOT EXISTS(SELECT 1 FROM whatsapp_tracking_link_placements x WHERE x.link_id=l.id)
          AND ((d->>'placementSource'='website' AND r->>'placementId'='website:primary')
            OR d->>'placementSource' IN ('28hse','youtube'))));
   IF reserved IS NOT NULL AND (candidate IS NULL OR candidate<>reserved) THEN reason := 'PLACEMENT_CONFLICT'; END IF;
   IF candidates>1 THEN reason := 'LEGACY_PLACEMENT_AMBIGUOUS'; END IF;
   IF reason IS NOT NULL THEN blocked := true; END IF;
   output := output || jsonb_build_array(jsonb_build_object('rowKey',rk,'outcome',
     CASE WHEN reason IS NOT NULL THEN 'blocked' WHEN candidate IS NULL THEN 'create' ELSE 'reuse' END,
     'linkId',candidate,'code',NULL,'version',NULL,'reasonCode',reason));
 END LOOP;
 IF blocked THEN
   SELECT jsonb_agg(CASE WHEN x->>'outcome'='blocked' THEN x ELSE x || '{"outcome":"failed","reasonCode":"CHUNK_NOT_COMMITTED"}'::jsonb END)
     INTO output FROM jsonb_array_elements(output) x;
   INSERT INTO whatsapp_link_batch_operations(batch_id,chunk_id,actor_staff_id,payload_hash,state,result)
     VALUES(p_batch,p_chunk,p_actor,p_chunk_hash,'rejected',output);
   RETURN jsonb_build_object('batchId',p_batch,'chunkId',p_chunk,'state','rejected','rows',output);
 END IF;
 output := '[]'::jsonb;
 FOR r IN SELECT x FROM jsonb_array_elements(p_rows) x LOOP
   rk := (r->>'rowKey')::uuid; pk := r->>'placementKey'; d := r->'input';
   SELECT x.link_id INTO candidate FROM whatsapp_tracking_link_placements x WHERE x.placement_key=pk;
   IF candidate IS NULL THEN
     SELECT min(l.id::text)::uuid INTO candidate FROM whatsapp_tracking_links l JOIN whatsapp_tracking_link_versions v
       ON v.link_id=l.id AND v.version=l.current_version
       WHERE v.enabled AND v.placement_verified_at IS NOT NULL AND v.channel_id=p_channel
        AND v.placement_source=d->>'placementSource' AND v.entry_point_type=d->>'entryPointType'
        AND v.public_listing_no IS NOT DISTINCT FROM d->>'publicListingNo'
        AND v.property_id IS NOT DISTINCT FROM NULLIF(d->>'propertyId','')::uuid
        AND v.deal_type IS NOT DISTINCT FROM d->>'dealType'
        AND v.requested_staff_id IS NOT DISTINCT FROM NULLIF(d->>'requestedStaffId','')::uuid
        AND v.reference_mapping_id IS NOT DISTINCT FROM NULLIF(d->>'referenceMappingId','')::uuid
        AND v.branch_id IS NOT DISTINCT FROM d->>'branchId'
        AND v.external_listing_id IS NOT DISTINCT FROM d->>'externalListingId'
        AND v.video_id IS NOT DISTINCT FROM d->>'videoId'
        AND NOT EXISTS(SELECT 1 FROM whatsapp_tracking_link_placements x WHERE x.link_id=l.id)
        AND ((d->>'placementSource'='website' AND r->>'placementId'='website:primary') OR d->>'placementSource' IN ('28hse','youtube'));
   END IF;
   IF candidate IS NULL THEN
     code := p_codes->>rk::text;
     IF code IS NULL OR code !~ '^[A-Za-z0-9_-]{32}$' THEN RAISE EXCEPTION 'WA_LINK_CODE_INVALID'; END IF;
     INSERT INTO whatsapp_tracking_links(code,created_by) VALUES(code,p_actor) RETURNING id INTO candidate;
     INSERT INTO whatsapp_tracking_link_versions(link_id,version,channel_id,placement_source,entry_point_type,
       public_listing_no,property_id,deal_type,requested_staff_id,branch_id,external_listing_id,video_id,
       enabled,created_by,placement_verified_at,reference_mapping_id)
       VALUES(candidate,1,p_channel,d->>'placementSource',d->>'entryPointType',d->>'publicListingNo',
         NULLIF(d->>'propertyId','')::uuid,d->>'dealType',NULLIF(d->>'requestedStaffId','')::uuid,
         d->>'branchId',d->>'externalListingId',d->>'videoId',true,p_actor,now(),
         NULLIF(d->>'referenceMappingId','')::uuid);
     reason := 'created';
   ELSE reason := 'reused'; END IF;
   INSERT INTO whatsapp_tracking_link_placements(placement_key,placement_id,link_id)
     VALUES(pk,r->>'placementId',candidate) ON CONFLICT(placement_key) DO NOTHING;
   SELECT l.code,l.current_version INTO result_code,result_version FROM whatsapp_tracking_links l WHERE l.id=candidate;
   output := output || jsonb_build_array(jsonb_build_object('rowKey',rk,'outcome',reason,
     'linkId',candidate,'code',result_code,'version',result_version,'reasonCode',NULL));
 END LOOP;
 INSERT INTO whatsapp_link_batch_operations(batch_id,chunk_id,actor_staff_id,payload_hash,state,result)
   VALUES(p_batch,p_chunk,p_actor,p_chunk_hash,'committed',output);
 INSERT INTO whatsapp_link_batch_rows(batch_id,row_key,chunk_id,placement_key,link_id,outcome)
   SELECT p_batch,(x->>'rowKey')::uuid,p_chunk,rr->>'placementKey',(x->>'linkId')::uuid,x->>'outcome'
    FROM jsonb_array_elements(output) x JOIN jsonb_array_elements(p_rows) rr ON rr->>'rowKey'=x->>'rowKey';
 RETURN jsonb_build_object('batchId',p_batch,'chunkId',p_chunk,'state','committed','rows',output);
END $$;
