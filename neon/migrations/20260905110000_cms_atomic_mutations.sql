-- Reviewed application code requires this migration; do not deploy independently.
-- Existing UNIQUE(resource_type, resource_id, version_number) remains authoritative.
ALTER TABLE cms_content_revisions ADD COLUMN IF NOT EXISTS draft_edit_version integer NOT NULL DEFAULT 1 CHECK (draft_edit_version > 0);
ALTER TABLE cms_content_revisions ADD COLUMN IF NOT EXISTS draft_retired_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS cms_one_publication ON cms_content_revisions(resource_type, resource_id) WHERE state = 'published';

CREATE OR REPLACE FUNCTION cms_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD.state <> 'draft' OR OLD.draft_retired_at IS NOT NULL) AND (TG_OP = 'DELETE' OR
  (to_jsonb(NEW) - 'state') IS DISTINCT FROM (to_jsonb(OLD) - 'state') OR
  NOT (NEW.state = OLD.state OR (OLD.state = 'published' AND NEW.state = 'superseded'))) THEN
  RAISE EXCEPTION 'CMS_IMMUTABLE_REVISION';
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cms_revision_immutable ON cms_content_revisions;
CREATE TRIGGER cms_revision_immutable BEFORE UPDATE OR DELETE ON cms_content_revisions FOR EACH ROW EXECUTE FUNCTION cms_revision_immutable();

