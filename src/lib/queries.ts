import { supabase } from "@/integrations/supabase/client";

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
  return data ?? [];
}

export async function fetchEstateBySlug(slug: string) {
  const { data, error } = await supabase.from("estates").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchFeaturedProperties(): Promise<FeaturedProperty[]> {
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
}

export async function fetchFaqs(scope: string): Promise<FaqItem[]> {
  const { data, error } = await supabase
    .from("faqs")
    .select("question, answer")
    .eq("scope", scope)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
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

export async function fetchPropertyByListingNo(listingNo: string) {
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

export async function fetchListingCountsByEstate() {
  const { data, error } = await supabase
    .from("properties")
    .select("estate_id")
    .eq("status", "active");
  if (error) throw error;
  const counts = new Map<string, number>();
  (data ?? []).forEach((r) => {
    if (r.estate_id) counts.set(r.estate_id, (counts.get(r.estate_id) ?? 0) + 1);
  });
  return counts;
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

export async function searchListings(f: ListingFilters): Promise<{
  rows: ListingRow[];
  total: number;
}> {
  const from = (f.page - 1) * f.pageSize;
  const to = from + f.pageSize - 1;

  let q = supabase
    .from("properties")
    .select(
      "id, listing_no, title_zh, deal_type, price, rent, saleable_area, bedrooms, bathrooms, floor, last_seen_at, source_site, images, estates(name_zh, slug)",
      { count: "exact" },
    )
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

  if (f.estateSlug) {
    const { data: est } = await supabase
      .from("estates")
      .select("id")
      .eq("slug", f.estateSlug)
      .maybeSingle();
    if (est?.id) q = q.eq("estate_id", est.id);
    else return { rows: [], total: 0 };
  }

  q = q
    .order("featured", { ascending: false })
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as ListingRow[], total: count ?? 0 };
}

export async function fetchListingsForEstate(estateSlug: string, limit = 6): Promise<ListingRow[]> {
  const { data: estate, error: estateError } = await supabase
    .from("estates")
    .select("id")
    .eq("slug", estateSlug)
    .maybeSingle();
  if (estateError) throw estateError;
  if (!estate?.id) return [];

  const { data, error } = await supabase
    .from("properties")
    .select(
      "id, listing_no, title_zh, deal_type, price, rent, saleable_area, bedrooms, bathrooms, floor, last_seen_at, source_site, images, estates(name_zh, slug)",
    )
    .eq("status", "active")
    .eq("estate_id", estate.id)
    .order("featured", { ascending: false })
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as ListingRow[];
}

export async function fetchPropertyByLegacyDetailId(oldId: string) {
  const { data, error } = await supabase
    .from("properties")
    .select("listing_no")
    .eq("legacy_detail_id", oldId)
    .eq("status", "active")
    .order("deal_type", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
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

export async function fetchEstateOptions() {
  const { data, error } = await supabase.from("estates").select("slug, name_zh").order("name_zh");
  if (error) throw error;
  return data ?? [];
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
