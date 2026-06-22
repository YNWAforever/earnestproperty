import { supabase } from "@/integrations/supabase/client";
import {
  fetchNeonCorridorInventory,
  fetchNeonEstateOptions,
  fetchNeonFeaturedProperties,
  fetchNeonListingCountsByEstate,
  fetchNeonListingsForEstate,
  fetchNeonPropertyByLegacyDetailId,
  fetchNeonPropertyByListingNo,
  fetchNeonSimilarListings,
  searchNeonListings,
} from "@/lib/neon/public-data";

const ESTATE_DB_SLUG_FALLBACKS: Record<string, string> = {
  bellagio: "belvedere-garden",
  "rhine-garden": "sea-pearl-garden",
};

const MLS_PROPERTY_COLUMNS = [
  "legacy_detail_id",
  "last_seen_at",
  "source_site",
  "source_url",
  "source_updated_at",
];

const LISTING_SELECT_WITH_MLS =
  "id, listing_no, title_zh, deal_type, price, rent, saleable_area, bedrooms, bathrooms, floor, last_seen_at, source_site, images, estates(name_zh, slug)";
const LISTING_SELECT_LEGACY =
  "id, listing_no, title_zh, deal_type, price, rent, saleable_area, bedrooms, bathrooms, floor, images, estates(name_zh, slug)";
const CORRIDOR_COUNT_PAGE_SIZE = 1000;

type SupabaseColumnError = {
  code?: string;
  message?: string;
};

type ListingQueryResponse = {
  data: unknown[] | null;
  error: SupabaseColumnError | null;
  count?: number | null;
};

function isMissingMlsColumns(error: SupabaseColumnError | null) {
  if (!error) return false;
  const message = error.message ?? "";
  return error.code === "42703" && MLS_PROPERTY_COLUMNS.some((column) => message.includes(column));
}

function withEmptyMlsFields(rows: unknown[] | null) {
  return (rows ?? []).map((row) => ({
    ...(row as Record<string, unknown>),
    last_seen_at: null,
    source_site: null,
  }));
}

async function retryWithoutMlsColumns(
  withMls: () => Promise<ListingQueryResponse>,
  withoutMls: () => Promise<ListingQueryResponse>,
) {
  const result = await withMls();
  if (!isMissingMlsColumns(result.error)) return result;

  const fallback = await withoutMls();
  if (fallback.error) return fallback;
  return { ...fallback, data: withEmptyMlsFields(fallback.data) };
}

async function runWithSupabaseFallback<T>(
  neonRead: () => Promise<T>,
  supabaseRead: () => Promise<T>,
): Promise<T> {
  try {
    return await neonRead();
  } catch {
    return supabaseRead();
  }
}

function canonicalEstateSlug(dbSlug: string) {
  for (const [canonical, legacy] of Object.entries(ESTATE_DB_SLUG_FALLBACKS)) {
    if (legacy === dbSlug) return canonical;
  }
  return dbSlug;
}

async function fetchEstateByDbSlug(slug: string) {
  const { data, error } = await supabase.from("estates").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data;
}

