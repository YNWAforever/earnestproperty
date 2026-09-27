-- Responsive WebP outputs for already owned MLS images. No existing media is rewritten.
CREATE TABLE IF NOT EXISTS media_variant_sets (
  asset_id uuid PRIMARY KEY REFERENCES media_assets(id) ON DELETE CASCADE,
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  source_url text NOT NULL,
  status text NOT NULL CHECK (status IN ('ready','unavailable','failed')),
  variant_count integer NOT NULL DEFAULT 0 CHECK (variant_count BETWEEN 0 AND 5),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS media_asset_variants (
  asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  width integer NOT NULL CHECK (width IN (160,320,640,960,1280)),
  url text NOT NULL CHECK (url ~ '^https://'),
  bytes bigint NOT NULL CHECK (bytes > 0),
  format text NOT NULL CHECK (format = 'webp'),
  PRIMARY KEY (asset_id, source_hash, width)
);
CREATE INDEX IF NOT EXISTS media_asset_variants_source_idx
  ON media_asset_variants(asset_id, source_hash);
