-- Additive contracts only. cms_mutate remains the sole application article writer.
-- Proposed migration: deployment/application requires separate approval.
CREATE TABLE blog_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 key text NOT NULL UNIQUE,
 name text NOT NULL,
 navigation_order integer NOT NULL DEFAULT 0,
 hidden boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
-- Exact inventory mapping: deliberately no trimming, decoding, transliteration or key validation.
-- Invalid legacy keys remain inventory entries; new keys are validated at the application boundary.
CREATE TABLE blog_legacy_category_map (
 legacy_key text PRIMARY KEY,
 category_id uuid NOT NULL UNIQUE REFERENCES blog_categories(id)
);
INSERT INTO blog_categories(key,name)
 SELECT DISTINCT category,category FROM articles WHERE category IS NOT NULL;
INSERT INTO blog_legacy_category_map(legacy_key,category_id)
 SELECT key,id FROM blog_categories;

-- Preserve exact inventoried keys above, but never create the public main-page sentinel.
CREATE FUNCTION blog_category_key_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.key='全部' AND (TG_OP='INSERT' OR NEW.key IS DISTINCT FROM OLD.key) THEN
  RAISE EXCEPTION 'BLOG_VALIDATION_RESERVED_CATEGORY';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER blog_category_key_guard BEFORE INSERT OR UPDATE ON blog_categories
 FOR EACH ROW EXECUTE FUNCTION blog_category_key_guard();

-- Sole PageCopy owner. Category DTOs JOIN settings by category_id/scope_kind.
-- Combined metadata/copy edits must CAS category.version AND settings.version atomically.
CREATE TABLE blog_settings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 scope_kind text NOT NULL CHECK (scope_kind IN ('main','category')),
 category_id uuid REFERENCES blog_categories(id),
 heading text NOT NULL,
 introduction text NOT NULL DEFAULT '',
 seo_title text,
 seo_description text,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 CHECK ((scope_kind='main' AND category_id IS NULL) OR (scope_kind='category' AND category_id IS NOT NULL))
);
CREATE UNIQUE INDEX blog_settings_main_unique ON blog_settings(scope_kind) WHERE scope_kind='main';
CREATE UNIQUE INDEX blog_settings_category_unique ON blog_settings(category_id) WHERE scope_kind='category';
INSERT INTO blog_settings(scope_kind,heading) VALUES('main','樓市資訊');
INSERT INTO blog_settings(scope_kind,category_id,heading)
 SELECT 'category',id,name FROM blog_categories;

ALTER TABLE articles
 ADD COLUMN category_id uuid REFERENCES blog_categories(id),
 ADD COLUMN content_format text NOT NULL DEFAULT 'legacy-text' CHECK (content_format IN ('legacy-text','editor-json-v1')),
 ADD COLUMN cover_alt text,
 ADD COLUMN supplemental_links jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(supplemental_links)='array'),
 ADD COLUMN slug_locked boolean NOT NULL DEFAULT false,
 ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
-- Preserve all existing columns, timestamps and URLs, including unpublished imported rows.
UPDATE articles a SET slug_locked=true,
 category_id=(SELECT category_id FROM blog_legacy_category_map WHERE legacy_key=a.category),
 version=COALESCE((SELECT MAX(version_number) FROM cms_content_revisions r
   WHERE r.resource_type='article' AND r.resource_id=a.id AND r.state IN ('published','archived')),1);

CREATE TABLE blog_featured_articles (
 scope_id uuid NOT NULL REFERENCES blog_settings(id) ON DELETE CASCADE,
 article_id uuid NOT NULL REFERENCES articles(id),
 position integer NOT NULL CHECK (position >= 0),
 PRIMARY KEY(scope_id,article_id),
 UNIQUE(scope_id,position)
);

CREATE FUNCTION blog_article_contract_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.slug_locked AND NEW.slug IS DISTINCT FROM OLD.slug THEN
   RAISE EXCEPTION 'BLOG_SLUG_LOCKED';
  END IF;
  NEW.slug_locked := OLD.slug_locked OR NEW.slug_locked OR NEW.published;
  IF NEW.category IS DISTINCT FROM OLD.category AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id THEN
   NEW.category_id := (SELECT category_id FROM blog_legacy_category_map WHERE legacy_key=NEW.category);
  END IF;
 ELSE
  NEW.slug_locked := NEW.slug_locked OR NEW.published;
  IF NEW.category_id IS NULL THEN
   NEW.category_id := (SELECT category_id FROM blog_legacy_category_map WHERE legacy_key=NEW.category);
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER blog_article_contract_guard BEFORE INSERT OR UPDATE ON articles
 FOR EACH ROW EXECUTE FUNCTION blog_article_contract_guard();

-- Project supplemental fields in the SAME cms_mutate transaction, after its existing live upsert.
-- Content text is raw legacy text or JSON.stringify(editor document), paired with its format.
-- Unmarked historical content is legacy-text. Omitted supplemental links retain live values.
-- Explicit JSON null clears nullable fields; null/unknown content formats fail constraints.
-- This is not a second mutation entry point; no revision, permission, audit or CAS logic is replaced.
CREATE FUNCTION blog_project_article_revision() RETURNS trigger LANGUAGE plpgsql AS $$
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
   version=NEW.version_number
  WHERE id=NEW.resource_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER blog_project_article_revision AFTER UPDATE OF state ON cms_content_revisions
 FOR EACH ROW EXECUTE FUNCTION blog_project_article_revision();

-- No public/client write grants. Future category/settings/feature server mutations MUST check
-- active admin/manager publication authority and CAS versions; agents remain draft-only.
ALTER TABLE blog_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_legacy_category_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_featured_articles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON blog_categories,blog_legacy_category_map,blog_settings,blog_featured_articles FROM PUBLIC;
