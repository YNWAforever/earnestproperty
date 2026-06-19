ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS source_site TEXT,
  ADD COLUMN IF NOT EXISTS legacy_detail_id TEXT,
  ADD COLUMN IF NOT EXISTS legacy_property_no TEXT,
  ADD COLUMN IF NOT EXISTS legacy_url TEXT,
  ADD COLUMN IF NOT EXISTS legacy_source_indexes TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_scraped_at TIMESTAMPTZ;

ALTER TABLE public.properties
  DROP CONSTRAINT IF EXISTS properties_legacy_detail_id_key;

ALTER TABLE public.properties
  DROP CONSTRAINT IF EXISTS properties_legacy_detail_deal_type_key;

ALTER TABLE public.properties
  ADD CONSTRAINT properties_legacy_detail_deal_type_key UNIQUE (legacy_detail_id, deal_type);

CREATE INDEX IF NOT EXISTS idx_properties_legacy_property_no
  ON public.properties (legacy_property_no);

CREATE INDEX IF NOT EXISTS idx_properties_source_site
  ON public.properties (source_site);
