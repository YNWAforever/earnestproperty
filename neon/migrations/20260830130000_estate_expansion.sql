-- P4 Task 2 (docs/superpowers/plans/2026-08-30-frontend-revamp-p4-areas-estates.md):
-- infrastructure for the client's 17-estate expansion, landing the DB rows and
-- schema ahead of any verified facts or photos. Every one of the 17 rows
-- inserted below ships `published = false` -- the master plan's own publish
-- gate is "verified facts + a real photo; no photo or no facts -> stays
-- published = false", and this session has neither for any of them. Writing
-- this migration is the deliverable; publishing is a later, data-only change
-- once the client supplies real content. This session has a live,
-- reachable DATABASE_URL and does NOT apply this migration -- applying it is
-- someone else's later step.

-- ---------------------------------------------------------------------------
-- 1. districts table
-- ---------------------------------------------------------------------------
-- estates.district_slug (below) has always been a bare TEXT column with no
-- referential integrity -- a typo there silently creates a "district" that
-- joins nothing. This table gives district identity a real row without
-- removing district_slug itself (see step 3's comment for why the TEXT
-- column stays). Seeded only with the four district slugs that genuinely
-- appear in live estates/properties data today, per
-- corridorRegionScope.districtSlugs (src/content/castle-peak-road.ts) minus
-- "yau-kom-tau" -- that file's own comments confirm the MLS normalizer never
-- assigns "yau-kom-tau" to any real row (油柑頭 stock actually normalises to
-- "tsuen-wan" and is recovered via textAliases instead), so seeding a
-- district for it would create a row nothing will ever reference.
CREATE TABLE IF NOT EXISTS districts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name_zh TEXT NOT NULL,
  name_en TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- name_zh values match how each district is already labelled elsewhere in
