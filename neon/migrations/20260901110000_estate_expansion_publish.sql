-- Publishes all 17 estates from the 2026-09-01 estate expansion
-- (20260830130000_estate_expansion.sql seeded them, 20260901100000_
-- estate_expansion_facts.sql populated their facts and corrected 5
-- district_slug values). This migration does exactly one thing: flips
-- published = true. It deliberately does NOT set the human-verification
-- timestamp column -- that column is a literal "a human confirmed this"
-- claim (estate.$slug.tsx's DataNote reads it that way), and none of
-- these 17 have actually been human-verified. The page already has a
-- graceful, honest fallback for that column left NULL
-- ("以上資料尚待人手覆核並標註核實日期"), so publishing without it is a
-- supported state, not a broken one.
--
-- Accepted, documented gaps at publish time (per
-- docs/superpowers/specs/2026-09-01-estate-publish-and-castle-peak-road-section-design.md):
-- every one of the 17 still has photo = NULL (falls back to the existing
-- gradient placeholder), and several facts columns stay NULL where the
-- 2026-09-01 data pack itself documented a genuine cross-source conflict
-- (renders as an em dash, never a fabricated number).

UPDATE estates SET published = true WHERE slug = 'hoi-wan-hin';
UPDATE estates SET published = true WHERE slug = 'tai-wah-hin';
UPDATE estates SET published = true WHERE slug = 'hoi-wan-toi';
UPDATE estates SET published = true WHERE slug = 'chun-wong-kui';
UPDATE estates SET published = true WHERE slug = 'lung-tang-kok';
UPDATE estates SET published = true WHERE slug = 'mun-ming-shan';
UPDATE estates SET published = true WHERE slug = 'wong-gam-hoi-ngon';
UPDATE estates SET published = true WHERE slug = 'oi-kam-hoi-ngon';
UPDATE estates SET published = true WHERE slug = 'tai-yu';
UPDATE estates SET published = true WHERE slug = 'wong-gam-hoi-waan';
UPDATE estates SET published = true WHERE slug = 'sing-tai';
UPDATE estates SET published = true WHERE slug = 'seong-yuen';
UPDATE estates SET published = true WHERE slug = 'the-carmel';
UPDATE estates SET published = true WHERE slug = 'oma-oma';
UPDATE estates SET published = true WHERE slug = 'lin-shan';
UPDATE estates SET published = true WHERE slug = 'long-tou-waan';
UPDATE estates SET published = true WHERE slug = 'tai-tou-waan';
