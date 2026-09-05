-- Persist the irreversible provider boundary before writing any public Blob.
CREATE TABLE media_upload_intents (
  id UUID PRIMARY KEY,
  created_by UUID NOT NULL REFERENCES staff_users(id),
  fingerprint TEXT NOT NULL,
  pathname TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  owner_type TEXT NOT NULL,
  url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
ALTER TABLE media_assets ADD COLUMN upload_intent_id UUID UNIQUE REFERENCES media_upload_intents(id);
