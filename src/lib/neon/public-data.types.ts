export type NeonListingFiltersInput = {
  deal: "sale" | "rent" | "all";
  minPrice?: number;
  maxPrice?: number;
  bedrooms?: number;
  estateSlug?: string;
  districtSlug?: string;
  page: number;
  pageSize: number;
};

export type NeonSimilarListingsInput = {
  estateId: string;
  dealType: "sale" | "rent";
  excludeId: string;
  limit: number;
};

export type NeonEstateSnapshot = {
  name_zh: string;
  slug: string;
  district_slug: string;
  year_completed: number | null;
  developer: string | null;
  lat: number | null;
  lng: number | null;
};

export type NeonPropertyRow = {
  id: string;
  listing_no: string;
  title_zh: string;
  title_en: string | null;
  deal_type: "sale" | "rent";
  estate_id: string | null;
  district_slug: string;
  address: string | null;
  price: number | null;
  rent: number | null;
  saleable_area: number | null;
  gross_area: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor: string | null;
  orientation: string | null;
  features: string[] | null;
  description: string | null;
  images: string[] | null;
  video_url: string | null;
  floorplan_url: string | null;
  status: string;
  featured: boolean;
  source_site: string | null;
  legacy_detail_id: string | null;
  legacy_property_no: string | null;
  legacy_url: string | null;
  source_url: string | null;
  source_updated_at: string | null;
  last_seen_at: string | null;
  last_scraped_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  estates: NeonEstateSnapshot | null;
  profiles: null;
};

export type NeonListingSearchResult = {
  rows: NeonPropertyRow[];
  total: number;
};

export type NeonLegacyPropertyMatch = {
  listing_no: string;
} | null;

export type NeonEstateOption = {
  slug: string;
  name_zh: string;
};
