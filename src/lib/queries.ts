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
  fetchNeonListingsForEstate,
  fetchNeonPropertyByLegacyDetailId,
  fetchNeonPropertyByListingNo,
  fetchNeonPublishedArticles,
  fetchNeonSimilarListings,
  searchNeonListings,
} from "@/lib/neon/public-data";
import type { NeonPropertyRow } from "@/lib/neon/public-data.types";

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
  total_units: number | null;
  avg_saleable_psf: number | null;
  hero_image: string | null;
};

export type FeaturedProperty = {
  id: string;
  listing_no: string;
  title_zh: string;
  deal_type: string;
  price: number | null;
  rent: number | null;
  saleable_area: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  features: string[] | null;
  images: string[] | null;
  estates: { name_zh: string; slug: string } | null;
};

export type FaqItem = { question: string; answer: string };

export async function fetchEstates(): Promise<EstateSummary[]> {
  return fetchEstatesByDistrict("sham-tseng");
}

export async function fetchEstatesByDistrict(districtSlug: string): Promise<EstateSummary[]> {
  const rows = await fetchNeonEstates({ data: { districtSlug } });
  return (rows as EstateSummary[]).map((estate) => withCanonicalSlug(estate));
}

export async function fetchEstateBySlug(slug: string) {
  for (const candidate of estateSlugCandidates(slug)) {
    const estate = await fetchNeonEstateBySlug({ data: { slug: candidate } });
    if (estate) {
      return withCanonicalSlug(
        estate as Record<string, unknown> & { slug: string },
        canonicalEstateSlug(slug),
      );
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

export async function fetchFeaturedProperties(): Promise<FeaturedProperty[]> {
  return (await fetchNeonFeaturedProperties({ data: { limit: 6 } })) as FeaturedProperty[];
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
  return estates.map((estate) => withCanonicalSlug(estate));
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
