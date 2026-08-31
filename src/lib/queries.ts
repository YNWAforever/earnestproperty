import {
  fetchNeonArticleBySlug,
  fetchNeonCmsVideos,
  fetchNeonCorridorInventory,
  fetchNeonDistrictTransactions,
  fetchNeonEstateBySlug,
  fetchNeonEstateOptions,
  fetchNeonEstateTransactions,
  fetchNeonEstates,
  fetchNeonFaqs,
  fetchNeonFeaturedProperties,
  fetchNeonListingCountsByEstate,
  fetchNeonListingsForAgent,
  fetchNeonListingsForEstate,
  fetchNeonPropertyByLegacyDetailId,
  fetchNeonPropertyByListingNo,
  fetchNeonPublishedArticles,
  fetchNeonRecentTransactions,
  fetchNeonSimilarListings,
  searchNeonListings,
} from "@/lib/neon/public-data";
import type {
  NeonEstateOption,
  NeonListingSort,
  NeonPropertyRow,
  NeonTransactionDealType,
  NeonTransactionRow,
} from "@/lib/neon/public-data.types";
import { corridorRegionScope, isWithinCorridorRegion } from "@/content/castle-peak-road";
import { estateRegistry } from "@/content/estate-registry";

/**
 * Derived from estate-registry.ts's `legacySlug` field (DR-10) instead of a
 * second hand-maintained mapping -- keeps the same canonical -> legacy slug
 * direction the rest of this file's slug-resolution logic already assumes.
 */
const ESTATE_DB_SLUG_FALLBACKS: Record<string, string> = Object.fromEntries(
  estateRegistry
    .filter((entry): entry is typeof entry & { legacySlug: string } => Boolean(entry.legacySlug))
    .map((entry) => [entry.slug, entry.legacySlug]),
);

function canonicalEstateSlug(dbSlug: string) {
  for (const [canonical, legacy] of Object.entries(ESTATE_DB_SLUG_FALLBACKS)) {
    if (legacy === dbSlug) return canonical;
  }
  return dbSlug;
}

function estateSlugCandidates(slug: string) {
  const canonical = canonicalEstateSlug(slug);
  return Array.from(
    new Set([slug, canonical, ESTATE_DB_SLUG_FALLBACKS[canonical]].filter(Boolean)),
  );
}

function withCanonicalSlug<T extends { slug?: string }>(estate: T, requestedSlug?: string): T {
  return {
    ...estate,
    slug: requestedSlug ?? canonicalEstateSlug(estate.slug ?? ""),
  };
}

export type EstateSummary = {
  slug: string;
  name_zh: string;
  district_slug: string | null;
  total_units: number | null;
  avg_saleable_psf: number | null;
  hero_image: string | null;
};

export type FeaturedProperty = {
  id: string;
  listing_no: string;
  canonical_property_no: string | null;
  title_zh: string;
  deal_type: string;
  district_slug: string;
  address: string | null;
  price: number | null;
  rent: number | null;
  saleable_area: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  features: string[] | null;
  images: string[] | null;
  // Already selected by `listingColumns`; surfaced here so the homepage's
  // featured cards can badge which listings have a walkthrough video.
  video_url: string | null;
  // Already selected by `listingColumns`; surfaced here so the homepage's
  // featured cards can show a freshness stamp the same way listings.tsx's
  // ListingCard does.
  last_seen_at: string | null;
  source_site: string | null;
  estates: { name_zh: string; slug: string; district_slug: string } | null;
};

export type FaqItem = { question: string; answer: string };

export async function fetchEstates(): Promise<EstateSummary[]> {
  return fetchEstatesByDistrict("sham-tseng");
}

export async function fetchEstatesByDistrict(districtSlug: string): Promise<EstateSummary[]> {
  const rows = await fetchNeonEstates({ data: { districtSlug } });
  return (rows as EstateSummary[])
    .map((estate) => withCanonicalSlug(estate))
    .filter((estate) =>
      isWithinCorridorRegion({
        districtSlug: estate.district_slug,
        estateSlug: estate.slug,
        text: [estate.name_zh],
      }),
    );
}

/** Shape of the `estates` row consumed by /estate/$slug. Declared here because
 * this is the boundary where an untyped `SELECT *` enters typed code -- without
 * it every field arrived as `unknown` and callers silently lost type checking. */
