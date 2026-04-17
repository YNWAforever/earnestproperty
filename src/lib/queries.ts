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
  const { data, error } = await supabase
    .from("estates")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchFeaturedProperties(): Promise<FeaturedProperty[]> {
  const { data, error } = await supabase
    .from("properties")
    .select(
      "id, listing_no, title_zh, deal_type, price, rent, saleable_area, bedrooms, bathrooms, features, images, estates(name_zh, slug)"
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
  monthsBack = 12
): Promise<DistrictTransaction[]> {
  const since = new Date();
  since.setMonth(since.getMonth() - monthsBack);
  const { data, error } = await supabase
    .from("transactions")
    .select(
      "deal_date, saleable_psf, price, saleable_area, unit, estates!inner(name_zh, slug, district_slug)"
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
       profiles:agent_id(id, name_zh, name_en, phone, whatsapp, licence_no, avatar_url, branch, bio)`
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
