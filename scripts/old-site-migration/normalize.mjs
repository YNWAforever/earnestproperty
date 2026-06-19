const DISTRICT_SLUGS = new Map([
  ["屯門", "tuen-mun"],
  ["荃灣", "tsuen-wan"],
  ["深井", "sham-tseng"],
  ["青山公路", "castle-peak-road"],
]);

export function normalizeDistrictSlug(districtZh) {
  return DISTRICT_SLUGS.get(districtZh) ?? "unknown";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function baseListingNo(parsed) {
  return parsed.legacyPropertyNo || `OLD-${parsed.legacyDetailId}`;
}

function hasNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function dealTypesFor(parsed) {
  const dealTypes = [];
  if (hasNumber(parsed.price)) dealTypes.push("sale");
  if (hasNumber(parsed.rent)) dealTypes.push("rent");
  if (!dealTypes.length) dealTypes.push(parsed.dealType === "sale" ? "sale" : "rent");
  return unique(dealTypes);
}

function listingNoFor(baseNo, dealType, dealTypesForBase) {
  if (dealType === "rent" && dealTypesForBase.has("sale")) return `${baseNo}-R`;
  return baseNo;
}

function detailScore(parsed) {
  return [
    parsed.legacySourceIndexes?.length ?? 0,
    Number(parsed.legacyDetailId) || 0,
    parsed.images?.length ?? 0,
    parsed.description ? 1 : 0,
  ];
}

function compareParsed(a, b) {
  const aScore = detailScore(a);
  const bScore = detailScore(b);

  for (let index = 0; index < aScore.length; index += 1) {
    if (aScore[index] !== bScore[index]) return bScore[index] - aScore[index];
  }

  return String(a.legacyDetailId ?? "").localeCompare(String(b.legacyDetailId ?? ""));
}

function mergeParsed(existing, incoming) {
  return {
    ...incoming,
    ...Object.fromEntries(
      Object.entries(existing).filter(([, value]) => {
        if (Array.isArray(value)) return value.length > 0;
        return value !== null && value !== undefined && value !== "";
      }),
    ),
    legacySourceIndexes: unique([
      ...(existing.legacySourceIndexes ?? []),
      ...(incoming.legacySourceIndexes ?? []),
    ]),
    images: unique([...(existing.images ?? []), ...(incoming.images ?? [])]),
    features: unique([...(existing.features ?? []), ...(incoming.features ?? [])]),
  };
}

function canonicalParsed(candidates) {
  return [...candidates].sort(compareParsed)[0];
}

function variantValues(parsed, dealType) {
  return {
    dealType,
    price: dealType === "sale" ? parsed.price : null,
    rent: dealType === "rent" ? parsed.rent : null,
  };
}

function overrideValue(overrides, key, fallback) {
  return Object.hasOwn(overrides, key) ? overrides[key] : fallback;
}

function normalizeAlias(parsed, dealTypesByBase) {
  const baseNo = baseListingNo(parsed);
  const targetDealType = hasNumber(parsed.price)
    ? "sale"
    : hasNumber(parsed.rent)
      ? "rent"
      : parsed.dealType;

  return {
    legacyDetailId: parsed.legacyDetailId,
    listingNo: listingNoFor(baseNo, targetDealType, dealTypesByBase.get(baseNo) ?? new Set()),
  };
}

export function normalizeListing(parsed, overrides = {}) {
  const listingNo = overrides.listingNo ?? baseListingNo(parsed);
  const dealType = overrides.dealType ?? parsed.dealType;

  return {
    listing_no: listingNo,
    title_zh: parsed.titleZh || listingNo,
    deal_type: dealType,
    district_slug: normalizeDistrictSlug(parsed.districtZh),
    price: overrideValue(overrides, "price", parsed.price),
    rent: overrideValue(overrides, "rent", parsed.rent),
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
    legacy_source_indexes: overrides.legacySourceIndexes ?? parsed.legacySourceIndexes ?? [],
    last_scraped_at: overrides.lastScrapedAt ?? new Date().toISOString(),
  };
}

export function buildMigrationDataset(parsedListings, options = {}) {
  const skipped = [];
  const byDetailId = new Map();
  const detailIdDuplicates = new Map();

  for (const parsed of parsedListings) {
    if (!parsed.legacyDetailId) {
      skipped.push({ reason: "missing_legacy_detail_id", legacyUrl: parsed.legacyUrl });
      continue;
    }

    const existing = byDetailId.get(parsed.legacyDetailId);
    if (existing) {
      detailIdDuplicates.set(
        parsed.legacyDetailId,
        (detailIdDuplicates.get(parsed.legacyDetailId) ?? 1) + 1,
      );
      byDetailId.set(parsed.legacyDetailId, mergeParsed(existing, parsed));
      continue;
    }

    byDetailId.set(parsed.legacyDetailId, parsed);
  }

  const deduped = [...byDetailId.values()];
  const dealTypesByBase = new Map();

  for (const parsed of deduped) {
    const baseNo = baseListingNo(parsed);
    const dealTypes = dealTypesByBase.get(baseNo) ?? new Set();
    for (const dealType of dealTypesFor(parsed)) dealTypes.add(dealType);
    dealTypesByBase.set(baseNo, dealTypes);
  }

  const groups = new Map();

  for (const parsed of deduped) {
    const baseNo = baseListingNo(parsed);

    for (const dealType of dealTypesFor(parsed)) {
      const key = `${baseNo}\0${dealType}`;
      const group = groups.get(key) ?? {
        baseNo,
        dealType,
        candidates: [],
        legacySourceIndexes: [],
      };

      group.candidates.push(parsed);
      group.legacySourceIndexes = unique([
        ...group.legacySourceIndexes,
        ...(parsed.legacySourceIndexes ?? []),
      ]);
      groups.set(key, group);
    }
  }

  const rows = [...groups.values()].map((group) => {
    const parsed = canonicalParsed(group.candidates);
    const dealTypesForBase = dealTypesByBase.get(group.baseNo) ?? new Set();
    const listingNo = listingNoFor(group.baseNo, group.dealType, dealTypesForBase);

    return normalizeListing(parsed, {
      ...variantValues(parsed, group.dealType),
      listingNo,
      legacySourceIndexes: group.legacySourceIndexes,
      lastScrapedAt: options.lastScrapedAt,
    });
  });

  const aliases = deduped.map((parsed) => normalizeAlias(parsed, dealTypesByBase));
  const propertyCounts = new Map();

  for (const parsed of deduped) {
    const baseNo = baseListingNo(parsed);
    propertyCounts.set(baseNo, (propertyCounts.get(baseNo) ?? 0) + 1);
  }

  const duplicatePropertyNumbers = [...propertyCounts.entries()]
    .filter(([, parsedCount]) => parsedCount > 1)
    .map(([legacyPropertyNo, parsedListingsCount]) => ({
      legacyPropertyNo,
      parsedListings: parsedListingsCount,
      importedRows: rows.filter((row) => row.legacy_property_no === legacyPropertyNo).length,
    }));

  return {
    rows,
    aliases,
    summary: {
      parsedListings: parsedListings.length,
      dedupedDetailListings: deduped.length,
      importedRows: rows.length,
      aliases: aliases.length,
      skipped,
      duplicateDetailIds: [...detailIdDuplicates.entries()].map(([legacyDetailId, count]) => ({
        legacyDetailId,
        count,
      })),
      duplicatePropertyNumbers,
      dualSaleRentListings: deduped.filter(
        (listing) => hasNumber(listing.price) && hasNumber(listing.rent),
      ).length,
    },
  };
}
