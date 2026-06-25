CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  CREATE TYPE deal_type AS ENUM ('sale', 'rent');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE property_status AS ENUM ('draft', 'active', 'sold', 'rented', 'offline', 'inactive');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS estates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name_zh TEXT NOT NULL,
  name_en TEXT,
  district_slug TEXT NOT NULL,
  developer TEXT,
  year_completed INT,
  phases INT,
  total_units INT,
  area_min INT,
  area_max INT,
  avg_saleable_psf NUMERIC,
  description TEXT,
  hero_image TEXT,
  facilities TEXT[],
  lat NUMERIC,
  lng NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_no TEXT NOT NULL UNIQUE,
  title_zh TEXT NOT NULL,
  title_en TEXT,
  deal_type deal_type NOT NULL,
  estate_id UUID REFERENCES estates(id) ON DELETE SET NULL,
  district_slug TEXT NOT NULL,
  address TEXT,
  price NUMERIC,
  rent NUMERIC,
  saleable_area INT,
  gross_area INT,
  bedrooms INT,
  bathrooms INT,
  floor TEXT,
  orientation TEXT,
  management_fee NUMERIC,
  features TEXT[],
  description TEXT,
  images TEXT[],
  video_url TEXT,
  floorplan_url TEXT,
  status property_status NOT NULL DEFAULT 'draft',
  featured BOOLEAN NOT NULL DEFAULT false,
  source_site TEXT,
  legacy_detail_id TEXT,
  legacy_property_no TEXT,
  legacy_url TEXT,
  legacy_source_indexes TEXT[] NOT NULL DEFAULT '{}',
  source_url TEXT,
  source_updated_at DATE,
  last_seen_at TIMESTAMPTZ,
  last_scraped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT properties_legacy_detail_deal_type_key UNIQUE (legacy_detail_id, deal_type)
);

CREATE TABLE IF NOT EXISTS faqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT faqs_scope_question_key UNIQUE (scope, question)
);

CREATE TABLE IF NOT EXISTS articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT,
  content TEXT,
  cover_image TEXT,
  category TEXT,
  reading_minutes INT DEFAULT 5,
  published BOOLEAN NOT NULL DEFAULT true,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estate_id UUID REFERENCES estates(id) ON DELETE CASCADE,
  unit TEXT,
  deal_type deal_type NOT NULL,
  price NUMERIC,
  saleable_area INT,
  saleable_psf NUMERIC,
  deal_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'website',
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_properties_estate ON properties(estate_id);
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_district ON properties(district_slug);
CREATE INDEX IF NOT EXISTS idx_properties_legacy_property_no ON properties(legacy_property_no);
CREATE INDEX IF NOT EXISTS idx_properties_source_site ON properties(source_site);
CREATE INDEX IF NOT EXISTS idx_properties_last_seen_at ON properties(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_faqs_scope ON faqs(scope);
CREATE INDEX IF NOT EXISTS idx_transactions_estate ON transactions(estate_id);

INSERT INTO estates
  (slug, name_zh, name_en, district_slug, developer, year_completed, phases, total_units, area_min, area_max, avg_saleable_psf, description)
VALUES
  ('bellagio', '碧堤半島', 'Bellagio', 'sham-tseng', '會德豐 / 九龍倉', 2003, 3, 3345, 515, 1961, 9000, '碧堤半島（Bellagio）位於深井青山公路深井段 33 號，由會德豐 / 九龍倉發展，2003 至 2006 年分三期落成，共 8 座、約 3,345 個單位。'),
  ('sea-crest-villa', '浪翠園', 'Sea Crest Villa', 'sham-tseng', '新鴻基', 1992, 5, 2389, NULL, NULL, 8700, '浪翠園（Sea Crest Villa）由新鴻基地產發展，1992 至 1997 年分五期落成，共 15 座、約 2,389 個單位。'),
  ('hong-kong-garden', '豪景花園', 'Hong Kong Garden', 'sham-tseng', '華懋集團', 1986, 3, 2830, 358, 1382, 8500, '豪景花園（Hong Kong Garden）位於青山公路青龍頭段 100 號，由華懋集團發展，1986 至 1991 年分三期落成。'),
  ('rhine-garden', '海韻花園', 'Rhine Garden', 'sham-tseng', NULL, 1992, NULL, 1068, NULL, NULL, 8800, '海韻花園（Rhine Garden）位於深井青山公路臨海地段，1992 年底落成，提供約 1,068 個單位。'),
  ('lido-garden', '麗都花園', 'Lido Garden', 'sham-tseng', NULL, 1988, NULL, 1392, NULL, NULL, 8600, '麗都花園（Lido Garden）位於深井青山公路深井段，1988 年落成，提供約 1,392 個單位。')
ON CONFLICT (slug) DO UPDATE SET
  name_zh = EXCLUDED.name_zh,
  name_en = EXCLUDED.name_en,
  district_slug = EXCLUDED.district_slug,
  developer = EXCLUDED.developer,
  year_completed = EXCLUDED.year_completed,
  phases = EXCLUDED.phases,
  total_units = EXCLUDED.total_units,
  area_min = EXCLUDED.area_min,
  area_max = EXCLUDED.area_max,
  avg_saleable_psf = EXCLUDED.avg_saleable_psf,
  description = EXCLUDED.description,
  updated_at = now();

INSERT INTO faqs (scope, question, answer, sort_order)
VALUES
  ('district:sham-tseng', '深井適合自住定投資？', '深井以海景、會所、實用率及較市區低入場費吸引用家，同時租務需求穩定，適合自住及長線收租。', 1),
  ('district:sham-tseng', '深井去中環要幾耐？', '由深井乘搭巴士經青馬大橋及西區海底隧道直達中環約 35 分鐘，亦可轉乘荃灣或荃灣西鐵路。', 2),
  ('district:sham-tseng', '深井屬於哪個校網？', '深井小學校網為 62 校網，中學屬荃灣區校網。', 3)
ON CONFLICT (scope, question) DO NOTHING;
