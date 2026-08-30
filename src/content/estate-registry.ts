/**
 * DR-10 (docs/superpowers/plans/2026-08-28-frontend-revamp.md): estate identity
 * (slug, name, alias, district, corridor membership) used to be hand-duplicated
 * across six independent files -- core-estates.ts, seo.ts, estate-pages.ts,
 * queries.ts, castle-peak-road.ts, and the AI CRM layer (crm-rules.ts /
 * segments.ts). Each copy could drift from the others with nobody noticing.
 *
 * This file is the single source of truth for that identity. The six files
 * above now derive their slug/name/alias/legacy-slug/corridor-membership
 * fields from `estateRegistry` instead of re-typing them -- each file keeps
 * only the content genuinely its own (SEO copy, detail-page prose, CRM tag
 * heuristics, corridor zone copy).
 *
 * Deliberately NOT included here: castle-peak-road.ts's `featuredEstates`
 * (free-text display strings that include non-DB-backed names like
 * "觀海別墅" / "Vista Del Mar" -- not real estates at all) and `textAliases`
 * (which mix place names in with estate names). Those aren't estate identity,
 * they only look similar, so they stay their own curated arrays.
 *
 * This is a plain data module with no imports of its own, on purpose: several
 * tests (corridor-scope.contract.test.mjs, castle-peak-road.test.mjs) load
 * consumer files under Node's native TS stripping without a bundler, and rely
 * on this module being trivially inlinable.
 *
 * P4 Task 2 (docs/superpowers/plans/2026-08-30-frontend-revamp-p4-areas-estates.md)
 * added 17 more entries below for the client's estate expansion, backed by
 * real (but `published = false`, fact-less) rows from
 * neon/migrations/20260830130000_estate_expansion.sql. Five of those 17
 * (海雲軒/帝華軒/海韻台/縉皇居/龍騰閣) already existed here as inert,
 * DB-less entries from Task 1 -- that migration gives them a real DB row for
 * the first time, so their existing entries below are updated in place
 * rather than duplicated.
 */

export type CorridorSegmentSlug = "ting-kau" | "sham-tseng";

/**
 * The Chinese-language grouping label the client's homepage card list
 * (core-estates.ts) groups estates under. Distinct from `districtSlug` below,
 * which is the `estates` table's real `district_slug` column value -- the two
 * encode different things (a client-facing display grouping vs. a DB join
 * key) and disagree for at least one estate: 豪景花園 is grouped under
 * 青山公路 on the homepage card, but its `district_slug` row is "sham-tseng"
 * (see neon/migrations/20260622060000_public_content.sql).
 */
export type EstateHomepageDistrict = "深井" | "青山公路" | "汀九";

export type EstateRegistryEntry = {
  /** Canonical, current-day slug. Matches the `estates` table's `slug`
   * column for the five estates that already have a real DB row. */
  slug: string;
  nameZh: string;
  /**
   * `null` when the client has never supplied an English name -- true today
   * of every estate without a detail page. Guessing a transliteration would
   * put a false name on a real estate, which core-estates.ts's own
   * "districts are never guessed" test already guards against for district;
   * the same discipline applies here.
   */
  nameEn: string | null;
  /**
   * Every alternate spelling/abbreviation known to refer to this estate in
   * free text -- full Chinese and English names, short forms, and legacy
   * CRM shorthand (e.g. "LIDO GDN"). A superset of what seo.ts's
   * `estateAliases` record and segments.ts's prompt-matching regex list used
   * to hardcode independently; both now derive from this array.
   */
  aliases: string[];
  /**
   * A retired DB slug this estate's row was originally seeded under, before
   * a rename. queries.ts's `ESTATE_DB_SLUG_FALLBACKS` derives from this.
   */
  legacySlug?: string;
  /**
   * The `estates` table's real `district_slug` column value. `null` when no
   * DB row exists yet for this estate -- true today of every estate without
   * a detail page (P4's Task 2 gives some of them a real row later).
   */
  districtSlug: string | null;
  /**
   * Which castle-peak-road.ts corridor segment claims this estate's listings
   * as strict inventory (`segment.estateSlugs`). `null` for an estate with
   * no DB row yet -- membership here is about real, DB-joinable inventory,
   * not general geography (compare `homepageDistrict`, a display grouping
   * only, which can and does disagree).
   */
  corridorSegment: CorridorSegmentSlug | null;
  /**
   * `site-branches.js`'s `SITE_BRANCHES[].id` for the shopfront most closely
   * associated with this estate, where known. Informational only today; no
   * consumer joins on it yet.
   */
  branchId?: string;
  /** Whether a `/estate/$slug` detail page exists for this estate. */
  hasPage: boolean;
  /** Card photo path under `public/`, or `null` when none has been supplied. */
  photo: string | null;
  homepageDistrict: EstateHomepageDistrict | null;
};