-- VOLATILE plpgsql statements obtain fresh Read Committed snapshots AFTER lock wait.
-- Every mutation uses the same type/id advisory identity, even before a live row exists.
-- SECURITY INVOKER: called only through the server's authenticated DB credential.
CREATE OR REPLACE FUNCTION cms_mutate(p_op text, p_type text, p_id uuid, p_actor uuid,
 p_payload jsonb DEFAULT NULL, p_base integer DEFAULT NULL, p_edit integer DEFAULT NULL,
 p_revision uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE
 v_revision cms_content_revisions%ROWTYPE;
 v_source cms_content_revisions%ROWTYPE;
 v_current integer;
 v_next integer;
 v_count integer;
 v_action text;
 v_table text;
BEGIN
 IF p_op NOT IN ('save','publish','restore','archive') THEN RAISE EXCEPTION 'INVALID_CMS_OPERATION'; END IF;
 IF p_type NOT IN ('estate','article','video','faq','media') OR p_id IS NULL THEN RAISE EXCEPTION 'INVALID_CMS_RESOURCE_TYPE'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('cms:' || p_type || ':' || p_id::text, 0));
 IF NOT EXISTS (SELECT 1 FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id
   WHERE s.id=p_actor AND s.active AND (r.role::text IN ('admin','manager') OR (p_op='save' AND r.role::text='agent'))) THEN
  RAISE EXCEPTION 'FORBIDDEN';
 END IF;
 SELECT version_number INTO v_current FROM cms_content_revisions WHERE resource_type=p_type AND resource_id=p_id AND state='published';
 SELECT COALESCE(MAX(version_number),0)+1 INTO v_next FROM cms_content_revisions WHERE resource_type=p_type AND resource_id=p_id;
 IF p_op='save' THEN
  IF p_base IS DISTINCT FROM v_current THEN RAISE EXCEPTION 'CMS_REVISION_CONFLICT'; END IF;
  SELECT * INTO v_revision FROM cms_content_revisions WHERE resource_type=p_type AND resource_id=p_id AND state='draft' AND draft_retired_at IS NULL AND created_by=p_actor ORDER BY version_number DESC LIMIT 1;
  IF v_revision.id IS NOT NULL THEN
   UPDATE cms_content_revisions SET payload=p_payload, validation_summary='{}', draft_edit_version=draft_edit_version+1, created_at=now()
    WHERE id=v_revision.id AND id=p_revision AND state='draft' AND draft_edit_version = p_edit AND base_published_version IS NOT DISTINCT FROM p_base RETURNING * INTO v_revision;
   GET DIAGNOSTICS v_count=ROW_COUNT;
   IF v_count<>1 THEN RAISE EXCEPTION 'CMS_REVISION_CONFLICT'; END IF;
  ELSE
   IF p_edit IS NOT NULL OR p_revision IS NOT NULL THEN RAISE EXCEPTION 'CMS_REVISION_CONFLICT'; END IF;
   INSERT INTO cms_content_revisions(resource_type,resource_id,version_number,state,payload,base_published_version,created_by)
    VALUES(p_type,p_id,v_next,'draft',p_payload,p_base,p_actor) RETURNING * INTO v_revision;
  END IF;
  v_action='cms_draft_saved';
 ELSIF p_op='restore' THEN
  SELECT * INTO v_source FROM cms_content_revisions WHERE id=p_revision AND resource_type=p_type AND resource_id=p_id AND state<>'draft';
  IF v_source.id IS NULL THEN RAISE EXCEPTION 'CMS_REVISION_NOT_FOUND'; END IF;
  -- Retire private drafts without turning their payloads into shared publication history.
  UPDATE cms_content_revisions SET draft_retired_at=now() WHERE resource_type=p_type AND resource_id=p_id AND state='draft' AND draft_retired_at IS NULL AND created_by=p_actor;
  INSERT INTO cms_content_revisions(resource_type,resource_id,version_number,state,payload,base_published_version,created_by,restored_from_revision_id)
   VALUES(p_type,p_id,v_next,'draft',v_source.payload,v_current,p_actor,p_revision) RETURNING * INTO v_revision;
  v_action='cms_restored';
 ELSIF p_op='publish' THEN
  SELECT * INTO v_revision FROM cms_content_revisions WHERE id=p_revision AND resource_type=p_type AND resource_id=p_id AND state='draft' AND draft_retired_at IS NULL;
  IF v_revision.id IS NULL OR v_revision.draft_edit_version IS DISTINCT FROM p_edit OR
   v_revision.base_published_version IS DISTINCT FROM v_current OR p_base IS DISTINCT FROM v_current THEN
   RAISE EXCEPTION 'CMS_REVISION_CONFLICT';
  END IF;
  UPDATE cms_content_revisions SET state='superseded' WHERE resource_type=p_type AND resource_id=p_id AND state='published';
  IF p_type='estate' THEN
    INSERT INTO estates (id, slug, name_zh, name_en, district_slug, developer, year_completed,
      phases, total_units, area_min, area_max, description, hero_image, facilities,
      seo_title, seo_description, aliases, address, blocks, school_net_code, transport_note,
      verified_at, district_id, avg_saleable_psf, lat, lng, published)
    SELECT resource_id, payload->>'slug', payload->>'name_zh', payload->>'name_en',
      payload->>'district_slug', payload->>'developer', (payload->>'year_completed')::int,
      (payload->>'phases')::int, (payload->>'total_units')::int, (payload->>'area_min')::int,
      (payload->>'area_max')::int, payload->>'description', payload->>'hero_image',
      CASE WHEN payload->'facilities' IS NULL OR payload->'facilities' = 'null'::jsonb THEN NULL ELSE ARRAY(SELECT jsonb_array_elements_text(payload->'facilities')) END,
      payload->>'seo_title', payload->>'seo_description',
      CASE WHEN payload->'aliases' IS NULL OR payload->'aliases' = 'null'::jsonb THEN NULL ELSE ARRAY(SELECT jsonb_array_elements_text(payload->'aliases')) END,
      payload->>'address', (payload->>'blocks')::int, payload->>'school_net_code',
      payload->>'transport_note', NULLIF(payload->>'verified_at', '')::timestamptz,
      NULLIF(payload->>'district_id', '')::uuid, (payload->>'avg_saleable_psf')::numeric,
      (payload->>'lat')::numeric, (payload->>'lng')::numeric, true
    FROM cms_content_revisions WHERE id = v_revision.id
    ON CONFLICT (id) DO UPDATE SET slug=EXCLUDED.slug, name_zh=EXCLUDED.name_zh,
      name_en=EXCLUDED.name_en, district_slug=EXCLUDED.district_slug, developer=EXCLUDED.developer,
      year_completed=EXCLUDED.year_completed, phases=EXCLUDED.phases, total_units=EXCLUDED.total_units,
      area_min=EXCLUDED.area_min, area_max=EXCLUDED.area_max, description=EXCLUDED.description,
      hero_image=EXCLUDED.hero_image, facilities=EXCLUDED.facilities, seo_title=EXCLUDED.seo_title,
      seo_description=EXCLUDED.seo_description, aliases=EXCLUDED.aliases, address=EXCLUDED.address,
      blocks=EXCLUDED.blocks, school_net_code=EXCLUDED.school_net_code,
      transport_note=EXCLUDED.transport_note, verified_at=EXCLUDED.verified_at,
      district_id=EXCLUDED.district_id, avg_saleable_psf=EXCLUDED.avg_saleable_psf,
      lat=EXCLUDED.lat, lng=EXCLUDED.lng, published=true, updated_at=now();
  ELSIF p_type='article' THEN
    INSERT INTO articles (id, slug, title, excerpt, content, cover_image, category,
      reading_minutes, published, published_at, seo_title, seo_description)
    SELECT resource_id, payload->>'slug', payload->>'title', payload->>'excerpt', payload->>'content',
      payload->>'cover_image', payload->>'category', COALESCE((payload->>'reading_minutes')::int, 5),
      true, now(), payload->>'seo_title', payload->>'seo_description' FROM cms_content_revisions WHERE id = v_revision.id
    ON CONFLICT (id) DO UPDATE SET slug=EXCLUDED.slug, title=EXCLUDED.title, excerpt=EXCLUDED.excerpt,
      content=EXCLUDED.content, cover_image=EXCLUDED.cover_image, category=EXCLUDED.category,
      reading_minutes=EXCLUDED.reading_minutes, published=true, published_at=now(),
      seo_title=EXCLUDED.seo_title, seo_description=EXCLUDED.seo_description, updated_at=now();
  ELSIF p_type='video' THEN
    INSERT INTO cms_videos (id, title, video_url, description, sort_order, published)
    SELECT resource_id, payload->>'title', payload->>'video_url', payload->>'description',
      COALESCE((payload->>'sort_order')::int, 0), true FROM cms_content_revisions WHERE id = v_revision.id
    ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, video_url=EXCLUDED.video_url,
      description=EXCLUDED.description, sort_order=EXCLUDED.sort_order, published=true, updated_at=now();
  ELSIF p_type='faq' THEN
    INSERT INTO faqs (id, scope, question, answer, sort_order, published)
    SELECT resource_id, payload->>'scope', payload->>'question', payload->>'answer',
      COALESCE((payload->>'sort_order')::int, 0), true FROM cms_content_revisions WHERE id = v_revision.id
    ON CONFLICT (id) DO UPDATE SET scope=EXCLUDED.scope, question=EXCLUDED.question,
      answer=EXCLUDED.answer, sort_order=EXCLUDED.sort_order, published=true;
  ELSE
    INSERT INTO media_assets (id, url, pathname, content_type, size_bytes, alt_text,
      owner_type, owner_id, created_by, archived_at)
    SELECT resource_id, payload->>'url', payload->>'pathname', payload->>'content_type',
      (payload->>'size_bytes')::bigint, payload->>'alt_text', COALESCE(payload->>'owner_type', 'property'),
      NULLIF(payload->>'owner_id', '')::uuid, created_by, null FROM cms_content_revisions WHERE id = v_revision.id
    ON CONFLICT (id) DO UPDATE SET url=EXCLUDED.url, pathname=EXCLUDED.pathname,
      content_type=EXCLUDED.content_type, size_bytes=EXCLUDED.size_bytes, alt_text=EXCLUDED.alt_text,
      owner_type=EXCLUDED.owner_type, owner_id=EXCLUDED.owner_id, archived_at=null; END IF;
  UPDATE cms_content_revisions SET state='published',published_at=now() WHERE id=v_revision.id AND state='draft' AND draft_edit_version = p_edit RETURNING * INTO v_revision;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>1 THEN RAISE EXCEPTION 'CMS_REVISION_CONFLICT'; END IF;
  UPDATE cms_content_revisions SET draft_retired_at=now() WHERE resource_type=p_type AND resource_id=p_id AND state='draft' AND draft_retired_at IS NULL AND created_by=v_revision.created_by;
  v_action='cms_published';
 ELSE
  IF p_type='media' AND EXISTS (SELECT 1 FROM media_assets m WHERE m.id=p_id AND (
    EXISTS (SELECT 1 FROM estates WHERE hero_image=m.url) OR EXISTS (SELECT 1 FROM articles WHERE cover_image=m.url)
    OR EXISTS (SELECT 1 FROM properties WHERE m.url=ANY(images)))) THEN RAISE EXCEPTION 'CMS_MEDIA_IN_USE'; END IF;
  SELECT * INTO v_source FROM cms_content_revisions WHERE resource_type=p_type AND resource_id=p_id ORDER BY (state='published') DESC,version_number DESC LIMIT 1;
  IF v_source.id IS NULL THEN RAISE EXCEPTION 'CMS_RESOURCE_NOT_FOUND'; END IF;
  INSERT INTO cms_content_revisions(resource_type,resource_id,version_number,state,payload,base_published_version,created_by)
   VALUES(p_type,p_id,v_next,'archived',v_source.payload,v_current,p_actor) RETURNING * INTO v_revision;
  v_table=CASE p_type WHEN 'estate' THEN 'estates' WHEN 'article' THEN 'articles' WHEN 'video' THEN 'cms_videos' WHEN 'faq' THEN 'faqs' ELSE 'media_assets' END;
  IF p_type='media' THEN UPDATE media_assets SET archived_at=now() WHERE id=p_id;
  ELSE EXECUTE format('UPDATE %I SET published=false WHERE id=$1',v_table) USING p_id; END IF;
  UPDATE cms_content_revisions SET state='superseded' WHERE resource_type=p_type AND resource_id=p_id AND state='published';
  UPDATE cms_content_revisions SET draft_retired_at=now() WHERE resource_type=p_type AND resource_id=p_id AND state='draft' AND draft_retired_at IS NULL;
  v_action='cms_archived';
 END IF;
 INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata)
  VALUES(p_actor,v_action,p_type,p_id,jsonb_build_object('revisionId',v_revision.id,'restoredFromRevisionId',v_revision.restored_from_revision_id,'draftEditVersion',v_revision.draft_edit_version));
 RETURN to_jsonb(v_revision) || jsonb_build_object('current_published_version',v_current);
