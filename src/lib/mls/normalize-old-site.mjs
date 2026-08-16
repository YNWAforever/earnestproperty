import { splitFeatureText } from "./parse-old-site.mjs";

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
  // detail.orientation is dropped here -- it already has its own dedicated
  // column below (`orientation: cleanNull(detail.orientation)`), so including
  // it here just duplicated it inside the free-text feature list.
  //
  // detail.remarks (備註) is dropped entirely, not just unsplit: on the old
  // site this field sometimes holds the company licence number instead of a
  // genuine property feature -- see the 備註 field in
  // scripts/old-site-migration/__fixtures__/property-detail-6709182.html,
  // which is literally "C-018613" -- and there is no way to tell a real
  // remark from that case here, so 物業特點 must not render it at all.
  //
  // roomText and decoration are each a comma/、-joined blob (e.g. "2房2廳，開放式廚房"),
  // so each is split into individual tags via the same splitFeatureText already
  // used by the other (legacy) parse path in parse-old-site.mjs -- previously
  // this function pushed the whole unsplit blob as a single "feature".
  const features = [...splitFeatureText(detail.roomText), ...splitFeatureText(detail.decoration)];

  return features.length ? [...new Set(features)] : null;
}

function descriptionFor(detail, dealType) {
  const raw = detail.metaDescription;
  if (!raw) return detail.title;

  // normalizeListingDetail emits one row PER deal type from a single scraped
  // page (see dealTypesFor/dealTypes.map below), but the scraped og:description
  // is one fact list built once for the whole page -- e.g.
  // "麗都花園 第03座, 荃灣, #B054805,售$590萬, 實用570呎, ..." (see
  // property-detail-6709182.html). Reusing it unmodified put a sale price
  // directly inside a rental's own description (and vice versa for a
  // sale-and-rent listing). Strip whichever price token does not belong to
  // this row's own deal type; the rest of the fact list (district, property
  // no, area, orientation, rooms) is still accurate for both rows.
  const opposingPricePattern =
    dealType === "rent" ? /售\$[\d,]+萬,?\s*/g : /租\$[\d,]+(?:\/月)?,?\s*/g;
  const stripped = raw.replace(opposingPricePattern, "").trim();
  return stripped || detail.title;
}

export function normalizeListingDetail(detail, options = {}) {
  // Without a legacy detail id we cannot build a stable, unique listing_no
  // (rows would collapse to OLD-null-* and collide on the NOT NULL UNIQUE
  // listing_no constraint). Skip the listing instead of emitting bad rows.
  if (!detail.legacyDetailId) {
    console.warn(
      `[mls] skipping listing without legacy detail id: ${detail.sourceUrl ?? "<unknown url>"}`,
    );
    return [];
  }

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
    description: descriptionFor(detail, dealType),
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
