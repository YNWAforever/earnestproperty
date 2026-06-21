UPDATE public.estates
SET slug = 'bellagio',
    name_en = 'Bellagio',
    developer = '會德豐 / 九龍倉',
    year_completed = 2003,
    phases = 3,
    total_units = 3345,
    area_min = 515,
    area_max = 1961,
    description = '碧堤半島（Bellagio）位於深井青山公路深井段 33 號，由會德豐 / 九龍倉發展，2003 至 2006 年分三期落成，共 8 座、約 3,345 個單位，係深井近海填海地段嘅地標屋苑。'
WHERE slug = 'belvedere-garden' OR name_zh = '碧堤半島';

UPDATE public.estates
SET name_en = 'Sea Crest Villa',
    developer = '新鴻基',
    year_completed = 1992,
    phases = 5,
    total_units = 2389,
    description = '浪翠園（Sea Crest Villa）由新鴻基地產發展，1992 至 1997 年分五期落成，共 15 座、約 2,389 個單位，係深井歷史最悠久嘅大型海景屋苑之一。'
WHERE slug = 'sea-crest-villa' OR name_zh = '浪翠園';

UPDATE public.estates
SET name_en = 'Hong Kong Garden',
    developer = '華懋集團',
    year_completed = 1986,
    phases = 3,
    total_units = 2830,
    area_min = 358,
    area_max = 1382,
    description = '豪景花園（Hong Kong Garden）位於青山公路青龍頭段 100 號，由華懋集團發展，1986 至 1991 年分三期落成，共 28 座、約 2,830 個單位。'
WHERE slug = 'hong-kong-garden' OR name_zh = '豪景花園';

UPDATE public.estates
SET slug = 'rhine-garden',
    name_en = 'Rhine Garden',
    year_completed = 1992,
    total_units = 1068,
    description = '海韻花園（Rhine Garden）位於深井青山公路臨海地段，1992 年底落成，提供約 1,068 個單位，是深井最貼近海岸線的屋苑之一。'
WHERE slug = 'sea-pearl-garden' OR name_zh = '海韻花園';

UPDATE public.estates
SET name_en = 'Lido Garden',
    year_completed = 1988,
    total_units = 1392,
    description = '麗都花園（Lido Garden）位於深井青山公路深井段，1988 年落成，提供約 1,392 個單位，是深井其中一個最早期嘅臨海屋苑，亦係晉誠地產門市所在地。'
WHERE slug = 'lido-garden' OR name_zh = '麗都花園';

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_updated_at DATE;

CREATE INDEX IF NOT EXISTS idx_properties_last_seen_at
  ON public.properties (last_seen_at);