async function resolveEstateId(slug: string) {
  const { data, error } = await supabase
    .from("estates")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (data?.id) return data.id;

  const fallback = ESTATE_DB_SLUG_FALLBACKS[slug];
  if (!fallback) return null;

  const { data: legacyData, error: legacyError } = await supabase
    .from("estates")
    .select("id")
    .eq("slug", fallback)
    .maybeSingle();
  if (legacyError) throw legacyError;
  return legacyData?.id ?? null;
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
  const { data, error } = await supabase
    .from("estates")
    .select("slug, name_zh, total_units, avg_saleable_psf, hero_image")
    .eq("district_slug", "sham-tseng")
    .order("total_units", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((estate) => ({ ...estate, slug: canonicalEstateSlug(estate.slug) }));
}

export async function fetchEstateBySlug(slug: string) {
  const data = await fetchEstateByDbSlug(slug);
  if (data) return { ...data, slug };

  const fallback = ESTATE_DB_SLUG_FALLBACKS[slug];
  if (!fallback) return null;

  const legacyData = await fetchEstateByDbSlug(fallback);
  if (legacyData) return { ...legacyData, slug };
  return null;
}

async function fetchFaqsByScope(scope: string): Promise<FaqItem[]> {
  const { data, error } = await supabase
    .from("faqs")
    .select("question, answer")
    .eq("scope", scope)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchFeaturedProperties(): Promise<FeaturedProperty[]> {
  return runWithSupabaseFallback(
    async () => {
      const rows = await fetchNeonFeaturedProperties({ data: { limit: 6 } });
      return rows as FeaturedProperty[];
    },
    async () => {
      const { data, error } = await supabase
        .from("properties")
        .select(
          "id, listing_no, title_zh, deal_type, price, rent, saleable_area, bedrooms, bathrooms, features, images, estates(name_zh, slug)",
        )
        .eq("status", "active")
        .eq("featured", true)
        .order("created_at", { ascending: false })
        .limit(6);
      if (error) throw error;
      return (data ?? []) as unknown as FeaturedProperty[];
    },
  );
}

export async function fetchFaqs(scope: string): Promise<FaqItem[]> {
  const data = await fetchFaqsByScope(scope);
  if (data.length > 0 || !scope.startsWith("estate:")) return data;

  const slug = scope.replace("estate:", "");
  const fallback = ESTATE_DB_SLUG_FALLBACKS[slug];
  return fallback ? fetchFaqsByScope(`estate:${fallback}`) : data;
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
  const since = new Date();
  since.setMonth(since.getMonth() - monthsBack);
  const { data, error } = await supabase
    .from("transactions")
    .select(
      "deal_date, saleable_psf, price, saleable_area, unit, estates!inner(name_zh, slug, district_slug)",
    )
    .eq("estates.district_slug", districtSlug)
    .eq("deal_type", "sale")
    .gte("deal_date", since.toISOString().slice(0, 10))
    .order("deal_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as DistrictTransaction[];
}

async function fetchPropertyByListingNoFromSupabase(listingNo: string) {
  const { data, error } = await supabase
    .from("properties")
    .select(
      `*,
       estates(slug, name_zh, district_slug, year_completed, developer),
       profiles:agent_id(id, name_zh, name_en, phone, whatsapp, licence_no, avatar_url, branch, bio)`,
    )
    .eq("listing_no", listingNo)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchPropertyByListingNo(listingNo: string) {
  return runWithSupabaseFallback(
    async () => {
      const property = await fetchNeonPropertyByListingNo({ data: { listingNo } });
      return property ?? fetchPropertyByListingNoFromSupabase(listingNo);
    },
    () => fetchPropertyByListingNoFromSupabase(listingNo),
  );
}

export async function fetchListingCountsByEstate() {
  return runWithSupabaseFallback(
    async () => new Map(Object.entries(await fetchNeonListingCountsByEstate())),
    async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("estate_id, estates(slug)")
        .eq("status", "active");
      if (error) throw error;

      const counts = new Map<string, number>();
      (data ?? []).forEach((row) => {
        const record = row as {
          estate_id?: string | null;
          estates?: { slug?: string | null } | { slug?: string | null }[] | null;
        };
        const estate = Array.isArray(record.estates) ? record.estates[0] : record.estates;
        const key = estate?.slug ? canonicalEstateSlug(estate.slug) : record.estate_id;
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      });
      return counts;
    },
  );
}

export type ListingFilters = {
  deal: "sale" | "rent" | "all";
  minPrice?: number;
  maxPrice?: number;
  bedrooms?: number; // 0 = studio, 4 = 4+
  estateSlug?: string;
  districtSlug?: string;
  page: number;
  pageSize: number;
};

export type ListingRow = {
  id: string;
  listing_no: string;
  title_zh: string;
  deal_type: "sale" | "rent";
  price: number | null;
  rent: number | null;
  saleable_area: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor: string | null;
  last_seen_at: string | null;
  source_site: string | null;
  images: string[] | null;
  estates: { name_zh: string; slug: string } | null;
};

type ListingIdentityRow = Pick<ListingRow, "id" | "listing_no">;

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
    estateSlugs: cleanCorridorTerms(input.estateSlugs),
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

function listingKey(row: ListingIdentityRow) {
  return row.listing_no || row.id;
}

function dedupeListingKeys(rows: ListingIdentityRow[]) {
  const keys = new Set<string>();
  rows.forEach((row) => {
    const key = listingKey(row);
    if (key) keys.add(key);
  });
  return keys;
}

function dedupeListingRows(rows: ListingRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = listingKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchCorridorInventoryFromSupabaseFallback(
  input: Required<CorridorInventoryAliasInput>,
): Promise<CorridorInventory> {
  if (!hasCorridorAliases(input)) return emptyCorridorInventory();

  const [saleInventory, rentInventory] = await Promise.all([
    fetchCorridorDealFromSupabase(input, "sale"),
    fetchCorridorDealFromSupabase(input, "rent"),
  ]);

  return {
    saleTotal: saleInventory.total,
    rentTotal: rentInventory.total,
    saleRows: saleInventory.rows,
    rentRows: rentInventory.rows,
  };
}

async function fetchCorridorDealFromSupabase(
  input: Required<CorridorInventoryAliasInput>,
  dealType: "sale" | "rent",
): Promise<{ rows: ListingRow[]; total: number }> {
  const estateIds = Array.from(
    new Set((await Promise.all(input.estateSlugs.map(resolveEstateId))).filter(Boolean)),
  ) as string[];

  const [rowSets, countRows] = await Promise.all([
    Promise.all([
      ...input.districtSlugs.map((districtSlug) =>
        fetchCorridorListingPageFromSupabase({
          deal: dealType,
          districtSlug,
          page: 1,
          pageSize: input.limit,
        }),
      ),
      ...estateIds.map((estateId) =>
        fetchCorridorListingPageFromSupabase(
          { deal: dealType, page: 1, pageSize: input.limit },
          estateId,
        ),
      ),
      ...input.textAliases.map((textAlias) =>
        fetchCorridorTextAliasPageFromSupabase(textAlias, dealType, input.limit),
      ),
    ]),
    fetchCorridorCountRowsFromSupabase(input, dealType, estateIds),
  ]);

  return {
    rows: dedupeListingRows(rowSets.flatMap((result) => result.rows)).slice(0, input.limit),
    total: dedupeListingKeys(countRows).size,
  };
}

async function fetchCorridorCountRowsFromSupabase(
  input: Required<CorridorInventoryAliasInput>,
  dealType: "sale" | "rent",
  estateIds: string[],
): Promise<ListingIdentityRow[]> {
  const rowSets = await Promise.all([
    ...input.districtSlugs.map((districtSlug) =>
      fetchCorridorListingIdentityRowsFromSupabase({ dealType, districtSlug }),
    ),
    ...estateIds.map((estateId) =>
      fetchCorridorListingIdentityRowsFromSupabase({ dealType, estateId }),
    ),
    ...input.textAliases.map((textAlias) =>
      fetchCorridorTextAliasIdentityRowsFromSupabase(textAlias, dealType),
    ),
  ]);

  return rowSets.flat();
}

async function fetchAllCorridorIdentityRows(
  runPage: (from: number, to: number) => Promise<ListingQueryResponse>,
): Promise<ListingIdentityRow[]> {
  const rows: ListingIdentityRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await runPage(from, from + CORRIDOR_COUNT_PAGE_SIZE - 1);
    if (error) throw error;

    const page = (data ?? []) as unknown as ListingIdentityRow[];
    rows.push(...page);
    if (page.length < CORRIDOR_COUNT_PAGE_SIZE) break;
    from += CORRIDOR_COUNT_PAGE_SIZE;
  }

  return rows;
}

async function fetchCorridorListingIdentityRowsFromSupabase(input: {
  dealType: "sale" | "rent";
  districtSlug?: string;
  estateId?: string;
}) {
  return fetchAllCorridorIdentityRows(async (from, to) => {
    let q = supabase
      .from("properties")
      .select("id, listing_no")
      .eq("status", "active")
      .eq("deal_type", input.dealType);

    if (input.districtSlug) q = q.eq("district_slug", input.districtSlug);
    if (input.estateId) q = q.eq("estate_id", input.estateId);

    const { data, error } = await q.order("created_at", { ascending: false }).range(from, to);
    return { data, error };
  });
}

async function fetchCorridorListingPageFromSupabase(
  filters: ListingFilters,
  estateId: string | null = null,
): Promise<{ rows: ListingRow[]; total: number }> {
  const { data, error, count } = await retryWithoutMlsColumns(
    () => runListingSearch(filters, 0, filters.pageSize - 1, estateId, true),
    () => runListingSearch(filters, 0, filters.pageSize - 1, estateId, false),
  );
  if (error) throw error;
  return { rows: (data ?? []) as unknown as ListingRow[], total: count ?? 0 };
}

function escapeSupabaseLikeTerm(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

async function runCorridorTextAliasSearch(
  textAlias: string,
  dealType: "sale" | "rent",
  limit: number,
  includeMlsColumns: boolean,
): Promise<ListingQueryResponse> {
  const pattern = `%${escapeSupabaseLikeTerm(textAlias)}%`;
  let q = supabase
    .from("properties")
    .select(includeMlsColumns ? LISTING_SELECT_WITH_MLS : LISTING_SELECT_LEGACY, {
      count: "exact",
    })
    .eq("status", "active")
    .eq("deal_type", dealType)
    .or(
      [
        `title_zh.ilike.${pattern}`,
        `title_en.ilike.${pattern}`,
        `address.ilike.${pattern}`,
        `district_slug.ilike.${pattern}`,
      ].join(","),
    )
    .order("featured", { ascending: false });

  if (includeMlsColumns) q = q.order("last_seen_at", { ascending: false, nullsFirst: false });
  q = q.order("created_at", { ascending: false }).limit(limit);

  const { data, error, count } = await q;
  return { data, error, count };
}

async function fetchCorridorTextAliasPageFromSupabase(
  textAlias: string,
  dealType: "sale" | "rent",
  limit: number,
): Promise<{ rows: ListingRow[]; total: number }> {
  const { data, error, count } = await retryWithoutMlsColumns(
    () => runCorridorTextAliasSearch(textAlias, dealType, limit, true),
    () => runCorridorTextAliasSearch(textAlias, dealType, limit, false),
  );
  if (error) throw error;
  return { rows: (data ?? []) as unknown as ListingRow[], total: count ?? 0 };
}

async function fetchCorridorTextAliasIdentityRowsFromSupabase(
  textAlias: string,
  dealType: "sale" | "rent",
) {
  const pattern = `%${escapeSupabaseLikeTerm(textAlias)}%`;
  return fetchAllCorridorIdentityRows(async (from, to) => {
    const { data, error } = await supabase
      .from("properties")
      .select("id, listing_no")
      .eq("status", "active")
      .eq("deal_type", dealType)
      .or(
        [
          `title_zh.ilike.${pattern}`,
          `title_en.ilike.${pattern}`,
          `address.ilike.${pattern}`,
          `district_slug.ilike.${pattern}`,
        ].join(","),
      )
      .order("created_at", { ascending: false })
      .range(from, to);
    return { data, error };
  });
}

export async function fetchCorridorInventoryForAliases(
  input: CorridorInventoryAliasInput,
): Promise<CorridorInventory> {
  const normalized = normalizeCorridorInventoryInput(input);
  if (!hasCorridorAliases(normalized)) return emptyCorridorInventory();

  return runWithSupabaseFallback(
    async () => {
      const result = await fetchNeonCorridorInventory({ data: normalized });
      return {
        saleTotal: result.saleTotal,
        rentTotal: result.rentTotal,
        saleRows: result.saleRows as ListingRow[],
        rentRows: result.rentRows as ListingRow[],
      };
    },
    () => fetchCorridorInventoryFromSupabaseFallback(normalized),
  );
}

async function runListingSearch(
  f: ListingFilters,
  from: number,
  to: number,
  estateId: string | null,
  includeMlsColumns: boolean,
): Promise<ListingQueryResponse> {
  let q = supabase
    .from("properties")
    .select(includeMlsColumns ? LISTING_SELECT_WITH_MLS : LISTING_SELECT_LEGACY, {
      count: "exact",
    })
    .eq("status", "active");

  if (f.deal !== "all") q = q.eq("deal_type", f.deal);
  if (f.districtSlug) q = q.eq("district_slug", f.districtSlug);

  const priceCol = f.deal === "rent" ? "rent" : "price";
  if (f.minPrice !== undefined) q = q.gte(priceCol, f.minPrice);
  if (f.maxPrice !== undefined) q = q.lte(priceCol, f.maxPrice);

  if (f.bedrooms !== undefined) {
    if (f.bedrooms >= 4) q = q.gte("bedrooms", 4);
    else q = q.eq("bedrooms", f.bedrooms);
  }

  if (estateId) q = q.eq("estate_id", estateId);

  q = q.order("featured", { ascending: false });
  if (includeMlsColumns) q = q.order("last_seen_at", { ascending: false, nullsFirst: false });
  q = q.order("created_at", { ascending: false }).range(from, to);

  const { data, error, count } = await q;
  return { data, error, count };
}

export async function searchListings(f: ListingFilters): Promise<{
  rows: ListingRow[];
  total: number;
}> {
  return runWithSupabaseFallback(
    async () => {
      const result = await searchNeonListings({ data: f });
      return { rows: result.rows as ListingRow[], total: result.total };
    },
    async () => {
      const from = (f.page - 1) * f.pageSize;
      const to = from + f.pageSize - 1;

      const estateId = f.estateSlug ? await resolveEstateId(f.estateSlug) : null;
      if (f.estateSlug && !estateId) return { rows: [], total: 0 };

      const { data, error, count } = await retryWithoutMlsColumns(
        () => runListingSearch(f, from, to, estateId, true),
        () => runListingSearch(f, from, to, estateId, false),
      );
      if (error) throw error;
      return { rows: (data ?? []) as unknown as ListingRow[], total: count ?? 0 };
    },
  );
}

async function fetchListingsForEstateFromSupabase(
  estateSlug: string,
  limit = 6,
): Promise<ListingRow[]> {
  const estateId = await resolveEstateId(estateSlug);
  if (!estateId) return [];

  const runEstateListings = async (includeMlsColumns: boolean): Promise<ListingQueryResponse> => {
    let q = supabase
      .from("properties")
      .select(includeMlsColumns ? LISTING_SELECT_WITH_MLS : LISTING_SELECT_LEGACY)
      .eq("status", "active")
      .eq("estate_id", estateId)
      .order("featured", { ascending: false });

    if (includeMlsColumns) q = q.order("last_seen_at", { ascending: false, nullsFirst: false });
    q = q.order("created_at", { ascending: false }).limit(limit);

    const { data, error } = await q;
    return { data, error };
  };

  const { data, error } = await retryWithoutMlsColumns(
    () => runEstateListings(true),
    () => runEstateListings(false),
  );
  if (error) throw error;
  return (data ?? []) as unknown as ListingRow[];
}

export async function fetchListingsForEstate(estateSlug: string, limit = 6): Promise<ListingRow[]> {
  return runWithSupabaseFallback(
    async () => {
      const rows = (await fetchNeonListingsForEstate({
        data: { estateSlug, limit },
      })) as ListingRow[];
      return rows.length > 0 ? rows : fetchListingsForEstateFromSupabase(estateSlug, limit);
    },
    () => fetchListingsForEstateFromSupabase(estateSlug, limit),
  );
}

async function fetchPropertyByLegacyDetailIdFromSupabase(oldId: string) {
  const { data, error } = await supabase
    .from("properties")
    .select("listing_no")
    .eq("legacy_detail_id", oldId)
    .eq("status", "active")
    .order("deal_type", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (isMissingMlsColumns(error)) return null;
  if (error) throw error;
  return data;
}

export async function fetchPropertyByLegacyDetailId(oldId: string) {
  return runWithSupabaseFallback(
    async () => {
      const match = await fetchNeonPropertyByLegacyDetailId({ data: { oldId } });
      return match ?? fetchPropertyByLegacyDetailIdFromSupabase(oldId);
    },
    () => fetchPropertyByLegacyDetailIdFromSupabase(oldId),
  );
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

async function fetchSimilarListingsFromSupabase(
  estateId: string,
  dealType: "sale" | "rent",
  excludeId: string,
  limit = 4,
): Promise<SimilarListing[]> {
  const { data, error } = await supabase
    .from("properties")
    .select("id, listing_no, title_zh, deal_type, price, rent, saleable_area, bedrooms, images")
    .eq("status", "active")
    .eq("estate_id", estateId)
    .eq("deal_type", dealType)
    .neq("id", excludeId)
    .order("featured", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as SimilarListing[];
}

export async function fetchSimilarListings(
  estateId: string,
  dealType: "sale" | "rent",
  excludeId: string,
  limit = 4,
): Promise<SimilarListing[]> {
  return runWithSupabaseFallback(
    async () => {
      const rows = (await fetchNeonSimilarListings({
        data: { estateId, dealType, excludeId, limit },
      })) as SimilarListing[];
      return rows.length > 0
        ? rows
        : fetchSimilarListingsFromSupabase(estateId, dealType, excludeId, limit);
    },
    () => fetchSimilarListingsFromSupabase(estateId, dealType, excludeId, limit),
  );
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
  const { data, error } = await supabase
    .from("transactions")
    .select("deal_date, unit, saleable_area, saleable_psf, price")
    .eq("estate_id", estateId)
    .eq("deal_type", "sale")
    .order("deal_date", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as EstateTransaction[];
}

async function fetchEstateOptionsFromSupabase() {
  const { data, error } = await supabase.from("estates").select("slug, name_zh").order("name_zh");
  if (error) throw error;
  return (data ?? []).map((estate) => ({ ...estate, slug: canonicalEstateSlug(estate.slug) }));
}

export async function fetchEstateOptions() {
  return runWithSupabaseFallback(async () => {
    const estates = await fetchNeonEstateOptions();
    return estates.length > 0 ? estates : fetchEstateOptionsFromSupabase();
  }, fetchEstateOptionsFromSupabase);
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
  const { data, error } = await supabase
    .from("articles")
    .select("slug, title, excerpt, cover_image, category, reading_minutes, published_at")
    .eq("published", true)
    .order("published_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchArticleBySlug(slug: string) {
  const { data, error } = await supabase
    .from("articles")
    .select("slug, title, excerpt, content, cover_image, category, reading_minutes, published_at")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}