END $$;

-- Idempotent legacy reconciliation is OPT-IN, never applied by this migration.
CREATE OR REPLACE FUNCTION cms_reconcile_legacy_estates(p_actor uuid, p_apply boolean DEFAULT false)
 RETURNS TABLE(resource_id uuid, proposed_state text, applied boolean) LANGUAGE plpgsql VOLATILE AS $$
DECLARE e estates%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=p_actor AND s.active AND r.role::text='admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 FOR e IN SELECT * FROM estates ORDER BY id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('cms:estate:' || e.id::text,0));
  SELECT * INTO e FROM estates WHERE id=e.id;
  IF NOT EXISTS(SELECT 1 FROM cms_content_revisions r WHERE r.resource_type='estate' AND r.resource_id=e.id) THEN
   resource_id=e.id; proposed_state=CASE WHEN e.published THEN 'published' ELSE 'archived' END; applied=p_apply;
   IF p_apply THEN
    INSERT INTO cms_content_revisions(resource_type,resource_id,version_number,state,payload,created_by,published_at)
     VALUES('estate',e.id,1,proposed_state,to_jsonb(e)-'created_at'-'updated_at',p_actor,CASE WHEN e.published THEN now() END);
    INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata) VALUES(p_actor,'cms_legacy_reconciled','estate',e.id,jsonb_build_object('state',proposed_state));
   END IF;
   RETURN NEXT;
  END IF;
 END LOOP;
END $$;
