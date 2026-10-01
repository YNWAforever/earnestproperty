-- Additive reviewed withdrawal metadata. No candidate creation performs inventory writes.
-- Keep all history, source links and public identities on rollback.
CREATE TABLE IF NOT EXISTS property_withdrawal_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL REFERENCES staff_users(id),
 source text NOT NULL CHECK(source IN ('28hse_agent_540','propertyhk')),scope_id text NOT NULL,
 rule_version text NOT NULL DEFAULT 'review-withdrawal-v1',created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '15 minutes',
 CHECK((source='28hse_agent_540' AND scope_id='agent:540') OR (source='propertyhk' AND scope_id='branches:EPW,EPS,EPT'))
);
CREATE TABLE IF NOT EXISTS property_withdrawal_preview_rows (
 preview_id uuid NOT NULL REFERENCES property_withdrawal_previews(id),property_id uuid NOT NULL REFERENCES properties(id),
 property_no text NOT NULL,deal_type text NOT NULL CHECK(deal_type IN ('sale','rent')),
 expected_version text NOT NULL,evidence_hash text NOT NULL CHECK(evidence_hash ~ '^[a-f0-9]{64}$'),
 decision jsonb NOT NULL,evidence jsonb NOT NULL,before_state jsonb NOT NULL,apply_result jsonb,
 PRIMARY KEY(preview_id,property_id)
);
CREATE TABLE IF NOT EXISTS property_withdrawal_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),preview_id uuid NOT NULL REFERENCES property_withdrawal_previews(id),
 idempotency_key uuid UNIQUE NOT NULL,actor_id uuid NOT NULL REFERENCES staff_users(id),reason text NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),results jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS property_withdrawal_previews_actor ON property_withdrawal_previews(actor_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS listing_source_observations_receipt_members ON listing_source_observations(run_id,source,external_listing_id,deal_type);

-- Extend the existing locked management writer with inactive; unchanged authorization,
-- optimistic version, override/provenance and audit semantics. Prior applied DDL is immutable.
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
  WHERE m.public_listing_no=p_no ORDER BY p.deal_type,p.source_updated_at DESC NULLS LAST,p.last_seen_at DESC NULLS LAST,p.updated_at DESC NULLS LAST,p.created_at DESC,p.id ASC
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