export type EstateRecord = {
  id: string;
  slug: string;
  name_zh: string;
  name_en: string | null;
  district_slug: string | null;
  developer: string | null;
  description: string | null;
  year_completed: number | null;
  phases: number | null;
  total_units: number | null;
  avg_saleable_psf: number | string | null;
  hero_image: string | null;
  facilities: string[] | null;
  // DR-10: previously written by the admin CMS estate form but never read on
  // the public site. `fetchEstateBySlug`'s SQL is `SELECT *`, so both columns
  // already arrive on every row -- this only widens the type to expose them.
  seo_title: string | null;
  seo_description: string | null;
  // P4 Task 2's migration added this column; every row (including the 5 with
  // real detail pages) is NULL until an estate is manually verified. `SELECT
  // *` already returns it -- widening the type here is what lets Task 4's
  // verified-facts DataNote read it type-safely.
  verified_at: string | null;
};

export async function fetchEstateBySlug(slug: string): Promise<EstateRecord | null> {
  for (const candidate of estateSlugCandidates(slug)) {
    const estate = await fetchNeonEstateBySlug({ data: { slug: candidate } });
    if (estate) {
      return withCanonicalSlug(estate as EstateRecord, canonicalEstateSlug(slug));
    }
  }
  return null;
}

async function fetchFaqsByScope(scope: string): Promise<FaqItem[]> {
  return (await fetchNeonFaqs({ data: { scope } })) as FaqItem[];
}

export async function fetchFaqs(scope: string): Promise<FaqItem[]> {
  const rows = await fetchFaqsByScope(scope);
  if (rows.length > 0 || !scope.startsWith("estate:")) return rows;

  const slug = scope.replace("estate:", "");
  const fallback = ESTATE_DB_SLUG_FALLBACKS[slug];
  return fallback ? fetchFaqsByScope(`estate:${fallback}`) : rows;
}

const FEATURED_DISPLAY_LIMIT = 6;
// The featured query carries no region predicate and the listing API is out of
// scope to change, so the filter lives here in the consumer. Over-fetch so the
// homepage still fills six cards after out-of-corridor rows are dropped.
const FEATURED_FETCH_LIMIT = 24;

export async function fetchFeaturedProperties(): Promise<FeaturedProperty[]> {
  const rows = (await fetchNeonFeaturedProperties({
    data: { limit: FEATURED_FETCH_LIMIT },
  })) as FeaturedProperty[];

  return dedupeListings(
    rows.filter((row) =>
      isWithinCorridorRegion({
        districtSlug: row.district_slug,
        estateSlug: row.estates?.slug,
        estateDistrictSlug: row.estates?.district_slug,
        text: [row.title_zh, row.address, row.estates?.name_zh],
      }),
    ),
  ).slice(0, FEATURED_DISPLAY_LIMIT);
}

export type DistrictTransaction = {
  deal_date: string | null;
  saleable_psf: number | null;
  price: number | null;
  saleable_area: number | null;
  unit: string | null;
  estates: { name_zh: string; slug: string } | null;
};

export async function fetchDistrictTransactions(
  districtSlug: string,
  monthsBack = 12,
): Promise<DistrictTransaction[]> {
  return (await fetchNeonDistrictTransactions({
    data: { districtSlug, monthsBack },
  })) as DistrictTransaction[];
}

export async function fetchPropertyByListingNo(listingNo: string) {
  return (await fetchNeonPropertyByListingNo({
    data: { listingNo },
  })) as NeonPropertyRow | null;
}

export async function fetchListingCountsByEstate() {
  return new Map(Object.entries(await fetchNeonListingCountsByEstate()));
}

export type ListingFilters = {
  deal: "sale" | "rent" | "all";
  keyword?: string;
  minPrice?: number;
  maxPrice?: number;
  minArea?: number;
  maxArea?: number;
  bedrooms?: number;
  estateSlug?: string;
  districtSlug?: string;
  agentId?: string;
  sort: NeonListingSort;
  page: number;
  pageSize: number;
};

