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
  fetchNeonSimilarListings,
  searchNeonListings,
} from "@/lib/neon/public-data";
import type { NeonEstateOption, NeonPropertyRow } from "@/lib/neon/public-data.types";
import { isWithinCorridorRegion } from "@/content/castle-peak-road";

const ESTATE_DB_SLUG_FALLBACKS: Record<string, string> = {
  bellagio: "belvedere-garden",
  "rhine-garden": "sea-pearl-garden",
};

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

  return rows
    .filter((row) =>
      isWithinCorridorRegion({
        districtSlug: row.district_slug,
        estateSlug: row.estates?.slug,
        estateDistrictSlug: row.estates?.district_slug,
        text: [row.title_zh, row.address, row.estates?.name_zh],
      }),
    )
    .slice(0, FEATURED_DISPLAY_LIMIT);
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
  return (await fetchNeonPropertyByListingNo({ data: { listingNo } })) as NeonPropertyRow | null;
}

export async function fetchListingCountsByEstate() {
  return new Map(Object.entries(await fetchNeonListingCountsByEstate()));
}

export type ListingFilters = {
  deal: "sale" | "rent" | "all";
  keyword?: string;
  minPrice?: number;
  maxPrice?: number;
  bedrooms?: number;
  estateSlug?: string;
  districtSlug?: string;
  page: number;
  pageSize: number;
};

export type ListingRow = Pick<
  NeonPropertyRow,
  | "id"
  | "listing_no"
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

function emptyCorridorInventory(): CorridorInventory {
  return {
    saleTotal: 0,
    rentTotal: 0,
    saleRows: [],
    rentRows: [],
  };
}

export async function fetchCorridorInventoryForAliases(
  input: CorridorInventoryAliasInput,
): Promise<CorridorInventory> {
  const normalized = normalizeCorridorInventoryInput(input);
  if (!hasCorridorAliases(normalized)) return emptyCorridorInventory();
  const result = await fetchNeonCorridorInventory({ data: normalized });
  return {
    saleTotal: result.saleTotal,
    rentTotal: result.rentTotal,
    saleRows: result.saleRows as ListingRow[],
    rentRows: result.rentRows as ListingRow[],
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
      return { rows: result.rows as ListingRow[], total: result.total };
    }
    lastResult = result;
  }

  return {
    rows: (lastResult?.rows ?? []) as ListingRow[],
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
};

export async function fetchCmsVideos(): Promise<CmsVideo[]> {
  return (await fetchNeonCmsVideos()) as CmsVideo[];
}

export async function fetchVideoListings(limit = 12): Promise<VideoListing[]> {
  const result = await searchListings({
    deal: "all",
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
    if (rows.length > 0) return rows;
  }
  return [];
}

export async function fetchListingsForAgent(agentId: string, limit = 6): Promise<ListingRow[]> {
  return (await fetchNeonListingsForAgent({ data: { agentId, limit } })) as ListingRow[];
}

export async function fetchPropertyByLegacyDetailId(oldId: string) {
  return fetchNeonPropertyByLegacyDetailId({ data: { oldId } });
}

export type SimilarListing = {
  id: string;
  listing_no: string;
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
  return (await fetchNeonSimilarListings({
    data: { estateId, dealType, excludeId, limit },
  })) as SimilarListing[];
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
  return (await fetchNeonEstateTransactions({ data: { estateId, limit } })) as EstateTransaction[];
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

export type RecentTransaction = DistrictTransaction & {
  districtSlug: string;
};

export async function fetchRecentTransactions(limit = 20): Promise<RecentTransaction[]> {
  const districtSlugs = ["sham-tseng", "ting-kau", "tsuen-wan"];
  const rows = await Promise.all(
    districtSlugs.map(async (districtSlug) => {
      const transactions = await fetchDistrictTransactions(districtSlug, 12);
      return transactions.map((transaction) => ({ ...transaction, districtSlug }));
    }),
  );

  return rows
    .flat()
    .sort((a, b) => {
      const left = a.deal_date ? new Date(a.deal_date).getTime() : 0;
      const right = b.deal_date ? new Date(b.deal_date).getTime() : 0;
      return right - left;
    })
    .slice(0, limit);
}
