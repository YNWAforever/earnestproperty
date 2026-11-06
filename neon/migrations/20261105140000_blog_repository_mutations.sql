-- Task4: server-only blog operations. No client grants or production application implied.
-- Imported legacy dates may be unknown; only first editorial publication assigns now().
ALTER TABLE articles ALTER COLUMN published_at DROP NOT NULL;
ALTER TABLE articles ADD COLUMN editorial_metadata jsonb NOT NULL DEFAULT
 '{"author":null,"reviewer":null,"sourcesNote":null,"answerSummary":null,"compareEstateSlugs":[]}'::jsonb
 CHECK (jsonb_typeof(editorial_metadata)='object');
CREATE TABLE blog_mutation_requests (
 request_id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES staff_users(id), operation text NOT NULL,
 fingerprint text NOT NULL, command jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE blog_mutation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON blog_mutation_requests FROM PUBLIC;

CREATE FUNCTION blog_require_actor(p_actor uuid, p_publish boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id
  WHERE s.id=p_actor AND s.active AND (r.role::text IN ('admin','manager') OR (NOT p_publish AND r.role::text='agent')))
 THEN RAISE EXCEPTION 'BLOG_FORBIDDEN'; END IF;
END $$;

-- All blog writers take this lock before scope rows, resource locks, and article rows.
-- This intentionally serializes low-volume editorial writes (not reads) across scopes.
CREATE FUNCTION blog_lock() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('blog:mutation',0));
 PERFORM id FROM blog_settings ORDER BY id FOR UPDATE;
END $$;