export const estateRegistry: EstateRegistryEntry[] = [
  // The five estates with a real DB row and a /estate/$slug detail page.
  {
    slug: "bellagio",
    nameZh: "碧堤半島",
    nameEn: "Bellagio",
    aliases: ["碧堤半島", "碧堤", "Bellagio"],
    legacySlug: "belvedere-garden",
    districtSlug: "sham-tseng",
    corridorSegment: "sham-tseng",
    branchId: "lido",
    hasPage: true,
    photo: "/estates/bellagio.jpg",
    homepageDistrict: "深井",
  },
  {
    slug: "hong-kong-garden",
    nameZh: "豪景花園",
    nameEn: "Hong Kong Garden",
    aliases: ["豪景花園", "豪景", "Hong Kong Garden"],
    districtSlug: "sham-tseng",
    corridorSegment: "sham-tseng",
    branchId: "hong-kong-garden",
    hasPage: true,
    // TODO(client): 豪景花園 photo not supplied -- the other four arrived in 屋苑相/.
    photo: null,
    homepageDistrict: "青山公路",
  },
  {
    slug: "sea-crest-villa",
    nameZh: "浪翠園",
    nameEn: "Sea Crest Villa",
    aliases: ["浪翠園", "浪翠", "Sea Crest Villa", "Sea Crest"],
    districtSlug: "sham-tseng",
    corridorSegment: "sham-tseng",
    branchId: "lido",
    hasPage: true,
    photo: "/estates/sea-crest-villa.jpg",
    homepageDistrict: "深井",
  },
  {
    slug: "lido-garden",
    nameZh: "麗都花園",
    nameEn: "Lido Garden",
    aliases: ["麗都花園", "麗都", "Lido Garden", "Lido", "LIDO GDN"],
    districtSlug: "sham-tseng",
    corridorSegment: "sham-tseng",
    branchId: "lido",
    hasPage: true,
    photo: "/estates/lido-garden.jpg",
    homepageDistrict: "深井",
  },
  {
    slug: "rhine-garden",
    nameZh: "海韻花園",
    nameEn: "Rhine Garden",
    aliases: ["海韻花園", "海韻", "Rhine Garden", "Rhine"],
    legacySlug: "sea-pearl-garden",
    districtSlug: "sham-tseng",
    corridorSegment: "sham-tseng",
    branchId: "rhine",
    hasPage: true,
    photo: "/estates/rhine-garden.jpg",
    homepageDistrict: "深井",
  },

  // The five the client added (docx p13/p15) with no detail page, no figures
  // and no photo -- see core-estates.ts for why they still ship as
  // non-linking homepage cards instead of being omitted, and
  // src/routes/index.tsx's `linkableEstates` filter for why the homepage
  // grid itself never links them.
  {
    slug: "hoi-wan-hin",
    nameZh: "海雲軒",
    nameEn: null,
    aliases: ["海雲軒"],
    // P4 Task 2: real DB row now exists (estate_expansion.sql), district_slug
    // = "ting-kau" -- grounded in this estate already appearing in
    // castle-peak-road.ts's ting-kau segment's featuredEstates/textAliases,
    // not a new guess.
    districtSlug: "ting-kau",
    // Still null despite the real district_id: corridorSegment means real,
    // DB-joinable STRICT inventory for a published, verified estate, and this
    // row is `published = false` with no facts yet (per D2/the master plan's
    // publish gate). Not counted in castle-peak-road.ts's ting-kau segment's
    // estateSlugs for the same reason. It already appears in that segment's
    // featuredEstates/textAliases (free-text display + matching, not
    // identity data) -- see castle-peak-road.ts for why those stay their own
    // curated arrays.
    corridorSegment: null,
    hasPage: false,
    photo: null,
    homepageDistrict: "汀九",
  },
  {
    slug: "tai-wah-hin",
    nameZh: "帝華軒",
    nameEn: null,
    aliases: ["帝華軒"],
    // P4 Task 2: real DB row now exists (estate_expansion.sql), but
    // district_slug is NULL there too -- still no reference anywhere in this
    // repo for this estate's district, and the master plan explicitly
    // forbids guessing one.
    districtSlug: null,
    corridorSegment: null,
    hasPage: false,
    photo: null,
    // TODO(client): district unknown -- no reference anywhere in the repo.
    homepageDistrict: null,
  },
  {
    slug: "hoi-wan-toi",
    nameZh: "海韻台",
    nameEn: null,
    aliases: ["海韻台"],
    // P4 Task 2: real DB row now exists (estate_expansion.sql), but
    // district_slug is NULL there too -- see tai-wah-hin's comment above.
    districtSlug: null,
    corridorSegment: null,
    hasPage: false,
    photo: null,
    // TODO(client): district unknown. Do not assume it follows 海韻花園 just
    // because the names share 海韻.
    homepageDistrict: null,
  },
  {
    slug: "chun-wong-kui",
    nameZh: "縉皇居",
    nameEn: null,
    aliases: ["縉皇居"],
    // P4 Task 2: real DB row now exists (estate_expansion.sql), district_slug
    // = "ting-kau" -- see hoi-wan-hin's comment above; the same grounding
    // applies to 縉皇居.
    districtSlug: "ting-kau",
    corridorSegment: null,
    hasPage: false,
    photo: null,
    // As with 海雲軒, the corridor registry already places 縉皇居 in 油柑頭 / 汀九.
    homepageDistrict: "汀九",
  },
  {
    slug: "lung-tang-kok",
    nameZh: "龍騰閣",
    nameEn: null,
    aliases: ["龍騰閣"],
    // P4 Task 2: real DB row now exists (estate_expansion.sql), but
    // district_slug is NULL there too -- see tai-wah-hin's comment above.
    districtSlug: null,
    corridorSegment: null,
    hasPage: false,
    photo: null,
    // TODO(client): district unknown -- no reference anywhere in the repo.
    homepageDistrict: null,
  },

  // P4 Task 2: the 12 青山公路 estates from the client's 17-estate expansion.
  // None have a homepage card (core-estates.ts's CLIENT_ORDER_SLUGS is
  // unchanged by this task, still exactly the original 10 slugs) -- unlike
  // the five entries above, `homepageDistrict: null` here means "no homepage
  // card exists yet", not "district unknown" (their real district_slug IS
  // known: "castle-peak-road", see each row's comment). Per D2, this group
  // stays out of corridorRegionScope / corridorSegment even once published,
  // so corridorSegment is a deliberate `null`, not a placeholder to fix
  // later.
  {
    slug: "mun-ming-shan",
    nameZh: "滿名山",
    nameEn: null,
    aliases: ["滿名山"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: false,
    photo: null,
    homepageDistrict: null,
  },
  {
    slug: "wong-gam-hoi-ngon",
    nameZh: "黃金海岸",
    nameEn: null,
    aliases: ["黃金海岸"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: false,
    photo: null,
    homepageDistrict: null,
  },
  {
    slug: "oi-kam-hoi-ngon",
    nameZh: "愛琴海岸",
    nameEn: null,
    aliases: ["愛琴海岸"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: false,
    photo: null,
    homepageDistrict: null,
  },
  {
    slug: "tai-yu",
    nameZh: "帝御",
    nameEn: null,
    aliases: ["帝御"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: false,
    photo: null,
    homepageDistrict: null,
  },
  {
    slug: "wong-gam-hoi-waan",
    nameZh: "黃金海灣",
    nameEn: null,
    aliases: ["黃金海灣"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: false,
    photo: null,
    homepageDistrict: null,
  },
  {
    slug: "sing-tai",
    nameZh: "星堤",
    nameEn: null,
    aliases: ["星堤"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: false,
    photo: null,
    homepageDistrict: null,
  },
  {
    slug: "seong-yuen",
    nameZh: "上源",
    nameEn: null,
    aliases: ["上源"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: false,
    photo: null,
    homepageDistrict: null,
  },
  {
    slug: "the-carmel",
    // The master plan gives only one name, already Latin-script -- no
    // separate Chinese name to pair it with. nameZh holds the only value
    // known (satisfies the non-null type); nameEn stays null rather than
    // duplicating the same string, which would look like a genuine zh/en
    // translation pair when none was ever supplied. Matches the DB row.
    nameZh: "The Carmel",
    nameEn: null,
    aliases: ["The Carmel"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: false,
    photo: null,
    homepageDistrict: null,
  },
  {
    slug: "oma-oma",
    // Same reasoning as "The Carmel" above.
    nameZh: "Oma Oma",
    nameEn: null,
    aliases: ["Oma Oma"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: false,
    photo: null,
    homepageDistrict: null,
  },
  {
    slug: "lin-shan",
    nameZh: "漣山",
    nameEn: null,
    aliases: ["漣山"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: false,
    photo: null,
    homepageDistrict: null,
  },
  {
    slug: "long-tou-waan",
    nameZh: "浪濤灣",
    nameEn: null,
    aliases: ["浪濤灣"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: false,
    photo: null,
    homepageDistrict: null,
  },
  {
    slug: "tai-tou-waan",
    nameZh: "帝濤灣",
    nameEn: null,
    aliases: ["帝濤灣"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: false,
    photo: null,
    homepageDistrict: null,
  },
];

/**
 * Throws rather than returning `undefined` for an unknown slug: every call
 * site passes a slug it knows should exist (a literal, or one derived from
 * `estateRegistry` itself), so a miss means the registry and its caller have
 * drifted -- exactly the class of bug this file exists to make impossible.
 * Failing loudly at module-load time surfaces that immediately instead of
 * letting `undefined` propagate into rendered content.
 */
export function getEstateEntry(slug: string): EstateRegistryEntry {
  const entry = estateRegistry.find((candidate) => candidate.slug === slug);
  if (!entry) {
    throw new Error(`estate-registry: no entry for slug "${slug}"`);
  }
  return entry;
}

/** The subset of the registry with a real `/estate/$slug` detail page. */
export const estatesWithPage = estateRegistry.filter((entry) => entry.hasPage);

/**
 * Slugs of every registry entry claimed by `segment` as strict, DB-joinable
 * inventory. castle-peak-road.ts's `CorridorSegment.estateSlugs` derives from
 * this instead of hardcoding the list.
 */
export function estateSlugsForCorridorSegment(
  segment: CorridorSegmentSlug,
): string[] {
  return estateRegistry
    .filter((entry) => entry.corridorSegment === segment)
    .map((entry) => entry.slug);
}

/**
 * P4 Task 5: up to `limit` other registry entries "near" `slug` -- sharing
 * its real `districtSlug` (the `estates` table's DB join key) or its
 * `corridorSegment` (strict, DB-joinable corridor inventory), whichever
 * matches. Always excludes `slug` itself -- an estate never compares against
 * itself. Order is the registry array's own order (stable, not random), so
 * the same input always yields the same output -- required for a
 * deterministic comparison table, not a cosmetic nicety.
 *
 * Most of the registry is sparse right now (17 of its 22 entries carry
 * `corridorSegment: null`, and 3 of those also carry `districtSlug: null` --
 * see each entry's own comment). An unknown slug, or an entry whose both
 * fields are `null`, simply matches nothing and returns `[]`; this never
 * throws, unlike `getEstateEntry`, because a UI comparison section degrading
 * to "nothing to show" is the correct behaviour here, not a bug to surface
 * loudly.
 */
export function findComparableEstates(
  slug: string,
  limit: number,
): EstateRegistryEntry[] {
  const current = estateRegistry.find((entry) => entry.slug === slug);
  if (!current) return [];

  return estateRegistry
    .filter((entry) => entry.slug !== slug)
    .filter((entry) => isComparableEntry(current, entry))
    .slice(0, limit);
}

function isComparableEntry(
  current: EstateRegistryEntry,
  entry: EstateRegistryEntry,
): boolean {
  const sameDistrict =
    current.districtSlug !== null &&
    entry.districtSlug === current.districtSlug;
  const sameCorridor =
    current.corridorSegment !== null &&
    entry.corridorSegment === current.corridorSegment;
  return sameDistrict || sameCorridor;
}
