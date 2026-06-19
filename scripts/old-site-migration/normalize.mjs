const DISTRICT_SLUGS = new Map([
  ["屯門", "tuen-mun"],
  ["荃灣", "tsuen-wan"],
  ["深井", "sham-tseng"],
  ["青山公路", "castle-peak-road"],
]);

export function normalizeDistrictSlug(districtZh) {
  return DISTRICT_SLUGS.get(districtZh) ?? "unknown";
}

export function normalizeListing(parsed) {
  const listingNo = parsed.legacyPropertyNo || `OLD-${parsed.legacyDetailId}`;

  return {
    listing_no: listingNo,
    title_zh: parsed.titleZh || listingNo,
    deal_type: parsed.dealType,
    district_slug: normalizeDistrictSlug(parsed.districtZh),
    price: parsed.price,
    rent: parsed.rent,
    saleable_area: parsed.saleableArea,
    gross_area: parsed.grossArea,
    orientation: parsed.orientation || null,
    features: parsed.features?.length ? parsed.features : null,
    description: parsed.description || null,
    images: parsed.images?.length ? parsed.images : null,
    status: "active",
    featured: false,
    source_site: "earnestproperty-old-public",
    legacy_detail_id: parsed.legacyDetailId,
    legacy_property_no: parsed.legacyPropertyNo,
    legacy_url: parsed.legacyUrl,
    legacy_source_indexes: parsed.legacySourceIndexes ?? [],
    last_scraped_at: new Date().toISOString(),
  };
}