CREATE FUNCTION blog_assert_article(p_id uuid,p_payload jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE a articles%ROWTYPE;
BEGIN
 PERFORM blog_lock();
 SELECT * INTO a FROM articles WHERE id=p_id;
 IF EXISTS(SELECT 1 FROM articles WHERE id<>p_id AND slug=p_payload->>'slug') OR
    EXISTS(SELECT 1 FROM cms_content_revisions WHERE resource_type='article' AND resource_id<>p_id
      AND state='draft' AND draft_retired_at IS NULL AND payload->>'slug'=p_payload->>'slug')
 THEN RAISE EXCEPTION 'BLOG_VALIDATION_SLUG_TAKEN'; END IF;
 IF a.slug_locked AND a.slug IS DISTINCT FROM p_payload->>'slug' THEN RAISE EXCEPTION 'BLOG_SLUG_LOCKED'; END IF;
 IF p_payload->>'slug'='editorial-standards' THEN RAISE EXCEPTION 'BLOG_RESERVED_SLUG'; END IF;
 IF jsonb_typeof(p_payload)<>'object' OR coalesce(btrim(p_payload->>'title'),'')='' OR
  coalesce(p_payload->>'slug','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN RAISE EXCEPTION 'BLOG_VALIDATION'; END IF;
 IF p_payload ? 'content_format' AND coalesce(p_payload->>'content_format','') NOT IN ('legacy-text','editor-json-v1') THEN RAISE EXCEPTION 'BLOG_VALIDATION'; END IF;
 IF p_payload->>'content_format'='editor-json-v1' THEN
  IF (jsonb_typeof((p_payload->>'content')::jsonb)<>'object' OR ((p_payload->>'content')::jsonb)->>'type' IS DISTINCT FROM 'doc') THEN RAISE EXCEPTION 'BLOG_VALIDATION'; END IF;
 END IF;
 IF p_payload ? 'supplemental_links' AND jsonb_typeof(p_payload->'supplemental_links') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'BLOG_VALIDATION'; END IF;
 IF p_payload ? 'editorial_metadata' AND jsonb_typeof(p_payload->'editorial_metadata') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'BLOG_VALIDATION'; END IF;
 IF p_payload->>'category_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM blog_categories WHERE id=(p_payload->>'category_id')::uuid) THEN RAISE EXCEPTION 'BLOG_VALIDATION'; END IF;
END $$;

CREATE FUNCTION blog_prune_features(p_id uuid,p_actor uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_scope_id uuid;
BEGIN
 FOR v_scope_id IN SELECT DISTINCT f.scope_id FROM blog_featured_articles f JOIN blog_settings s ON s.id=f.scope_id
  JOIN articles a ON a.id=f.article_id WHERE a.id=p_id AND
  (NOT a.published OR a.published_at>now() OR (s.scope_kind='category' AND a.category_id IS DISTINCT FROM s.category_id)) ORDER BY f.scope_id
 LOOP
  DELETE FROM blog_featured_articles f WHERE f.scope_id=v_scope_id AND f.article_id=p_id;
  UPDATE blog_settings SET version=version+1 WHERE id=v_scope_id;
  INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata)
   VALUES(p_actor,'blog_features_pruned','blog_settings',v_scope_id,jsonb_build_object('articleId',p_id));
 END LOOP;
END $$;

CREATE FUNCTION blog_article_document(p_id uuid,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE a articles%ROWTYPE; d cms_content_revisions%ROWTYPE; pub cms_content_revisions%ROWTYPE;
BEGIN
 PERFORM blog_require_actor(p_actor);
 SELECT * INTO a FROM articles WHERE id=p_id;
 SELECT * INTO d FROM cms_content_revisions WHERE resource_type='article' AND resource_id=p_id AND state='draft'
  AND draft_retired_at IS NULL AND created_by=p_actor ORDER BY version_number DESC LIMIT 1;
 SELECT * INTO pub FROM cms_content_revisions WHERE resource_type='article' AND resource_id=p_id AND state='published';
 IF a.id IS NULL AND d.id IS NULL THEN RAISE EXCEPTION 'BLOG_NOT_FOUND'; END IF;
 RETURN jsonb_build_object('id',p_id,'payload',coalesce(to_jsonb(a),'{}'::jsonb)||coalesce(d.payload,pub.payload,'{}'::jsonb)||jsonb_build_object('content_format',CASE WHEN d.id IS NOT NULL THEN coalesce(d.payload->>'content_format','legacy-text') WHEN pub.id IS NOT NULL THEN coalesce(pub.payload->>'content_format','legacy-text') ELSE a.content_format END),
  'published',coalesce(a.published,false),'published_at',CASE WHEN d.id IS NOT NULL AND d.payload ? 'published_at' THEN d.payload->'published_at' ELSE to_jsonb(a.published_at) END,
  'created_at',coalesce(a.created_at,d.created_at),'version',coalesce(a.version,0),'slug_locked',coalesce(a.slug_locked,false),
  'editState',jsonb_build_object('resourceId',p_id,'draftRevisionId',d.id,'draftVersion',d.version_number,'draftEditVersion',d.draft_edit_version,
   'currentPublishedVersion',pub.version_number,'basePublishedVersion',CASE WHEN d.id IS NOT NULL THEN d.base_published_version ELSE pub.version_number END,
   'restoredFromRevisionId',d.restored_from_revision_id));
END $$;

CREATE FUNCTION blog_settings_document(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('scope',CASE WHEN scope_kind='main' THEN jsonb_build_object('kind','main') ELSE jsonb_build_object('kind','category','categoryId',category_id) END,
 'heading',heading,'introduction',introduction,'seoTitle',seo_title,'seoDescription',seo_description,'version',version,
 'featuredIds',coalesce((SELECT jsonb_agg(article_id ORDER BY position) FROM blog_featured_articles WHERE scope_id=s.id),'[]'::jsonb)) FROM blog_settings s WHERE id=p_id
$$;
CREATE FUNCTION blog_category_document(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('id',c.id,'key',c.key,'name',c.name,'navigationOrder',c.navigation_order,'hidden',c.hidden,'version',c.version,'settingsVersion',s.version,
  'heading',s.heading,'introduction',s.introduction,'seoTitle',s.seo_title,'seoDescription',s.seo_description)
 FROM blog_categories c JOIN blog_settings s ON s.category_id=c.id AND s.scope_kind='category' WHERE c.id=p_id
$$;

CREATE FUNCTION blog_save_settings(p_actor uuid,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE s blog_settings%ROWTYPE; ids uuid[]; result jsonb;
BEGIN
 PERFORM blog_require_actor(p_actor,true); PERFORM blog_lock();
 IF p_input->'scope'->>'kind'='main' AND coalesce(btrim(p_input->>'heading'),'')='' THEN RAISE EXCEPTION 'BLOG_VALIDATION_HEADING'; END IF;
 SELECT * INTO s FROM blog_settings WHERE scope_kind=p_input->'scope'->>'kind'
  AND category_id IS NOT DISTINCT FROM (p_input->'scope'->>'categoryId')::uuid FOR UPDATE;
 IF s.id IS NULL THEN RAISE EXCEPTION 'BLOG_NOT_FOUND'; END IF;
 IF s.version IS DISTINCT FROM (p_input->>'version')::integer THEN RAISE EXCEPTION 'BLOG_REVISION_CONFLICT'; END IF;
 SELECT array_agg(value::uuid) INTO ids FROM jsonb_array_elements_text(p_input->'featuredIds');
 PERFORM id FROM articles WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM unnest(ids))<>(SELECT count(DISTINCT id) FROM unnest(ids) id) OR
  EXISTS(SELECT 1 FROM unnest(ids) AS selected(article_id) LEFT JOIN articles a ON a.id=selected.article_id WHERE a.id IS NULL OR NOT a.published OR a.published_at>now()
   OR (s.scope_kind='category' AND a.category_id IS DISTINCT FROM s.category_id)) THEN RAISE EXCEPTION 'BLOG_FEATURE_INELIGIBLE'; END IF;
 UPDATE blog_settings SET heading=p_input->>'heading',introduction=p_input->>'introduction',seo_title=p_input->>'seoTitle',seo_description=p_input->>'seoDescription',version=version+1 WHERE id=s.id;
 DELETE FROM blog_featured_articles WHERE scope_id=s.id;
 INSERT INTO blog_featured_articles(scope_id,article_id,position) SELECT s.id,id,ordinality-1 FROM unnest(ids) WITH ORDINALITY t(id,ordinality);
 result:=blog_settings_document(s.id);
 INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata) VALUES(p_actor,'blog_settings_saved','blog_settings',s.id,result);
 RETURN result;
END $$;

CREATE FUNCTION blog_save_category(p_actor uuid,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE c blog_categories%ROWTYPE; s blog_settings%ROWTYPE; result jsonb;
BEGIN
 PERFORM blog_require_actor(p_actor,true); PERFORM blog_lock();
 IF p_input->>'key'='全部' THEN RAISE EXCEPTION 'BLOG_VALIDATION_RESERVED_CATEGORY'; END IF;
 IF p_input->>'id' IS NULL THEN
  IF (p_input->>'version')::int IS DISTINCT FROM 0 OR (p_input->>'settingsVersion')::int IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'BLOG_REVISION_CONFLICT'; END IF;
  INSERT INTO blog_categories(key,name,navigation_order,hidden) VALUES(p_input->>'key',p_input->>'name',(p_input->>'navigationOrder')::int,(p_input->>'hidden')::boolean) RETURNING * INTO c;
  INSERT INTO blog_legacy_category_map(legacy_key,category_id) VALUES(c.key,c.id);
  INSERT INTO blog_settings(scope_kind,category_id,heading,introduction,seo_title,seo_description) VALUES('category',c.id,p_input->>'heading',p_input->>'introduction',p_input->>'seoTitle',p_input->>'seoDescription');
 ELSE
  SELECT * INTO c FROM blog_categories WHERE id=(p_input->>'id')::uuid FOR UPDATE;
  SELECT * INTO s FROM blog_settings WHERE scope_kind='category' AND category_id=c.id FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'BLOG_NOT_FOUND'; END IF;
  IF c.version IS DISTINCT FROM (p_input->>'version')::int OR s.version IS DISTINCT FROM (p_input->>'settingsVersion')::int THEN RAISE EXCEPTION 'BLOG_REVISION_CONFLICT'; END IF;
  -- Query keys are canonical identifiers, including legacy Chinese keys.
  IF c.key IS DISTINCT FROM p_input->>'key' THEN RAISE EXCEPTION 'BLOG_VALIDATION_KEY_LOCKED'; END IF;
  UPDATE blog_categories SET name=p_input->>'name',navigation_order=(p_input->>'navigationOrder')::int,hidden=(p_input->>'hidden')::boolean,version=version+1 WHERE id=c.id;
  UPDATE blog_settings SET heading=p_input->>'heading',introduction=p_input->>'introduction',seo_title=p_input->>'seoTitle',seo_description=p_input->>'seoDescription',version=version+1 WHERE id=s.id;
 END IF;
 result:=blog_category_document(c.id);
 INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata) VALUES(p_actor,'blog_category_saved','blog_category',c.id,result);
 RETURN result;
END $$;
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
 v_document jsonb;
 v_command jsonb;
 v_result jsonb;
 v_prior blog_mutation_requests%ROWTYPE;
BEGIN
 IF p_op NOT IN ('save','publish','restore','archive','reconcile') OR (p_op='reconcile' AND p_type<>'article') THEN RAISE EXCEPTION 'INVALID_CMS_OPERATION'; END IF;
 IF p_type NOT IN ('estate','article','video','faq','media') OR p_id IS NULL THEN RAISE EXCEPTION 'INVALID_CMS_RESOURCE_TYPE'; END IF;
 IF p_type='article' THEN PERFORM blog_lock(); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('cms:' || p_type || ':' || p_id::text, 0));
 IF NOT EXISTS (SELECT 1 FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id
   WHERE s.id=p_actor AND s.active AND (r.role::text IN ('admin','manager') OR (p_op IN ('save','reconcile') AND r.role::text='agent'))) THEN
  RAISE EXCEPTION 'FORBIDDEN';
 END IF;
 IF p_type='article' AND p_op IN ('restore','archive') THEN
  IF p_payload->>'requestId' IS NULL OR p_payload->'editState' IS NULL OR p_payload->'expectedVersion' IS NULL THEN RAISE EXCEPTION 'CMS_REVISION_CONFLICT'; END IF;
  v_command:=jsonb_build_object('resourceId',p_id,'revisionId',p_revision,'tokens',p_payload);
  SELECT * INTO v_prior FROM blog_mutation_requests WHERE request_id=(p_payload->>'requestId')::uuid;
  IF v_prior.request_id IS NOT NULL THEN
   IF v_prior.actor_id IS DISTINCT FROM p_actor OR v_prior.operation IS DISTINCT FROM p_op OR v_prior.command IS DISTINCT FROM v_command THEN RAISE EXCEPTION 'BLOG_IDEMPOTENCY_CONFLICT'; END IF;
   RETURN v_prior.result;
  END IF;
  v_document:=blog_article_document(p_id,p_actor);
  IF v_document->'editState' IS DISTINCT FROM p_payload->'editState' OR v_document->'version' IS DISTINCT FROM p_payload->'expectedVersion' THEN RAISE EXCEPTION 'CMS_REVISION_CONFLICT'; END IF;
 END IF;
 SELECT version_number INTO v_current FROM cms_content_revisions WHERE resource_type=p_type AND resource_id=p_id AND state='published';
 SELECT COALESCE(MAX(version_number),0)+1 INTO v_next FROM cms_content_revisions WHERE resource_type=p_type AND resource_id=p_id;
 IF p_type='article' AND p_op IN ('save','reconcile') THEN PERFORM blog_assert_article(p_id,p_payload); END IF;
 IF p_op IN ('save','reconcile') THEN
  IF p_base IS DISTINCT FROM v_current THEN RAISE EXCEPTION 'CMS_REVISION_CONFLICT'; END IF;
  SELECT * INTO v_revision FROM cms_content_revisions WHERE resource_type=p_type AND resource_id=p_id AND state='draft' AND draft_retired_at IS NULL AND created_by=p_actor ORDER BY version_number DESC LIMIT 1;
  IF v_revision.id IS NOT NULL THEN
   UPDATE cms_content_revisions SET payload=p_payload, validation_summary='{}', draft_edit_version=draft_edit_version+1, created_at=now(), base_published_version=p_base
    WHERE id=v_revision.id AND id=p_revision AND state='draft' AND draft_edit_version = p_edit AND (p_op='reconcile' OR base_published_version IS NOT DISTINCT FROM p_base) RETURNING * INTO v_revision;
   GET DIAGNOSTICS v_count=ROW_COUNT;
   IF v_count<>1 THEN RAISE EXCEPTION 'CMS_REVISION_CONFLICT'; END IF;
  ELSE
   IF p_op='reconcile' OR p_edit IS NOT NULL OR p_revision IS NOT NULL THEN RAISE EXCEPTION 'CMS_REVISION_CONFLICT'; END IF;
   INSERT INTO cms_content_revisions(resource_type,resource_id,version_number,state,payload,base_published_version,created_by)
    VALUES(p_type,p_id,v_next,'draft',p_payload,p_base,p_actor) RETURNING * INTO v_revision;
  END IF;
  v_action=CASE WHEN p_op='reconcile' THEN 'cms_draft_reconciled' ELSE 'cms_draft_saved' END;
 ELSIF p_op='restore' THEN
  SELECT * INTO v_source FROM cms_content_revisions WHERE id=p_revision AND resource_type=p_type AND resource_id=p_id AND state<>'draft';
  IF v_source.id IS NULL THEN RAISE EXCEPTION 'CMS_REVISION_NOT_FOUND'; END IF;
  IF p_type='article' THEN PERFORM blog_assert_article(p_id,v_source.payload); END IF;
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
  IF p_type='article' THEN PERFORM blog_assert_article(p_id,v_revision.payload); END IF;
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
      true, CASE WHEN NOT EXISTS(SELECT 1 FROM articles WHERE id=resource_id) AND payload->>'published_at' IS NULL THEN now()
       WHEN payload ? 'published_at' THEN (payload->>'published_at')::timestamptz ELSE (SELECT published_at FROM articles WHERE id=resource_id) END, payload->>'seo_title', payload->>'seo_description' FROM cms_content_revisions WHERE id = v_revision.id
    ON CONFLICT (id) DO UPDATE SET slug=EXCLUDED.slug, title=EXCLUDED.title, excerpt=EXCLUDED.excerpt,
      content=EXCLUDED.content, cover_image=EXCLUDED.cover_image, category=EXCLUDED.category,
      reading_minutes=EXCLUDED.reading_minutes, published=true, published_at=EXCLUDED.published_at,
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
  SELECT * INTO v_source FROM cms_content_revisions WHERE resource_type=p_type AND resource_id=p_id
   AND (p_type<>'article' OR state='published') ORDER BY (state='published') DESC,version_number DESC LIMIT 1;
  IF v_source.id IS NULL THEN RAISE EXCEPTION 'CMS_RESOURCE_NOT_FOUND'; END IF;
  INSERT INTO cms_content_revisions(resource_type,resource_id,version_number,state,payload,base_published_version,created_by)
   VALUES(p_type,p_id,v_next,'archived',v_source.payload,v_current,p_actor) RETURNING * INTO v_revision;
  v_table=CASE p_type WHEN 'estate' THEN 'estates' WHEN 'article' THEN 'articles' WHEN 'video' THEN 'cms_videos' WHEN 'faq' THEN 'faqs' ELSE 'media_assets' END;
  IF p_type='media' THEN UPDATE media_assets SET archived_at=now() WHERE id=p_id;
  ELSE EXECUTE format('UPDATE %I SET published=false WHERE id=$1',v_table) USING p_id; END IF;
  IF p_type='article' THEN PERFORM blog_assert_article(p_id,v_revision.payload); END IF;
  UPDATE cms_content_revisions SET state='superseded' WHERE resource_type=p_type AND resource_id=p_id AND state='published';
  IF p_type<>'article' THEN
   UPDATE cms_content_revisions SET draft_retired_at=now() WHERE resource_type=p_type AND resource_id=p_id AND state='draft' AND draft_retired_at IS NULL;
  END IF;
  v_action='cms_archived';
 END IF;
 IF p_type='article' THEN PERFORM blog_prune_features(p_id,p_actor); END IF;
 INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata)
  VALUES(p_actor,v_action,p_type,p_id,jsonb_build_object('revisionId',v_revision.id,'restoredFromRevisionId',v_revision.restored_from_revision_id,'draftEditVersion',v_revision.draft_edit_version));
 v_result:=to_jsonb(v_revision) || jsonb_build_object('current_published_version',v_current);
 IF v_command IS NOT NULL THEN
  INSERT INTO blog_mutation_requests(request_id,actor_id,operation,fingerprint,command,result)
   VALUES((p_payload->>'requestId')::uuid,p_actor,p_op,encode(sha256(convert_to(v_command::text,'UTF8')),'hex'),v_command,v_result);
 END IF;
 RETURN v_result;
END $$;


CREATE OR REPLACE FUNCTION blog_project_article_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE category_key text;
BEGIN
 IF NEW.resource_type='article' AND NEW.state='published' AND OLD.state='draft' THEN
  IF NEW.payload ? 'category_id' AND NEW.payload->>'category_id' IS NOT NULL THEN
   SELECT key INTO STRICT category_key FROM blog_categories WHERE id=(NEW.payload->>'category_id')::uuid;
  ELSE
   category_key := CASE WHEN NEW.payload ? 'category_id' THEN NULL ELSE NEW.payload->>'category' END;
  END IF;
  UPDATE articles SET
   category=CASE WHEN NEW.payload ? 'category_id' THEN category_key ELSE category END,
   category_id=CASE WHEN NEW.payload ? 'category_id' THEN (NEW.payload->>'category_id')::uuid ELSE category_id END,
   content=NEW.payload->>'content',
   content_format=CASE WHEN NEW.payload ? 'content_format' THEN NEW.payload->>'content_format' ELSE 'legacy-text' END,
   cover_alt=CASE WHEN NEW.payload ? 'cover_alt' THEN NEW.payload->>'cover_alt' ELSE cover_alt END,
   supplemental_links=CASE WHEN NEW.payload ? 'supplemental_links' THEN NEW.payload->'supplemental_links' ELSE supplemental_links END,
   editorial_metadata=CASE WHEN NEW.payload ? 'editorial_metadata' THEN NEW.payload->'editorial_metadata' ELSE editorial_metadata END,
   version=NEW.version_number
  WHERE id=NEW.resource_id;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION blog_save_article(p_actor uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE prior blog_mutation_requests%ROWTYPE; rid uuid; current_doc jsonb; result jsonb; revision jsonb; op text; should_publish boolean;
BEGIN
 PERFORM blog_require_actor(p_actor,p_command->>'action' NOT IN ('save','reconcile'));
 PERFORM blog_lock();
 SELECT * INTO prior FROM blog_mutation_requests WHERE request_id=(p_command->>'requestId')::uuid;
 IF prior.request_id IS NOT NULL THEN
  IF prior.actor_id IS DISTINCT FROM p_actor OR prior.operation IS DISTINCT FROM p_command->>'action' OR prior.command IS DISTINCT FROM p_command THEN RAISE EXCEPTION 'BLOG_IDEMPOTENCY_CONFLICT'; END IF;
  RETURN prior.result;
 END IF;
 rid:=coalesce((p_command->>'id')::uuid,gen_random_uuid()); op:=p_command->>'action';
 IF op NOT IN ('save','publish','unpublish','reconcile') THEN RAISE EXCEPTION 'BLOG_VALIDATION'; END IF;
 IF p_command->>'id' IS NOT NULL THEN
  current_doc:=blog_article_document(rid,p_actor);
  IF current_doc->'editState' IS DISTINCT FROM p_command->'editState' OR current_doc->'version' IS DISTINCT FROM p_command->'expectedVersion' THEN RAISE EXCEPTION 'BLOG_REVISION_CONFLICT'; END IF;
 END IF;
 should_publish:=op='publish' OR (op='save' AND coalesce((current_doc->>'published')::boolean,false) AND EXISTS(SELECT 1 FROM staff_roles WHERE staff_user_id=p_actor AND role::text IN ('admin','manager')));
 IF should_publish OR op='unpublish' THEN PERFORM blog_require_actor(p_actor,true); END IF;
 -- Explicit action owns publication. input.published is never used to grant publication.
 revision:=cms_mutate(CASE WHEN op='reconcile' THEN 'reconcile' ELSE 'save' END,'article',rid,p_actor,p_command->'payload',
  (p_command->'editState'->>CASE WHEN op='reconcile' THEN 'currentPublishedVersion' ELSE 'basePublishedVersion' END)::integer,(p_command->'editState'->>'draftEditVersion')::integer,
  (p_command->'editState'->>'draftRevisionId')::uuid);
 IF should_publish THEN
  revision:=cms_mutate('publish','article',rid,p_actor,NULL,(revision->>'base_published_version')::integer,(revision->>'draft_edit_version')::integer,(revision->>'id')::uuid);
 ELSIF op='unpublish' THEN
  -- Preserve edited content privately while the live projection is withdrawn.
  current_doc:=blog_article_document(rid,p_actor);
  PERFORM cms_mutate('archive','article',rid,p_actor,jsonb_build_object('requestId',gen_random_uuid(),'editState',current_doc->'editState','expectedVersion',current_doc->'version'));
  -- Only the submitting author's explicitly saved draft follows this withdrawal.
  -- Other authors retain their content and old base until explicit reconciliation.
  revision:=cms_mutate('reconcile','article',rid,p_actor,p_command->'payload',NULL,(revision->>'draft_edit_version')::int,(revision->>'id')::uuid);
 END IF;
 result:=blog_article_document(rid,p_actor);
 INSERT INTO blog_mutation_requests(request_id,actor_id,operation,fingerprint,command,result)
  VALUES((p_command->>'requestId')::uuid,p_actor,op,encode(sha256(convert_to(p_command::text,'UTF8')),'hex'),p_command,result);
 RETURN result;
END $$;
