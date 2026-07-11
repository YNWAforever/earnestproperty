ALTER TABLE estates
  ADD COLUMN IF NOT EXISTS published boolean;

UPDATE estates
SET published = true
WHERE published IS NULL;

ALTER TABLE estates
  ALTER COLUMN published SET DEFAULT true,
  ALTER COLUMN published SET NOT NULL;

ALTER TABLE faqs
  ADD COLUMN IF NOT EXISTS published boolean;

UPDATE faqs
SET published = true
WHERE published IS NULL;

ALTER TABLE faqs
  ALTER COLUMN published SET DEFAULT true,
  ALTER COLUMN published SET NOT NULL;

ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE TABLE IF NOT EXISTS cms_content_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type text NOT NULL CHECK (resource_type IN ('estate', 'article', 'video', 'faq', 'media')),
  resource_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  state text NOT NULL CHECK (state IN ('draft', 'published', 'superseded', 'archived')),
  payload jsonb NOT NULL,
  validation_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  base_published_version integer,
  created_by uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  restored_from_revision_id uuid REFERENCES cms_content_revisions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (resource_type, resource_id, version_number)
);

CREATE INDEX IF NOT EXISTS cms_content_revisions_resource_idx
  ON cms_content_revisions (resource_type, resource_id, version_number DESC);

CREATE INDEX IF NOT EXISTS cms_content_revisions_state_idx
  ON cms_content_revisions (state, created_at DESC);

INSERT INTO cms_content_revisions (
  resource_type,
  resource_id,
  version_number,
  state,
  payload,
  published_at
)
SELECT 'estate', estate.id, 1, 'published', to_jsonb(estate) - 'created_at' - 'updated_at', now()
FROM estates AS estate
ON CONFLICT (resource_type, resource_id, version_number) DO NOTHING;

INSERT INTO cms_content_revisions (
  resource_type,
  resource_id,
  version_number,
  state,
  payload,
  published_at
)
SELECT 'article', article.id, 1, 'published', to_jsonb(article) - 'created_at' - 'updated_at', now()
FROM articles AS article
ON CONFLICT (resource_type, resource_id, version_number) DO NOTHING;

INSERT INTO cms_content_revisions (
  resource_type,
  resource_id,
  version_number,
  state,
  payload,
  published_at
)
SELECT 'video', video.id, 1, 'published', to_jsonb(video) - 'created_at' - 'updated_at', now()
FROM cms_videos AS video
ON CONFLICT (resource_type, resource_id, version_number) DO NOTHING;

INSERT INTO cms_content_revisions (
  resource_type,
  resource_id,
  version_number,
  state,
  payload,
  published_at
)
SELECT 'faq', faq.id, 1, 'published', to_jsonb(faq) - 'created_at' - 'updated_at', now()
FROM faqs AS faq
ON CONFLICT (resource_type, resource_id, version_number) DO NOTHING;

INSERT INTO cms_content_revisions (
  resource_type,
  resource_id,
  version_number,
  state,
  payload,
  published_at
)
SELECT 'media', media.id, 1, 'published', to_jsonb(media) - 'created_at' - 'updated_at', now()
FROM media_assets AS media
ON CONFLICT (resource_type, resource_id, version_number) DO NOTHING;
