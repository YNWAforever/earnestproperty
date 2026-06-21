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

INSERT INTO public.articles
  (slug, title, excerpt, content, category, reading_minutes, published)
VALUES
  (
    'sham-tseng-buying-guide-2026',
    '深井買樓全攻略 2026：5 大屋苑、呎價、校網、交通一次睇晒',
    '深井買樓睇呢篇就夠：碧堤半島、浪翠園、豪景花園、海韻花園、麗都花園逐個分析，連呎價、62 校網、去中環交通全攻略。',
    '想喺深井買樓，但唔知五大屋苑點揀、呎價幾多、校網又屬邊個網？呢篇由深井 hyperlocal 專家整理嘅 2026 全攻略，一次過幫你睇通深井樓市。' || E'\n\n' ||
    '深井位於新界荃灣西、青山公路沿線，背靠大欖郊野公園，面向汀九橋同青馬大橋海峽。佢最大賣點係同價海景，平過半山。' || E'\n\n' ||
    '碧堤半島適合預算充足、想要海景同會所嘅家庭；浪翠園適合上車及換樓；豪景花園適合想用上車價買三房；海韻花園適合海景行先；麗都花園適合入門上車同租住。',
    '買樓攻略',
    8,
    true
  ),
  (
    'bellagio-vs-sea-crest-villa-vs-hong-kong-garden',
    '碧堤半島 vs 浪翠園 vs 豪景花園：深井三大屋苑點揀好？',
    '碧堤半島、浪翠園、豪景花園三大深井屋苑點揀？由呎價、樓齡、海景、會所到適合人群逐項對比。',
    '深井三大屋苑成日令買家揀到頭痛。三個都係海景大社區，但定位差好遠。' || E'\n\n' ||
    '碧堤半島最新，會所同園林維護到位，俾人度假式感覺；浪翠園和豪景花園樓齡較長，勝在社區成熟、實用和入場門檻較低。' || E'\n\n' ||
    '想要最新、最強會所同海景，預算充足就睇碧堤半島；想要海景但預算有限就睇浪翠園；想用最抵價錢買到實用三房就睇豪景花園。',
    '屋苑比較',
    6,
    true
  )
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  excerpt = EXCLUDED.excerpt,
  content = EXCLUDED.content,
  category = EXCLUDED.category,
  reading_minutes = EXCLUDED.reading_minutes,
  published = EXCLUDED.published;
