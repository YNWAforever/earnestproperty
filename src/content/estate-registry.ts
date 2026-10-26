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
 * (free-text display strings, including names that are not estates, such as
 * "Vista Del Mar") and `textAliases` (which mix place names in with estate
 * names). Those aren't estate identity, they only look similar, so they stay
 * their own curated arrays. The 2026-10-26 listing evidence adds public
 * content for 40 estates, including 觀海別墅 and 嘉御龍庭, through the scoped
 * listing_estate_content migration. DB publication still gates public pages.
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
  /** Card photo under `public/`, an existing agency listing image URL, or null. */
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
   * (`estate.$slug.tsx`). Was hardcoded to "深井屋苑資料" for every
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
  /**
   * Intended publication state after the repo's reviewed data migrations.
   * Live DB publication still gates cards, detail pages and the sitemap;
   * a registry flag alone cannot publish an estate.
   */
  published: boolean;
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
    heroEyebrow: "深井屋苑資料",
    districtHref: "/district/sham-tseng",
    locationLabelZh: "深井 / 青山公路",
    published: true,
  },
  {
    slug: "hong-kong-garden",
    nameZh: "豪景花園",
    nameEn: "Hong Kong Garden",
    aliases: [
      "豪景花園",
      "豪景",
      "Hong Kong Garden",
      "豪景花園 第三期",
      "豪景花園第三期",
      "豪景花園 第一期",
      "豪景花園第一期",
    ],
    districtSlug: "sham-tseng",
    corridorSegment: "sham-tseng",
    branchId: "hong-kong-garden",
    hasPage: true,
    // TODO(client): 豪景花園 photo not supplied -- the other four arrived in 屋苑相/.
    // Do NOT substitute public/branches/hong-kong-garden.jpg: that is the 青山公路豪景分行
    // shopfront at 青龍頭村11號地下, not the estate.
    photo: null,
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "深井屋苑資料",
    districtHref: "/district/sham-tseng",
    locationLabelZh: "深井 / 青山公路",
    published: true,
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
    // TODO(client): the supplied 浪翠園 photo is 600×357 and captioned 三期 only -- too small
    // for a card at 2× DPR. Awaiting a higher-resolution estate-level shot.
    photo: "/estates/sea-crest-villa.jpg",
    homepageDistrict: "深井",
    parentEstateSlug: null,
    heroEyebrow: "深井屋苑資料",
    districtHref: "/district/sham-tseng",
    locationLabelZh: "深井 / 青山公路",
    published: true,
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
    heroEyebrow: "深井屋苑資料",
    districtHref: "/district/sham-tseng",
    locationLabelZh: "深井 / 青山公路",
    published: true,
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
    heroEyebrow: "深井屋苑資料",
    districtHref: "/district/sham-tseng",
    locationLabelZh: "深井 / 青山公路",
    published: true,
  },

  // The five 深井／青龍頭 estates the client added (docx p13/p15). Estate
  // Expansion 17 (2026-09-01 data pack) gives all five a real detail page
  // (`hasPage: true`) and content. All five are now in core-estates.ts's
  // CLIENT_ORDER_SLUGS and link normally on the homepage once each
  // individually publishes -- this comment used to say otherwise, before
  // PR #103 added them to that list; kept accurate here so it doesn't
  // mislead the next reader.
  //
  // hoi-wan-hin's districtSlug is 'sham-tseng', not 'tsing-lung-tau', even
  // though GeoInfo Map (2026-09-02 verification) resolves its door-plate
  // address (青山公路18A號) to the "TSING LUNG TAU" road segment, and
  // Wikipedia's own entry cites the same official address. This is
  // deliberate: every property portal (house730/Centaline/Ricacorp/etc.)
  // markets this estate as 深井 Sham Tseng regardless of the postal
  // segment name, and -- decisively -- fetchEstates() in src/lib/queries.ts
  // is hardcoded to fetchEstatesByDistrict("sham-tseng"); it never queries
  // "tsing-lung-tau". Since hoi-wan-hin is in CLIENT_ORDER_SLUGS's 深井
  // group, districtSlug must stay 'sham-tseng' for it to ever appear on
  // the homepage at all -- 'tsing-lung-tau' would silently remove it.
  {
    slug: "hoi-wan-hin",
    nameZh: "海雲軒",
    nameEn: "Anglers' Bay",
    aliases: ["海雲軒", "Anglers' Bay", "Anglers Bay", "ANGLERS BAY"],
    districtSlug: "sham-tseng",
    corridorSegment: null,
    hasPage: true,
    photo: "/estates/hoi-wan-hin.jpg",
    photoCredit: "Exploringlife / Wikimedia Commons, CC BY-SA 4.0",
    homepageDistrict: "深井",
    parentEstateSlug: null,
    heroEyebrow: "深井／青龍頭屋苑資料",
    districtHref: "/district/sham-tseng",
    locationLabelZh: "深井／青龍頭",
    published: true,
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
    photo: "/estates/tai-wah-hin.jpg",
    photoCredit: "Exploringlife / Wikimedia Commons, CC BY-SA 4.0",
    homepageDistrict: "深井",
    parentEstateSlug: "sea-crest-villa",
    heroEyebrow: "浪翠園五期屋苑資料",
    districtHref: "/castle-peak-road/sham-tseng",
    locationLabelZh: "青龍頭／深井",
    published: true,
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
    heroEyebrow: "深井單幢屋苑資料",
    districtHref: "/district/sham-tseng",
    locationLabelZh: "深井",
    published: true,
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
    heroEyebrow: "深井高層海景屋苑資料",
    districtHref: "/district/sham-tseng",
    locationLabelZh: "深井",
    published: true,
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
    heroEyebrow: "青龍頭低密度屋苑資料",
    districtHref: "/castle-peak-road/sham-tseng",
    locationLabelZh: "青龍頭",
    published: true,
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
    heroEyebrow: "掃管笏低密度屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "掃管笏",
    published: true,
  },
  {
    slug: "wong-gam-hoi-ngon",
    // Canonical display is 香港黃金海岸 per the 2026-09-01 data pack's naming
    // rule (distinct from the unrelated 黃金海灣/wong-gam-hoi-waan estate).
    // The 2026-10-26 production row stores name_zh 黃金海岸 and alias
    // 香港黃金海岸; both stay searchable here, and the client display name
    // stays 香港黃金海岸.
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
    heroEyebrow: "青山灣海濱屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "青山灣／掃管笏",
    published: true,
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
    heroEyebrow: "掃管笏成熟屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "掃管笏",
    published: true,
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
      "帝御 帝御‧嵐天",
      "帝御帝御‧嵐天",
      "帝御 帝御‧星濤",
      "帝御帝御‧星濤",
    ],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: null,
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "青山灣較新屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "青山灣／掃管笏",
    published: true,
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
      "黃金海灣 黃金海灣意嵐",
      "黃金海灣黃金海灣意嵐",
      "黃金海灣 黃金海灣珀岸",
      "黃金海灣黃金海灣珀岸",
    ],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: null,
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "青山灣新式屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "青山灣",
    published: true,
  },
  {
    slug: "sing-tai",
    nameZh: "星堤",
    nameEn: "Avignon",
    aliases: ["星堤", "Avignon", "AVIGNON", "星堤 大廈", "星堤大廈"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: "/estates/sing-tai.jpg",
    photoCredit: "Wpcpey / Wikimedia Commons, CC BY 3.0",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "掃管笏低密度屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "掃管笏",
    published: true,
  },
  {
    slug: "seong-yuen",
    nameZh: "上源",
    nameEn: "Le Pont",
    aliases: ["上源", "Le Pont", "LE PONT"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: "/estates/seong-yuen.jpg",
    photoCredit: "Prosperity Horizons / Wikimedia Commons, CC BY-SA 4.0",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "掃管笏大型低密度屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "掃管笏",
    published: true,
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
    aliases: ["The Carmel", "THE CARMEL", "THE CARMEL 大廈", "THE CARMEL大廈"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: "/estates/the-carmel.jpg",
    photoCredit: "Prosperity Horizons / Wikimedia Commons, CC BY-SA 4.0",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "大欖低密度屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "大欖／掃管笏",
    published: true,
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
    heroEyebrow: "掃管笏較新屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "掃管笏",
    published: true,
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
    heroEyebrow: "小欖低密度屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖",
    published: true,
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
    heroEyebrow: "小欖臨海低密度屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖",
    published: true,
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
    heroEyebrow: "小欖成熟海景屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖／大欖",
    published: true,
  },

  // The production snapshot had 29 unpublished rows. Active listing evidence
  // now supports content and publication for 28 of them, plus 12 new estate
  // identities below. 翠峰小築 has no active evidence and remains hidden.
  // Keep phase aliases; separate 龍珠島別墅 (9號) from 龍珠島花園 (11號).
  // Sources and agency photo provenance: fixtures/listing-estate-expansion-20261026.json.
  {
    slug: "bayview-terrace",
    nameZh: "碧翠花園",
    nameEn: "Bayview Terrace",
    aliases: ["碧翠花園", "Bayview Terrace", "BAYVIEW TERR"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: "https://imgs.property.hk/largePhotos/2026/5/f/8/58bf4c9fa5c25874c54c4ffe0e70d341.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "castle-peak-villas",
    nameZh: "青山別墅",
    nameEn: "Castle Peak Villas",
    aliases: ["青山別墅", "Castle Peak Villas"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo:
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/38/384abf198c6ca47ef656ca788e1976edacc32c1082a7a9e8ab8270c8d2091128.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "ching-lai-waan-villas",
    nameZh: "青麗灣別墅",
    nameEn: "The Castle Bay",
    aliases: ["青麗灣別墅", "The Castle Bay"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo:
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/35/35b60726094f0c3abcbc1d21e9554d2390a13dc80950e5d7b8a635dadf8b289d.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "ching-yung-toi",
    nameZh: "青榕臺",
    nameEn: "Tsing Yung Terrace",
    aliases: ["青榕臺", "Tsing Yung Terrace", "青榕台"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo:
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/b4/b4f12661f6db2c1cccdd354f8a32f1ee64cd257ba270dabf5065756bf8a88155.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "chui-fung-siu-chuk",
    nameZh: "翠峰小築",
    nameEn: null,
    aliases: ["翠峰小築"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: false,
    photo: null,
    homepageDistrict: null,
    parentEstateSlug: null,
    heroEyebrow: null,
    districtHref: null,
    locationLabelZh: null,
    published: false,
  },
  {
    slug: "chui-king-garden",
    nameZh: "翠景花園",
    nameEn: "Jade View Villa",
    aliases: ["翠景花園", "Jade View Villa"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo:
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/1e/1edce3beba410ed109e4fb4d0db5551f46f50df57e56a9c9eb163772c9750243.webp",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "chun-wo-sea-view-garden",
    nameZh: "春和海景花園",
    nameEn: "Spring Seaview Terrace",
    aliases: ["春和海景花園", "Spring Seaview Terrace"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo:
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/3d/3dab39f1fedbe804e074e8d35d439f2172895f10d37e89a222b30af49a4c7a85.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "chung-yuet-waan",
    nameZh: "棕月灣",
    nameEn: "Palm Beach",
    aliases: ["棕月灣", "Palm Beach"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo:
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/0e/0e34d2bf93186ff756e2db1fbbde1ece2a36f6a1cfac0994fe9c67472a23fb1b.webp",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "fei-yeung",
    nameZh: "飛揚",
    nameEn: "Grand Jeté",
    aliases: ["飛揚", "Grand Jeté", "飛揚 1期", "飛揚1期", "飛揚 2期", "飛揚2期"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: "https://imgs.property.hk/largePhotos/2026/b/f/c/e8f252c0a4992f4c2192d8e4459b43a8.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "hoi-ching-hin",
    nameZh: "海澄軒",
    nameEn: "Villa Sapphire",
    aliases: ["海澄軒", "Villa Sapphire"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo:
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/1b/1b335c3abf6400edd5f2561e9ad05fb3d18553c173a397a718712b057f500d80.webp",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "hoi-king-garden",
    nameZh: "海景花園",
    nameEn: "Seaview Garden",
    aliases: ["海景花園", "Seaview Garden"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: "https://imgs.property.hk/largePhotos/2026/f/8/5/08afcca7aaada5af73483caa275d1fab.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "hoi-wai-garden",
    nameZh: "海慧花園",
    nameEn: "Aquamarine Garden",
    aliases: ["海慧花園", "Aquamarine Garden", "海慧花園 洋房", "海慧花園洋房"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo:
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/d1/d17aaef525ccba8aef3715c2d34cf13a655aa203e295814b72c7bf0070307166.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "hoi-yu",
    nameZh: "海譽",
    nameEn: "Crown By The Sea",
    aliases: ["海譽", "Crown By The Sea"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo:
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/ae/ae65106225cd33e3cba9bd939a30e2f5e1972ab8f793112753fbed9c0355d94c.webp",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "kwan-lun",
    nameZh: "琨崙",
    nameEn: "Jade Grove",
    aliases: ["琨崙", "Jade Grove", "琨崙 分層單位", "琨崙分層單位"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: "https://imgs.property.hk/largePhotos/2026/b/5/1/464f55ec15fb07fa1daa36fad11b8d07.jpeg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "kwun-hoi-villas",
    nameZh: "觀海別墅",
    nameEn: "Vista Del Mar",
    aliases: ["觀海別墅", "Vista Del Mar"],
    districtSlug: "ting-kau",
    corridorSegment: null,
    hasPage: true,
    photo: "https://imgs.property.hk/largePhotos/2026/b/b/0/70a74c8ec7bd8c429dc7f4c59e963c7c.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "汀九",
    parentEstateSlug: null,
    heroEyebrow: "油柑頭／汀九屋苑資料",
    districtHref: "/castle-peak-road/ting-kau",
    locationLabelZh: "油柑頭／汀九",
    published: true,
  },
  {
    slug: "lung-chu-island-garden",
    nameZh: "龍珠島花園",
    nameEn: "Pearl Island Garden",
    aliases: ["龍珠島花園", "Pearl Island Garden"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo:
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/8e/8ebd6372f460076ae63aaf5e630aae6081ed36b7ec724ad4a7907b06155a2861.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "monte-carlo-villas",
    nameZh: "蒙地卡羅別墅",
    nameEn: "Monte Carlo Villas",
    aliases: ["蒙地卡羅別墅", "Monte Carlo Villas"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo:
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/1e/1ebc954d2ced6db1cff3b7fd69d1eef380216bbf85e717e22b1ce828019139e2.webp",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "nam-ngon",
    nameZh: "南岸",
    nameEn: "South Crest",
    aliases: ["南岸", "South Crest"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo:
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/04/04d8c87b1df833e08daf623c83d49617d34e3e3488192af9a11e5d0ef553209f.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "napa",
    nameZh: "NAPA",
    nameEn: "NAPA",
    aliases: ["NAPA", "NAPA 大廈", "NAPA大廈"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: "https://imgs.property.hk/largePhotos/2026/8/2/9/7c6b63e09c39928784f20d761c23bd89.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "nga-tak-yuen",
    nameZh: "雅德苑",
    nameEn: "Faraday House",
    aliases: ["雅德苑", "Faraday House"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo:
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/59/5992dd4bc265744fd9e4d96156c41241afc9c4daf5c09f67a29af9fb643732f8.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "ocean-camino",
    nameZh: "緹岸",
    nameEn: "Ocean Camino",
    aliases: [
      "緹岸",
      "Ocean Camino",
      "緹岸 第1期(大廈)",
      "緹岸第1期(大廈)",
      "緹岸 第1期(洋房)",
      "緹岸第1期(洋房)",
      "緹岸 第2期",
      "緹岸第2期",
    ],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo:
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/5d/5d85da6a8de8c28c54b5e2b36d3cbf06119908de5d0ddbfc64915afcf7f407b1.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "oi-kam-waan",
    nameZh: "愛琴灣",
    nameEn: "The Aegean",
    aliases: [
      "愛琴灣",
      "The Aegean",
      "愛琴灣 愛琴灣",
      "愛琴灣愛琴灣",
      "愛琴灣 愛琴灣(獨立屋)",
      "愛琴灣愛琴灣(獨立屋)",
    ],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: "https://imgs.property.hk/largePhotos/2026/d/a/9/d118a89a3ac63d2afa96c9b06b05a0f3.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "oma-by-the-sea",
    nameZh: "OMA by the Sea",
    nameEn: "OMA by the Sea",
    aliases: ["OMA by the Sea", "OMA BY THE SEA"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo:
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/78/7889533d3eea8d8dea6718bc2c140466d853544aeee4f6868eca2953a0d4cd75.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "palm-cove",
    nameZh: "翠濤居",
    nameEn: "Palm Cove",
    aliases: ["翠濤居", "Palm Cove", "PALM COVE"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo:
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/8f/8f628dbfe5852a4d770602ea64a9f46751534a19aade4ee06cc48db414e20f81.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "pun-lung-bun-do",
    nameZh: "蟠龍半島",
    nameEn: "Beaulieu Peninsula",
    aliases: [
      "蟠龍半島",
      "Beaulieu Peninsula",
      "蟠龍半島 三層洋房",
      "蟠龍半島三層洋房",
      "蟠龍半島 獨立屋",
      "蟠龍半島獨立屋",
    ],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo:
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/ae/ae8688aeef547cba5a65a0574fc829f5136abab059a9fac3973ccd382d9a9cb3.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "royal-cove-tower",
    nameZh: "帝灣居",
    nameEn: "Royal Cove",
    aliases: ["帝灣居", "Royal Cove", "ROYAL COVE TOWER"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: "https://imgs.property.hk/largePhotos/2026/b/c/e/180ec74c4fd0be97d1d241f51e40bbec.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "royal-dragon-villa",
    nameZh: "嘉御龍庭",
    nameEn: "Royal Dragon Villa",
    aliases: ["嘉御龍庭", "Royal Dragon Villa", "ROYAL DRAGON VILLA"],
    districtSlug: "ting-kau",
    corridorSegment: null,
    hasPage: true,
    photo: "https://imgs.property.hk/largePhotos/2026/d/4/5/252dcfeffb5ea212f047b5220026a47f.jpeg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "汀九",
    parentEstateSlug: null,
    heroEyebrow: "油柑頭／汀九屋苑資料",
    districtHref: "/castle-peak-road/ting-kau",
    locationLabelZh: "油柑頭／汀九",
    published: true,
  },
  {
    slug: "seaside-castle",
    nameZh: "畔海",
    nameEn: "Seaside Castle",
    aliases: ["畔海", "Seaside Castle", "SEASIDE CASTLE"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: "https://imgs.property.hk/largePhotos/2026/d/c/3/4dd478d18530ede031cbf003e2521312.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "yu-chui-yuen",
    nameZh: "瑜翠園",
    nameEn: "Peridot Court",
    aliases: ["瑜翠園", "Peridot Court"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo:
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/77/770eccf3710c9adc09f63132b37230f95f0b5711b79b6ed400f31148d18043c1.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "l-aquatique",
    nameZh: "逸璟．龍灣",
    nameEn: "L'Aquatique",
    aliases: ["逸璟．龍灣", "L'Aquatique", "逸璟龍灣", "逸璟‧龍灣"],
    districtSlug: "tsing-lung-tau",
    corridorSegment: null,
    hasPage: true,
    photo: "https://imgs.property.hk/largePhotos/2026/7/8/b/b6740003588d99f67968a649e9fba067.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "深井",
    parentEstateSlug: null,
    heroEyebrow: "青龍頭屋苑資料",
    districtHref: "/district/sham-tseng",
    locationLabelZh: "青龍頭",
    published: true,
  },
  {
    slug: "deauville",
    nameZh: "星岸",
    nameEn: "Deauville",
    aliases: ["星岸", "Deauville", "星岸大廈"],
    districtSlug: "ting-kau",
    corridorSegment: null,
    hasPage: true,
    photo:
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/56/56abcc171952c57c6cedb1b91fa48a7c415347bd3637a3159147907d3653a4f2.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "汀九",
    parentEstateSlug: null,
    heroEyebrow: "油柑頭／汀九屋苑資料",
    districtHref: "/castle-peak-road/ting-kau",
    locationLabelZh: "油柑頭／汀九",
    published: true,
  },
  {
    slug: "long-beach-gardens",
    nameZh: "海濤花園",
    nameEn: "Long Beach Gardens",
    aliases: ["海濤花園", "Long Beach Gardens"],
    districtSlug: "ting-kau",
    corridorSegment: null,
    hasPage: true,
    photo:
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/24/241e4ed6a8f6913ebc420e9a13badeced4b3b752c796980f429a35e300f40f37.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "汀九",
    parentEstateSlug: null,
    heroEyebrow: "油柑頭／汀九屋苑資料",
    districtHref: "/castle-peak-road/ting-kau",
    locationLabelZh: "油柑頭／汀九",
    published: true,
  },
  {
    slug: "riviera",
    nameZh: "麗海別墅",
    nameEn: "Riviera",
    aliases: ["麗海別墅", "Riviera"],
    districtSlug: "ting-kau",
    corridorSegment: null,
    hasPage: true,
    photo: "https://imgs.property.hk/largePhotos/2026/a/5/2/61b9e3267ef9e369eea3236791ad2d53.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "汀九",
    parentEstateSlug: null,
    heroEyebrow: "油柑頭／汀九屋苑資料",
    districtHref: "/castle-peak-road/ting-kau",
    locationLabelZh: "油柑頭／汀九",
    published: true,
  },
  {
    slug: "both-wealth-garden",
    nameZh: "均富花園",
    nameEn: "Both Wealth Garden",
    aliases: ["均富花園", "Both Wealth Garden"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: "https://imgs.property.hk/largePhotos/2026/1/8/e/7a6e8678e0447977e58ff48c0500499d.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "fiona-garden",
    nameZh: "富安新邨",
    nameEn: "Fiona Garden",
    aliases: ["富安新邨", "Fiona Garden", "富安新村"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: "https://imgs.property.hk/largePhotos/2026/1/8/1/fdf6b5d2e4d5eb76b684e938434a2f26.jpeg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "dragon-inn-court",
    nameZh: "容龍居",
    nameEn: "Dragon Inn Court",
    aliases: ["容龍居", "Dragon Inn Court"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: "https://imgs.property.hk/largePhotos/2026/7/5/2/17ceacec2610f8161e6b97186f470ef6.jpeg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "tuen-mun-court",
    nameZh: "屯門閣",
    nameEn: "Tuen Mun Court",
    aliases: ["屯門閣", "Tuen Mun Court"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: "https://imgs.property.hk/largePhotos/2026/1/0/2/05d18e188a23b68f3eb743f154514631.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "elegant-villa",
    nameZh: "雅翠苑",
    nameEn: "Elegant Villa",
    aliases: ["雅翠苑", "Elegant Villa"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: "https://imgs.property.hk/largePhotos/2026/3/7/6/cd96f59acb42cbb327d4bf070a9a9a3a.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "pearl-island-bungalow",
    nameZh: "龍珠島平房",
    nameEn: "Pearl Island Bungalow",
    aliases: ["龍珠島平房", "Pearl Island Bungalow", "龍珠島別墅"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo: "https://imgs.property.hk/largePhotos/2026/a/5/e/534dfb816d73e407eaaa1878c96d485e.jpg",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "pearl-garden",
    nameZh: "龍珠花園",
    nameEn: "Pearl Garden",
    aliases: ["龍珠花園", "Pearl Garden"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo:
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/d2/d26242b165dd439bb04e3052ff65994f07ed2652a0d570a3ec450167616c8557.webp",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
  },
  {
    slug: "peak-castle",
    nameZh: "珀居",
    nameEn: "Peak Castle",
    aliases: ["珀居", "Peak Castle"],
    districtSlug: "castle-peak-road",
    corridorSegment: null,
    hasPage: true,
    photo:
      "https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/mls/62/62051f93d6f782391f0e9ba95514217b5c68afd32ba746f5e3f5a531c6824c55.webp",
    photoCredit: "晉誠地產放盤參考照片（個別單位／景觀）",
    homepageDistrict: "青山公路",
    parentEstateSlug: null,
    heroEyebrow: "小欖至三聖屋苑資料",
    districtHref: "/castle-peak-road",
    locationLabelZh: "小欖至三聖",
    published: true,
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
 * Most of the registry carries `corridorSegment: null` (only the original
 * five 深井 estates claim strict corridor inventory). Every entry carries a
 * non-null `districtSlug`. An unknown
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