-- this repo (castle-peak-road.ts's segment copy, district.sham-tseng.tsx's
-- H1, estate-registry.ts's homepageDistrict) -- not new facts, just giving
-- an existing label a row. name_en likewise mirrors existing bilingual
-- headings/titles already in the repo (e.g. castle-peak-road.ts:74's
-- "青山公路 Castle Peak Road", district.sham-tseng.tsx's "深井 Sham Tseng",
-- castle-peak-road.ts's "Ting Kau" segment copy) except tsing-lung-tau,
-- whose English form is the standard, mechanical de-hyphenation of its own
-- slug (not a fact that could be wrong, unlike an estate's district).
INSERT INTO districts (slug, name_zh, name_en) VALUES
  ('sham-tseng', '深井', 'Sham Tseng'),
  ('castle-peak-road', '青山公路', 'Castle Peak Road'),
  ('ting-kau', '汀九', 'Ting Kau'),
  ('tsing-lung-tau', '青龍頭', 'Tsing Lung Tau')
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. estates.district_id -- additive FK column (backfilled in step 6, after
--    the 17 new rows below exist, so the same UPDATE covers old and new rows
--    in one pass instead of missing the ones inserted later in this file)
-- ---------------------------------------------------------------------------
ALTER TABLE estates
  ADD COLUMN IF NOT EXISTS district_id UUID REFERENCES districts(id);

-- ---------------------------------------------------------------------------
-- 3. estates.district_slug -> nullable
-- ---------------------------------------------------------------------------
-- Three of the 17 estates inserted below (帝華軒、海韻台、龍騰閣) have a
-- genuinely unknown district -- nobody has supplied it, and nothing else in
-- this repo names it. The master plan is explicit that a district "must not
-- be guessed"; writing a placeholder string into a NOT NULL column would BE
-- guessing. Relaxing the constraint is the only option that doesn't
-- fabricate a fact. Must run before step 5's INSERT, which writes NULL into
-- this column for those three rows.
--
-- Verified safe before running this (grepped every consumer of
-- estates.district_slug / NeonEstateSnapshot.district_slug in src/):
--   - Every DB-boundary reader already converts it through
--     stringOrEmpty()/stringOrNull() before it reaches app code:
--     src/lib/neon/public-data.server.ts's mapListingRow (estate_district_slug),
--     src/lib/neon/admin-data.server.ts's listAdminEstateOptions/listAdminCms,
--     src/lib/ai/knowledge.server.ts's fetchPublicKnowledgeSources,
--     src/lib/ai/content-copilot-context.server.ts's mapResource
--     (`row[field] ?? null`). None of these throw on NULL; they degrade to
--     "" or null the same way every other optional estate fact already does.
--   - src/lib/queries.ts's EstateSummary.district_slug and
--     EstateRecord.district_slug are ALREADY typed `string | null` --
--     the public estate page's own types anticipated this.
--   - isWithinCorridorRegion() (src/content/castle-peak-road.ts) types
--     estateDistrictSlug as `string | null | undefined` and guards every use
--     with a truthy check before comparing it.
--   - SQL predicates that compare estate.district_slug (admin-data.server.ts:779,
--     src/lib/ai/segments.server.ts:83-84) use it inside an `OR`; standard
--     SQL NULL semantics make `estate.district_slug = $n` evaluate to
--     false/no-match rather than erroring, and the sibling `p.district_slug`
--     predicate (properties' own column, NOT relaxed by this migration,
--     still NOT NULL) still applies.
--   - The admin CMS estate form (src/routes/admin.cms.tsx's handleSaveEstate)
--     independently requires a non-empty district_slug before it will save
--     an estate at all -- editing one of the 3 unknown-district rows through
--     the CMS is blocked with a toast, not silently written or crashed.
-- estates.district_slug stays a plain nullable TEXT column, not dropped --
-- every one of those readers still expects the column to exist.
ALTER TABLE estates
  ALTER COLUMN district_slug DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. estates -- new nullable columns for the eventual verified-facts block
-- ---------------------------------------------------------------------------
-- All additive and all nullable: no verified value exists yet for any of
-- them, on any of the 17 rows below or the 5 pre-existing rows, so there is
-- nothing to backfill.
ALTER TABLE estates
  ADD COLUMN IF NOT EXISTS aliases TEXT[],
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS blocks INT,
  ADD COLUMN IF NOT EXISTS school_net_code TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transport_note TEXT;

-- ---------------------------------------------------------------------------
-- 5. Insert the 17 estates -- published = false, identity fields only
-- ---------------------------------------------------------------------------
-- Every fact column (developer, year_completed, total_units, area_min/max,
-- avg_saleable_psf, description, hero_image, facilities, lat/lng, address,
-- blocks, school_net_code, verified_at, transport_note) is left NULL --
-- there is no verified source for any of them this session. `published` is
-- set explicitly to `false` on every row despite the column's own
-- `DEFAULT true` (see 20260711090000_cms_content_revisions.sql) -- relying
-- on the default here would be one accidental column-list slip away from
-- silently publishing 17 fact-less, photo-less estates.
--
-- Slugs below are PROVISIONAL -- not yet confirmed as permanent public URLs
-- (open input #2 in the master plan, unresolved). They are a deterministic,
-- reviewable transliteration of each estate's name (English name ->
-- kebab-case where one exists; Chinese-only name -> a straightforward
-- Cantonese romanization -- there is no existing romanization table in this
-- repo to match against). Safe to rename freely while published = false,
-- since nothing links to them publicly yet.
--
-- district_slug is populated for 14 of the 17 rows:
--   - 海雲軒 / 縉皇居 already carry `homepageDistrict: "汀九"` in
--     estate-registry.ts (Task 1), grounded in real evidence elsewhere in
--     this repo (both names already appear in castle-peak-road.ts's
--     ting-kau segment's featuredEstates/textAliases). "ting-kau" is the
--     real district_slug that "汀九" already names in this codebase, not a
--     new guess.
--   - The 12 青山公路 estates get district_slug = 'castle-peak-road', the
--     real, already-live district_slug value that name already maps to
--     elsewhere (src/lib/neon/corridor-scope.contract.test.mjs's fixture
--     rows use district_slug: "castle-peak-road" for 黃金海岸 itself, among
--     others).
--   - 帝華軒、海韻台、龍騰閣 get NULL -- no district evidence exists anywhere
--     in this repo for these three, and the master plan explicitly forbids
--     guessing one.
--
-- The Carmel / Oma Oma: the master plan gives only one name for each, and it
-- is already Latin-script -- there is no separate Chinese name to pair it
-- with. name_zh is NOT NULL, so it holds this same given name (the only
-- value known); name_en stays NULL rather than duplicating the same string
-- into a second column, which would look like a genuine zh/en translation
-- pair when none was ever supplied.
INSERT INTO estates (slug, name_zh, name_en, district_slug, published) VALUES
  -- 深井／汀九 (5) -- 海雲軒/帝華軒/海韻台/縉皇居/龍騰閣 already exist as
  -- inert, DB-less entries in estate-registry.ts as of Task 1; these are
  -- their first real DB rows, not duplicates.
  ('hoi-wan-hin', '海雲軒', NULL, 'ting-kau', false),
  ('tai-wah-hin', '帝華軒', NULL, NULL, false),
  ('hoi-wan-toi', '海韻台', NULL, NULL, false),
  ('chun-wong-kui', '縉皇居', NULL, 'ting-kau', false),
  ('lung-tang-kok', '龍騰閣', NULL, NULL, false),
  -- 青山公路 (12) -- per D2, this group stays out of corridorRegionScope /
  -- estate-registry.ts's corridorSegment even once published later; encoded
  -- in the registry (Task 1's file), not here.
  ('mun-ming-shan', '滿名山', NULL, 'castle-peak-road', false),
  ('wong-gam-hoi-ngon', '黃金海岸', NULL, 'castle-peak-road', false),
  ('oi-kam-hoi-ngon', '愛琴海岸', NULL, 'castle-peak-road', false),
  ('tai-yu', '帝御', NULL, 'castle-peak-road', false),
  ('wong-gam-hoi-waan', '黃金海灣', NULL, 'castle-peak-road', false),
  ('sing-tai', '星堤', NULL, 'castle-peak-road', false),
  ('seong-yuen', '上源', NULL, 'castle-peak-road', false),
  ('the-carmel', 'The Carmel', NULL, 'castle-peak-road', false),
  ('oma-oma', 'Oma Oma', NULL, 'castle-peak-road', false),
  ('lin-shan', '漣山', NULL, 'castle-peak-road', false),
  ('long-tou-waan', '浪濤灣', NULL, 'castle-peak-road', false),
  ('tai-tou-waan', '帝濤灣', NULL, 'castle-peak-road', false)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Backfill district_id from district_slug -- covers both the 5
--    pre-existing rows and the 17 rows just inserted above in one pass.
-- ---------------------------------------------------------------------------
UPDATE estates
SET district_id = districts.id
FROM districts
WHERE estates.district_slug = districts.slug
  AND estates.district_id IS NULL;
