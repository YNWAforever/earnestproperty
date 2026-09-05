-- Draft created_at tracks saves; browsing needs an insertion timestamp that saves never change.
ALTER TABLE cms_content_revisions ADD COLUMN IF NOT EXISTS browse_created_at timestamptz NOT NULL DEFAULT now();
