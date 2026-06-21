const ESTATE_PATTERNS = [
  ["bellagio", [/碧堤半島/i, /BELLAGIO/i]],
  ["sea-crest-villa", [/浪翠園/i, /SEA CREST VILLA/i]],
  ["hong-kong-garden", [/豪景花園/i, /HONG KONG GARDEN/i]],
  ["rhine-garden", [/海韻花園/i, /RHINE GARDEN/i]],
  ["lido-garden", [/麗都花園/i, /LIDO GDN/i, /LIDO GARDEN/i]],
];

export function resolveEstateSlug(detail) {
  const haystack = `${detail.buildingZh ?? ""} ${detail.buildingEn ?? ""}`.toUpperCase();

  for (const [slug, patterns] of ESTATE_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(haystack))) return slug;
  }

  return null;
}

export function inferDistrictSlug(detail) {
  const haystack = `${detail.streetZh ?? ""} ${detail.streetEn ?? ""} ${detail.buildingZh ?? ""}`;

  if (/汀九|TING KAU|觀海別墅|嘉御龍庭|汀九別墅/i.test(haystack)) return "ting-kau";
  if (/深井|SHAM TSENG|麗都花園|碧堤半島|浪翠園|海韻花園/i.test(haystack)) return "sham-tseng";
  if (/荃灣|TSUEN WAN|海雲軒|縉皇居/i.test(haystack)) return "tsuen-wan";
  if (/青山公路|CASTLE PEAK/i.test(haystack)) return "castle-peak-road";

  return "tsuen-wan";
}

function cleanNull(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function baseListingNo(detail) {
  return detail.legacyPropertyNo || `OLD-${detail.legacyDetailId}`;
}

function listingNo(detail, dealType) {
  return `${baseListingNo(detail)}-${detail.legacyDetailId}-${dealType === "rent" ? "R" : "S"}`;
}

function titleFor(detail, dealType) {
  const building = detail.buildingZh || detail.title.replace(/ - 晉誠地產$/, "");
  const action = dealType === "rent" ? "租盤" : "售盤";
  return `${building} ${action} #${baseListingNo(detail)}`;
}

function dealTypesFor(detail) {
  const dealTypes = [];
  if (detail.salePriceHkd) dealTypes.push("sale");
  if (detail.rentHkd) dealTypes.push("rent");
  return dealTypes;
}

function featuresFor(detail) {
  const features = [detail.roomText, detail.orientation, detail.decoration, detail.remarks].filter(
    Boolean,
  );

  return features.length ? [...new Set(features)] : null;
}

export function normalizeListingDetail(detail, options = {}) {
  const estateIdsBySlug = options.estateIdsBySlug ?? new Map();
  const estateSlug = resolveEstateSlug(detail);
  const estateId = estateSlug ? (estateIdsBySlug.get(estateSlug) ?? null) : null;
  const districtSlug = inferDistrictSlug(detail);
  const nowIso = options.nowIso ?? new Date().toISOString();
  const dealTypes = dealTypesFor(detail);

  return dealTypes.map((dealType) => ({
    listing_no: listingNo(detail, dealType),
    title_zh: titleFor(detail, dealType),
    title_en: null,
    deal_type: dealType,
    estate_id: estateId,
    district_slug: districtSlug,
    address: [detail.streetZh, detail.buildingZh].filter(Boolean).join(" "),
    price: dealType === "sale" ? detail.salePriceHkd : null,
    rent: dealType === "rent" ? detail.rentHkd : null,
    saleable_area: detail.saleableArea,
    gross_area: detail.grossArea,
    bedrooms: detail.bedrooms,
    bathrooms: null,
    floor: cleanNull(detail.floor),
    orientation: cleanNull(detail.orientation),
    features: featuresFor(detail),
    description: detail.metaDescription || detail.title,
    images: detail.images?.length ? detail.images : null,
    status: "active",
    featured: false,
    legacy_detail_id: detail.legacyDetailId,
    legacy_property_no: detail.legacyPropertyNo,
    legacy_url: detail.sourceUrl,
    legacy_source_indexes: options.legacySourceIndexes ?? [],
    source_site: "earnestproperty-old-site",
    source_url: detail.sourceUrl,
    source_updated_at: detail.sourceUpdatedAt,
    last_seen_at: nowIso,
    last_scraped_at: nowIso,
  }));
}
