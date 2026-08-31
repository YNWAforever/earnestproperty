-- Populates facts for the 17-estate expansion (2026-08-30's
-- estate_expansion migration seeded these rows with everything but
-- slug/name/district NULL). Every value here is sourced and cited in
-- docs/superpowers/specs/assets/estate-expansion-17.data.json; a field left
-- NULL here has a genuine cross-source conflict documented in that estate's
-- own publishBlockers entry and is intentionally not guessed.
--
-- Never sets avg_saleable_psf, price, rent, listing counts, or transaction
-- data -- those stay dynamically computed from Neon/MLS. Never sets
-- published or verified_at -- those flip per-estate, by hand, only once
-- that estate individually clears the publish gate documented in
-- docs/superpowers/specs/2026-09-01-estate-expansion-17-design.md.

UPDATE estates SET
  address = '青山公路18A號',
  developer = '信和集團／嘉華國際',
  year_completed = 2004,
  blocks = 2,
  area_min = 469,
  area_max = 1427,
  school_net_code = '62'
WHERE slug = 'hoi-wan-hin';

UPDATE estates SET
  address = '龍騰路8號',
  developer = '新鴻基地產',
  year_completed = 1997,
  blocks = 2,
  total_units = 168,
  area_min = 1056,
  area_max = 1086,
  school_net_code = '62'
WHERE slug = 'tai-wah-hin';

UPDATE estates SET
  address = '青山公路深井段28號',
  developer = '安士嘉有限公司',
  year_completed = 1992,
  blocks = 1,
  total_units = 212,
  area_min = 598,
  area_max = 1487,
  school_net_code = '62'
WHERE slug = 'hoi-wan-toi';

UPDATE estates SET
  address = '深慈街8號',
  developer = '嘉里建設',
  year_completed = 2000,
  blocks = 3,
  total_units = 558,
  area_min = 653,
  area_max = 1609,
  school_net_code = '62'
WHERE slug = 'chun-wong-kui';

-- developer intentionally omitted -- publishBlockers: "發展商保持 NULL，
-- 待屋苑文件確認" (developer stays NULL pending estate-document confirmation).
UPDATE estates SET
  address = '青山公路青龍頭段88–90號',
  year_completed = 1981,
  blocks = 1,
  total_units = 48,
  area_min = 1743,
  area_max = 1958,
  school_net_code = '62'
WHERE slug = 'lung-tang-kok';

UPDATE estates SET
  address = '青盈路18、28及29號',
  developer = '嘉里建設',
  year_completed = 2017,
  blocks = 63,
  total_units = 1100,
  area_min = 308,
  area_max = 2877,
  school_net_code = '71'
WHERE slug = 'mun-ming-shan';

UPDATE estates SET
  address = '青山公路青山灣段1號',
  developer = '信和集團',
  year_completed = 1990,
  blocks = 30,
  total_units = 2168,
  area_min = 476,
  area_max = 2833,
  school_net_code = '71'
WHERE slug = 'wong-gam-hoi-ngon';

UPDATE estates SET
  address = '管青路2號',
  developer = '新鴻基地產／恒基兆業／陸海通',
  year_completed = 2002,
  blocks = 7,
  total_units = 1624,
  area_min = 490,
  area_max = 811,
  school_net_code = '71'
WHERE slug = 'oi-kam-hoi-ngon';

UPDATE estates SET
  address = '青山公路青山灣段8號',
  developer = '香港小輪／帝國集團',
  year_completed = 2022,
  blocks = 6,
  total_units = 1782,
  area_min = 184,
  area_max = 1376,
  school_net_code = '71'
WHERE slug = 'tai-yu';

UPDATE estates SET
  address = '青山公路青山灣段18號',
  developer = '旭日國際',
  year_completed = 2025,
  blocks = 6,
  total_units = 1323,
  area_min = 182,
  area_max = 1329,
  school_net_code = '71'
WHERE slug = 'wong-gam-hoi-waan';

-- area_max intentionally omitted -- publishBlockers: "最大實用面積有約
-- 2,766／4,054／4,484 呎差異，DB area_max 保持 NULL" (max saleable area
-- disputed across sources; stays NULL pending plan confirmation).
UPDATE estates SET
  address = '管翠路1號',
  developer = '新鴻基地產',
  year_completed = 2011,
  blocks = 40,
  total_units = 459,
  area_min = 554,
  school_net_code = '71'
WHERE slug = 'sing-tai';

-- blocks intentionally omitted -- publishBlockers: "座數有 5 座大廈／10 個
-- A-B 子座兩種口徑，DB blocks 保持 NULL" (block count disputed between two
-- counting conventions; stays NULL pending confirmation).
UPDATE estates SET
  address = '掃管笏路99號',
  developer = '萬科香港',
  year_completed = 2020,
  total_units = 1154,
  area_min = 321,
  area_max = 4880,
  school_net_code = '71'
WHERE slug = 'seong-yuen';

UPDATE estates SET
  address = '青山公路大欖段168號',
  developer = '永泰地產',
  year_completed = 2019,
  blocks = 50,
  total_units = 178,
  area_min = 260,
  area_max = 3998,
  school_net_code = '71'
WHERE slug = 'the-carmel';

UPDATE estates SET
  address = '掃管笏路108號',
  developer = '永泰地產',
  year_completed = 2021,
  blocks = 4,
  total_units = 466,
  area_min = 254,
  area_max = 1659,
  school_net_code = '71'
WHERE slug = 'oma-oma';

UPDATE estates SET
  address = '青發里9號',
  developer = '永泰地產／萬泰製衣',
  year_completed = 2002,
  blocks = 17,
  total_units = 216,
  area_min = 630,
  area_max = 1653,
  school_net_code = '71'
WHERE slug = 'lin-shan';

UPDATE estates SET
  address = '青發街28號',
  developer = '南豐',
  year_completed = 2002,
  blocks = 38,
  total_units = 242,
  area_min = 615,
  area_max = 2282,
  school_net_code = '71'
WHERE slug = 'long-tou-waan';

-- area_max intentionally omitted -- publishBlockers: "最大實用面積有 2,841／
-- 3,421 呎差異，DB area_max 保持 NULL" (max saleable area disputed across
-- sources; stays NULL pending plan/official-document confirmation).
UPDATE estates SET
  address = '小欖村路2號',
  developer = '新鴻基地產',
  year_completed = 1999,
  blocks = 9,
  total_units = 856,
  area_min = 670,
  school_net_code = '71'
WHERE slug = 'tai-tou-waan';
