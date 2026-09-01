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
  /**
   * Attribution line for `photo`, required whenever the photo is CC-licensed
   * (Wikimedia Commons etc.) rather than client-supplied. Omitted (undefined)
   * for every client-supplied photo, since those need no credit. Rendered
   * next to the photo wherever it's shown, per the license's attribution
   * requirement.
   */
  photoCredit?: string;
  homepageDistrict: EstateHomepageDistrict | null;
  /**
   * Another estate's slug this one is a phase of (e.g. 帝華軒 is 浪翠園 Phase 5).
   * `null` for every estate that isn't a named phase of a different estate's
   * own registry entry. Informational only today -- no consumer joins on it
   * yet; added for 帝華軒/tai-wah-hin per the 2026-09-01 data pack.
   */
  parentEstateSlug: string | null;
  /**
   * Small text shown above the H1 on this estate's detail page
   * (`estate.$slug.tsx`). Was hardcoded to "深井屋苑獨立 SEO 頁" for every
   * estate; now per-estate so a 青山公路 estate doesn't claim to be a 深井 page.
   */
  heroEyebrow: string | null;
  /** The estate's own district/corridor guide link, used in the detail page's
   * breadcrumb JSON-LD. Was hardcoded to "/district/sham-tseng" for every
   * estate. */
  districtHref: string | null;
  /** Display label used in the detail page's WhatsApp CTA context
   * (`ctaContext.districtName`) -- e.g. "深井 / 青山公路" or "掃管笏". Was
   * hardcoded to "深井 / 青山公路" for every estate. */
  locationLabelZh: string | null;
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
    parentEstateSlug: null,
    heroEyebrow: "深井屋苑獨立 SEO 頁",
    districtHref: "/district/sham-tseng",
    locationLabelZh: "深井 / 青山公路",
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
    parentEstateSlug: null,
    heroEyebrow: "深井屋苑獨立 SEO 頁",
    districtHref: "/district/sham-tseng",
    locationLabelZh: "深井 / 青山公路",
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
    parentEstateSlug: null,
    heroEyebrow: "深井屋苑獨立 SEO 頁",
    districtHref: "/district/sham-tseng",
    locationLabelZh: "深井 / 青山公路",
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
    parentEstateSlug: null,
    heroEyebrow: "深井屋苑獨立 SEO 頁",
    districtHref: "/district/sham-tseng",
    locationLabelZh: "深井 / 青山公路",
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
    parentEstateSlug: null,
    heroEyebrow: "深井屋苑獨立 SEO 頁",
    districtHref: "/district/sham-tseng",
    locationLabelZh: "深井 / 青山公路",
  },

  // The five 深井／青龍頭 estates the client added (docx p13/p15). Estate
  // Expansion 17 (2026-09-01 data pack) gives all five a real detail page
  // (`hasPage: true`) and content, no photo yet -- see core-estates.ts for
  // why they still ship as non-linking homepage cards instead of being added
  // to CLIENT_ORDER_SLUGS, and src/routes/index.tsx's `linkableEstates`
  // filter for why the homepage grid itself never links them.
  {
    slug: "hoi-wan-hin",
    nameZh: "海雲軒",
    nameEn: "Anglers' Bay",
    aliases: ["海雲軒", "Anglers' Bay", "Anglers Bay", "ANGLERS BAY"],
    districtSlug: "sham-tseng",
    corridorSegment: null,
    hasPage: true,
    photo: null,
    homepageDistrict: "深井",
    parentEstateSlug: null,
    heroEyebrow: "深井／青龍頭屋苑獨立 SEO 頁",
    districtHref: "/district/sham-tseng",
    locationLabelZh: "深井／青龍頭",
  },
  {
    slug: "tai-wah-hin",
    nameZh: "帝華軒",
    nameEn: "Royal Sea Crest",
    aliases: [
      "帝華軒",
      "浪翠園5期",
      "浪翠園五期",
      "浪翠園帝華軒",
      "Royal Sea Crest",
      "Sea Crest Villa Phase 5",
    ],
    districtSlug: "tsing-lung-tau",
    corridorSegment: null,
    hasPage: true,
    photo: null,
    homepageDistrict: "深井",
    parentEstateSlug: "sea-crest-villa",
    heroEyebrow: "浪翠園五期屋苑獨立 SEO 頁",
    districtHref: "/castle-peak-road/sham-tseng",
    locationLabelZh: "青龍頭／深井",
  },
  {
    slug: "hoi-wan-toi",
    nameZh: "海韻臺",
    nameEn: "Rhine Terrace",
    aliases: ["海韻臺", "海韻台", "Rhine Terrace", "RHINE TERRACE"],
    districtSlug: "sham-tseng",
    corridorSegment: null,
    hasPage: true,
    photo: "/estates/hoi-wan-toi.jpg",
    photoCredit: "Exploringlife / Wikimedia Commons, CC BY-SA 4.0",
    homepageDistrict: "深井",
    parentEstateSlug: null,
    heroEyebrow: "深井單幢屋苑獨立 SEO 頁",
    districtHref: "/district/sham-tseng",
    locationLabelZh: "深井",
  },
  {
    slug: "chun-wong-kui",
    nameZh: "縉皇居",
    nameEn: "Ocean Pointe",
    aliases: ["縉皇居", "Ocean Pointe", "OCEAN POINTE"],
    districtSlug: "sham-tseng",
    corridorSegment: null,
    hasPage: true,
    photo: "/estates/chun-wong-kui.jpg",
    photoCredit: "Exploringlife / Wikimedia Commons, CC BY-SA 4.0",
    homepageDistrict: "深井",
    parentEstateSlug: null,
    heroEyebrow: "深井高層海景屋苑獨立 SEO 頁",
    districtHref: "/district/sham-tseng",
    locationLabelZh: "深井",
  },
  {
    slug: "lung-tang-kok",
    nameZh: "龍騰閣",
    nameEn: "Lung Tang Court",
    aliases: ["龍騰閣", "Lung Tang Court", "LUNG TANG COURT"],
    districtSlug: "tsing-lung-tau",
    corridorSegment: null,
    hasPage: true,
    photo: null,
    homepageDistrict: "深井",
    parentEstateSlug: null,
    heroEyebrow: "青龍頭低密度屋苑獨立 SEO 頁",
    districtHref: "/castle-peak-road/sham-tseng",
    locationLabelZh: "青龍頭",
  },

  // P4 Task 2: the 12 青山公路 estates from the client's 17-estate expansion.
  // None have a homepage card (core-estates.ts's CLIENT_ORDER_SLUGS is
  // unchanged by this task, still exactly the original 10 slugs) --
  // `homepageDistrict: null` here means "no homepage card exists yet", not
  // "district unknown" (their real district_slug IS known:
  // "castle-peak-road", see each row's own value). Per D2, this group stays
  // out of corridorRegionScope / corridorSegment even once published, so
  // corridorSegment is a deliberate `null`, not a placeholder to fix later.
  // nameEn/aliases/heroEyebrow/districtHref/locationLabelZh below are copied
  // verbatim from the 2026-09-01 data pack
  // (docs/superpowers/specs/assets/estate-expansion-17.data.json).
  {
    slug: "mun-ming-shan",
    nameZh: "滿名山",
    nameEn: "The Bloomsway",
    aliases: ["滿名山", "The Bloomsway", "BLOOMSWAY"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: "/estates/mun-ming-shan.jpg",
    photoCredit: "Fotointheworld / Wikimedia Commons, CC BY 4.0",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "掃管笏低密度屋苑獨立 SEO 頁",
    districtHref: "/castle-peak-road",
    locationLabelZh: "掃管笏",
  },
  {
    slug: "wong-gam-hoi-ngon",
    // Canonical display is 香港黃金海岸 per the 2026-09-01 data pack's naming
    // rule (distinct from the unrelated 黃金海灣/wong-gam-hoi-waan estate);
    // 黃金海岸 is kept as an alias below, not the display name.
    nameZh: "香港黃金海岸",
    nameEn: "Hong Kong Gold Coast",
    aliases: ["香港黃金海岸", "黃金海岸", "Hong Kong Gold Coast", "HK Gold Coast", "GOLD COAST"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: "/estates/wong-gam-hoi-ngon.jpg",
    photoCredit: "Minghong / Wikimedia Commons, CC BY-SA 4.0",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "青山灣海濱屋苑獨立 SEO 頁",
    districtHref: "/castle-peak-road",
    locationLabelZh: "青山灣／掃管笏",
  },
  {
    slug: "oi-kam-hoi-ngon",
    nameZh: "愛琴海岸",
    nameEn: "Aegean Coast",
    aliases: ["愛琴海岸", "Aegean Coast", "AEGEAN COAST"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: "/estates/oi-kam-hoi-ngon.jpg",
    photoCredit: "Wpcpey / Wikimedia Commons, CC BY 3.0",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "掃管笏成熟屋苑獨立 SEO 頁",
    districtHref: "/castle-peak-road",
    locationLabelZh: "掃管笏",
  },
  {
    slug: "tai-yu",
    nameZh: "帝御",
    nameEn: "The Royale",
    aliases: [
      "帝御",
      "The Royale",
      "THE ROYALE",
      "帝御金灣",
      "帝御‧金灣",
      "Seacoast Royale",
      "帝御星濤",
      "帝御‧星濤",
      "Starfront Royale",
      "帝御嵐天",
      "帝御‧嵐天",
      "Skypoint Royale",
    ],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: null,
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "青山灣較新屋苑獨立 SEO 頁",
    districtHref: "/castle-peak-road",
    locationLabelZh: "青山灣／掃管笏",
  },
  {
    slug: "wong-gam-hoi-waan",
    nameZh: "黃金海灣",
    nameEn: "Gold Coast Bay",
    aliases: [
      "黃金海灣",
      "Gold Coast Bay",
      "GOLD COAST BAY",
      "意嵐",
      "The Uppland",
      "珀岸",
      "The Reserve",
    ],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: null,
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "青山灣新式屋苑獨立 SEO 頁",
    districtHref: "/castle-peak-road",
    locationLabelZh: "青山灣",
  },
  {
    slug: "sing-tai",
    nameZh: "星堤",
    nameEn: "Avignon",
    aliases: ["星堤", "Avignon", "AVIGNON"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: "/estates/sing-tai.jpg",
    photoCredit: "Wpcpey / Wikimedia Commons, CC BY 3.0",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "掃管笏低密度屋苑獨立 SEO 頁",
    districtHref: "/castle-peak-road",
    locationLabelZh: "掃管笏",
  },
  {
    slug: "seong-yuen",
    nameZh: "上源",
    nameEn: "Le Pont",
    aliases: ["上源", "Le Pont", "LE PONT"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: null,
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "掃管笏大型低密度屋苑獨立 SEO 頁",
    districtHref: "/castle-peak-road",
    locationLabelZh: "掃管笏",
  },
  {
    slug: "the-carmel",
    // The master plan gives only one name, already Latin-script -- no
    // separate Chinese name to pair it with. nameZh holds the only value
    // known (satisfies the non-null type). The 2026-09-01 data pack does
    // supply a distinct nameEn value here (matches nameZh exactly, but is a
    // genuine field the data pack chose to populate rather than a guess).
    nameZh: "The Carmel",
    nameEn: "The Carmel",
    aliases: ["The Carmel", "THE CARMEL"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: null,
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "大欖低密度屋苑獨立 SEO 頁",
    districtHref: "/castle-peak-road",
    locationLabelZh: "大欖／掃管笏",
  },
  {
    slug: "oma-oma",
    // Same reasoning as "The Carmel" above -- the data pack's nameEn ("OMA
    // OMA") differs only in casing from nameZh ("Oma Oma"), still a genuine
    // supplied value, not a guess.
    nameZh: "Oma Oma",
    nameEn: "OMA OMA",
    aliases: ["OMA OMA", "Oma Oma", "oma oma"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: null,
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "掃管笏較新屋苑獨立 SEO 頁",
    districtHref: "/castle-peak-road",
    locationLabelZh: "掃管笏",
  },
  {
    slug: "lin-shan",
    nameZh: "漣山",
    nameEn: "The Hillgrove",
    aliases: ["漣山", "The Hillgrove", "HILLGROVE"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: null,
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖低密度屋苑獨立 SEO 頁",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖",
  },
  {
    slug: "long-tou-waan",
    nameZh: "浪濤灣",
    nameEn: "Aqua Blue",
    aliases: ["浪濤灣", "Aqua Blue", "AQUA BLUE"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: null,
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖臨海低密度屋苑獨立 SEO 頁",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖",
  },
  {
    slug: "tai-tou-waan",
    nameZh: "帝濤灣",
    nameEn: "Palatial Coast",
    aliases: [
      "帝濤灣",
      "Palatial Coast",
      "PALATIAL COAST",
      "帝濤灣浪琴軒",
      "浪琴軒",
      "Grand Pacific View",
      "帝濤灣海琴軒",
      "海琴軒",
      "Grand Pacific Heights",
    ],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: "/estates/tai-tou-waan.jpg",
    photoCredit: "Kaihin0812 / Wikimedia Commons, CC BY-SA 3.0",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖成熟海景屋苑獨立 SEO 頁",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖／大欖",
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
export function estateSlugsForCorridorSegment(segment: CorridorSegmentSlug): string[] {
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
 * `corridorSegment: null` -- see each entry's own comment; every entry does
 * carry a non-null `districtSlug` since the 2026-09-01 data pack). An unknown
 * slug, or an entry whose `districtSlug` and `corridorSegment` are both
 * `null`, simply matches nothing and returns `[]`; this never throws, unlike
 * `getEstateEntry`, because a UI comparison section degrading to "nothing to
 * show" is the correct behaviour here, not a bug to surface loudly.
 */
export function findComparableEstates(slug: string, limit: number): EstateRegistryEntry[] {
  const current = estateRegistry.find((entry) => entry.slug === slug);
  if (!current) return [];

  return estateRegistry
    .filter((entry) => entry.slug !== slug)
    .filter((entry) => isComparableEntry(current, entry))
    .slice(0, limit);
}

function isComparableEntry(current: EstateRegistryEntry, entry: EstateRegistryEntry): boolean {
  const sameDistrict = current.districtSlug !== null && entry.districtSlug === current.districtSlug;
  const sameCorridor =
    current.corridorSegment !== null && entry.corridorSegment === current.corridorSegment;
  return sameDistrict || sameCorridor;
}