export type ListingRow = Pick<
  NeonPropertyRow,
  | "id"
  | "listing_no"
  | "canonical_property_no"
  | "title_zh"
  | "deal_type"
  | "price"
  | "rent"
  | "saleable_area"
  | "bedrooms"
  | "bathrooms"
  | "floor"
  | "last_seen_at"
  | "source_site"
  | "images"
  | "video_url"
  | "district_slug"
  | "address"
  | "estates"
>;

export type CorridorInventoryAliasInput = {
  districtSlugs: string[];
  estateSlugs: string[];
  textAliases: string[];
  limit?: number;
};

export type CorridorInventory = {
  saleTotal: number;
  rentTotal: number;
  saleRows: ListingRow[];
  rentRows: ListingRow[];
};

function cleanCorridorTerms(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function clampCorridorLimit(value: number | undefined) {
  const limit = typeof value === "number" && Number.isFinite(value) ? value : 6;
  return Math.min(Math.max(1, limit), 24);
}

function normalizeCorridorInventoryInput(
  input: CorridorInventoryAliasInput,
): Required<CorridorInventoryAliasInput> {
  return {
    districtSlugs: cleanCorridorTerms(input.districtSlugs),
    estateSlugs: cleanCorridorTerms(input.estateSlugs).flatMap(estateSlugCandidates),
    textAliases: cleanCorridorTerms(input.textAliases),
    limit: clampCorridorLimit(input.limit),
  };
}

function hasCorridorAliases(input: Required<CorridorInventoryAliasInput>) {
  return (
    input.districtSlugs.length > 0 || input.estateSlugs.length > 0 || input.textAliases.length > 0
  );
}

export function emptyCorridorInventory(): CorridorInventory {
  return {
    saleTotal: 0,
    rentTotal: 0,
    saleRows: [],
    rentRows: [],
  };
}

/**
 * De-duplicates listing rows by (canonical_property_no, deal_type) -- the
 * identity the MLS import pipeline already establishes at write time
 * (src/lib/mls/match.mjs's EXACT_LINK_REASON is itself keyed on
 * property_no + deal_type, never property_no alone). A re-scraped row for
 * the same physical unit AND deal type under a second listing_no otherwise
 * renders twice on the same page (DR-3).
 *
 * The key is deal-type-aware because canonical_property_no alone is NOT a
 * safe merge key: one physical unit can legitimately have both an active
 * sale row and an active rent row sharing the same canonical_property_no --
 * normalizeListingDetail emits exactly this pair for a dual-priced listing
 * (src/lib/mls/mls-fixtures.test.mjs: "a listing with both a sale and a rent
 * price emits two rows"), and searchListings/fetchListingsForEstate query
 * with deal="all" (listingWhere only adds a deal_type predicate when
 * `input.deal !== "all"`), so both rows flow through the same result set.
 * Keying on canonical_property_no alone would silently drop one of the two,
 * making a real active listing disappear from /listings' 全部 tab, /videos,
 * and every /estate/$slug listings section.
 *
 * Falls back to `${listing_no}:${deal_type}` when canonical_property_no is
 * null OR an empty string -- the `row.canonical_property_no ? ... : ...`
 * truthiness check handles both the same way, which is deliberate: two rows
 * that both lack a canonical number (whether the column is NULL or was
 * written as "") are not known to be the same property, so keying an empty
 * string as its own shared identity would wrongly collapse unrelated
 * listings together.
 *
 * Keeps the first occurrence. Every call site orders its rows by
 * `featured DESC, last_seen_at DESC NULLS LAST, created_at DESC` before this
 * runs (searchListings/fetchListingsForEstate and fetchSimilarListings via
 * that same ORDER BY in public-data.server.ts; the corridor path via
 * fetchCorridorRows' ROW_NUMBER() OVER (... ORDER BY the same three columns)
 * per deal_type partition) -- so the kept row is always the freshest/most-
 * featured of any duplicate pair, never an arbitrary one.
 */
export function dedupeListings<
  T extends {
    listing_no: string;
    canonical_property_no?: string | null;
    deal_type: string;
  },
>(rows: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const row of rows) {
    const key = row.canonical_property_no
      ? `canonical:${row.canonical_property_no}:${row.deal_type}`
      : `listing:${row.listing_no}:${row.deal_type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

function withinCorridorScope(row: ListingRow): boolean {
  return isWithinCorridorRegion({
    districtSlug: row.district_slug,
    estateSlug: row.estates?.slug ?? null,
    estateDistrictSlug: row.estates?.district_slug ?? null,
    text: [row.title_zh, row.address],
  });
}

export async function fetchCorridorInventoryForAliases(
  input: CorridorInventoryAliasInput,
): Promise<CorridorInventory> {
  const normalized = normalizeCorridorInventoryInput(input);
  if (!hasCorridorAliases(normalized)) return emptyCorridorInventory();
  const result = await fetchNeonCorridorInventory({
    data: {
      ...normalized,
      // Fixed constant, not something callers choose per-segment -- every
      // corridor/nearby query excludes the same out-of-corridor place names.
      outOfScopeTextAliases: corridorRegionScope.outOfScopeTextAliases,
    },
  });
  // corridorWhere() (public-data.server.ts) now applies
  // corridorRegionScope.outOfScopeTextAliases as a SQL-level AND NOT EXISTS
  // exclusion, so saleTotal/rentTotal and the rows below are already computed
  // against the same filtered set -- the totals cannot outrun the rows the
  // way a purely client-side filter would let them. This app-layer filter
  // stays on as defense-in-depth (e.g. against a future regression in
  // corridorWhere()); with the SQL-level exclusion in place it should now
  // rarely if ever remove anything.
  return {
    saleTotal: result.saleTotal,
    rentTotal: result.rentTotal,
    saleRows: dedupeListings((result.saleRows as ListingRow[]).filter(withinCorridorScope)),
    rentRows: dedupeListings((result.rentRows as ListingRow[]).filter(withinCorridorScope)),
  };
}

export async function searchListings(f: ListingFilters): Promise<{
  rows: ListingRow[];
  total: number;
}> {
  const candidates = f.estateSlug ? estateSlugCandidates(f.estateSlug) : [undefined];
  let lastResult: Awaited<ReturnType<typeof searchNeonListings>> | null = null;

  for (const estateSlug of candidates) {
    const result = await searchNeonListings({
      data: { ...f, estateSlug },
    });
    if (!f.estateSlug || result.total > 0) {
      return {
        rows: dedupeListings(result.rows as ListingRow[]),
        total: result.total,
      };
    }
    lastResult = result;
  }

  return {
    rows: dedupeListings((lastResult?.rows ?? []) as ListingRow[]),
    total: lastResult?.total ?? 0,
  };
}

export type VideoListing = ListingRow & { video_url: string };

export type CmsVideo = {
  id: string;
  title: string;
  video_url: string;
  description: string | null;
  sort_order: number;
  created_at: string | null;
  /** Real upload date from YouTube. Null for videos added by hand in the CMS. */
  youtube_published_at: string | null;
  category: string | null;
};

export async function fetchCmsVideos(): Promise<CmsVideo[]> {
  return (await fetchNeonCmsVideos()) as CmsVideo[];
}

export async function fetchVideoListings(limit = 12): Promise<VideoListing[]> {
  const result = await searchListings({
    deal: "all",
    sort: "newest",
    page: 1,
    pageSize: Math.max(limit * 3, limit),
  });

  return result.rows
    .filter(
      (row): row is VideoListing =>
        typeof row.video_url === "string" && row.video_url.trim().length > 0,
    )
    .slice(0, limit);
}

export async function fetchVideosPageData() {
  const [cmsVideos, listingVideos] = await Promise.all([fetchCmsVideos(), fetchVideoListings(12)]);
  return { cmsVideos, listingVideos };
}

export async function fetchListingsForEstate(estateSlug: string, limit = 6): Promise<ListingRow[]> {
  for (const candidate of estateSlugCandidates(estateSlug)) {
    const rows = (await fetchNeonListingsForEstate({
      data: { estateSlug: candidate, limit },
    })) as ListingRow[];
    if (rows.length > 0) return dedupeListings(rows);
  }
  return [];
}

export async function fetchListingsForAgent(agentId: string, limit = 6): Promise<ListingRow[]> {
  const rows = (await fetchNeonListingsForAgent({
    data: { agentId, limit },
  })) as ListingRow[];
  return dedupeListings(rows);
}

export async function fetchPropertyByLegacyDetailId(oldId: string) {
  return fetchNeonPropertyByLegacyDetailId({ data: { oldId } });
}

export type SimilarListing = {
  id: string;
  listing_no: string;
  canonical_property_no: string | null;
  title_zh: string;
  deal_type: "sale" | "rent";
  price: number | null;
  rent: number | null;
  saleable_area: number | null;
  bedrooms: number | null;
  images: string[] | null;
};

export async function fetchSimilarListings(
  estateId: string,
  dealType: "sale" | "rent",
  excludeId: string,
  limit = 4,
): Promise<SimilarListing[]> {
  const rows = (await fetchNeonSimilarListings({
    data: { estateId, dealType, excludeId, limit },
  })) as SimilarListing[];
  return dedupeListings(rows);
}

export type EstateTransaction = {
  deal_date: string | null;
  unit: string | null;
  saleable_area: number | null;
  saleable_psf: number | null;
  price: number | null;
};

export async function fetchEstateTransactions(
  estateId: string,
  limit = 8,
): Promise<EstateTransaction[]> {
  return (await fetchNeonEstateTransactions({
    data: { estateId, limit },
  })) as EstateTransaction[];
}

export async function fetchEstateOptions() {
  const estates = await fetchNeonEstateOptions();

  // estates.slug is UNIQUE in the DB, but withCanonicalSlug collapses legacy
  // slugs (belvedere-garden, sea-pearl-garden) onto their canonical ones
  // (bellagio, rhine-garden) -- see ESTATE_DB_SLUG_FALLBACKS above. A database
  // that still holds a legacy row alongside the seeded canonical one (which is
  // exactly why ESTATE_DB_SLUG_FALLBACKS exists) would otherwise yield two
  // dropdown options with the same value and the same React key. Prefer the
  // already-canonical row so the surviving option is the one the rest of the
  // app resolves against.
  const byCanonicalSlug = new Map<string, ReturnType<typeof withCanonicalSlug<NeonEstateOption>>>();
  for (const estate of estates as NeonEstateOption[]) {
    const option = withCanonicalSlug(estate);
    const isAlreadyCanonical = estate.slug === option.slug;
    if (isAlreadyCanonical || !byCanonicalSlug.has(option.slug)) {
      byCanonicalSlug.set(option.slug, option);
    }
  }
  return [...byCanonicalSlug.values()];
}

export type ArticleSummary = {
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image: string | null;
  category: string | null;
  reading_minutes: number | null;
  published_at: string;
};

export async function fetchPublishedArticles(): Promise<ArticleSummary[]> {
  return (await fetchNeonPublishedArticles()) as ArticleSummary[];
}

export async function fetchPublishedArticlesByCategory(
  category: string,
): Promise<ArticleSummary[]> {
  const articles = await fetchPublishedArticles();
  return articles.filter((article) => article.category === category);
}

export async function fetchArticleBySlug(slug: string) {
  return fetchNeonArticleBySlug({ data: { slug } });
}

export type RecentTransaction = NeonTransactionRow;

export type RecentTransactionFilters = {
  estateSlug?: string;
  districtSlug?: string;
  /** "all" (the default) applies no deal_type predicate. */
  dealType?: NeonTransactionDealType | "all";
  /** "YYYY-MM" -- bounds deal_date to that calendar month. */
  month?: string;
  minPrice?: number;
  maxPrice?: number;
  limit?: number;
};

/**
 * Backs /transactions. Unlike fetchDistrictTransactions/
 * fetchEstateTransactions above (which stay scoped to their own existing
 * callers), this queries every district in one round trip via a dedicated
 * server query (fetchRecentTransactions in public-data.server.ts) that
 * accepts real filters and already applies the published/verification_state
 * gate -- see that function's own comment. Replaces the previous
 * implementation, which looped over three hardcoded district slugs and
 * merged/sorted/sliced the results client-side with no filter support.
 */
export async function fetchRecentTransactions(
  filters: RecentTransactionFilters = {},
): Promise<RecentTransaction[]> {
  const rows = await fetchNeonRecentTransactions({
    data: {
      estateSlug: filters.estateSlug,
      districtSlug: filters.districtSlug,
      dealType: filters.dealType,
      month: filters.month,
      minPrice: filters.minPrice,
      maxPrice: filters.maxPrice,
      limit: filters.limit ?? 24,
    },
  });
  return rows as RecentTransaction[];
}
