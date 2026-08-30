export type NeonListingSort = "newest" | "price_asc" | "price_desc" | "area" | "psf";

export type NeonListingFiltersInput = {
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
  total_units: number | null;
  lat: number | null;
  lng: number | null;
};

export type NeonPublicAgentProfile = {
  id: string;
  public_slug: string | null;
  name_zh: string | null;
  name_en: string | null;
  job_title: string | null;
  phone: string | null;
  whatsapp: string | null;
  licence_no: string | null;
  avatar_url: string | null;
  branch: string | null;
  bio: string | null;
  specialties: string[];
  served_estate_slugs: string[];
};

export type NeonStaffProfile = NeonPublicAgentProfile;

export type NeonPropertyRow = {
  id: string;
  listing_no: string;
  canonical_property_no: string | null;
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
  management_fee: number | null;
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
  profiles: NeonStaffProfile | null;
};

export type NeonListingSearchResult = {
  rows: NeonPropertyRow[];
  total: number;
};

export type NeonCorridorInventoryInput = {
  districtSlugs: string[];
  estateSlugs: string[];
  textAliases: string[];
  /**
   * Place names that must exclude a row even if it matches one of the
   * inclusion predicates above -- e.g. a `district_slug: "castle-peak-road"`
   * row whose title/address names a place outside the corridor. Applied as a
   * SQL-level `AND NOT (...)` so both the COUNT totals and the fetched rows
   * agree. See `corridorRegionScope.outOfScopeTextAliases` in
   * src/content/castle-peak-road.ts, the single source of truth for this list.
   */
  outOfScopeTextAliases: string[];
  limit: number;
};

export type NeonCorridorInventoryResult = {
  saleTotal: number;
  rentTotal: number;
  saleRows: NeonPropertyRow[];
  rentRows: NeonPropertyRow[];
};

export type NeonLegacyPropertyMatch = {
  listing_no: string;
} | null;

export type NeonEstateOption = {
  slug: string;
  name_zh: string;
};
