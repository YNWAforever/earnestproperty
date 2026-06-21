import "@tanstack/react-start/server-only";

import { neon } from "@neondatabase/serverless";

import type {
  NeonEstateOption,
  NeonLegacyPropertyMatch,
  NeonListingFiltersInput,
  NeonListingSearchResult,
  NeonPropertyRow,
  NeonSimilarListingsInput,
} from "./public-data.types";

type DbRow = Record<string, unknown>;

const listingColumns = `
  p.id,
  p.listing_no,
  p.title_zh,
  p.title_en,
  p.deal_type,
  p.price,
  p.rent,
  p.saleable_area,
  p.gross_area,
  p.bedrooms,
  p.bathrooms,
  p.floor,
  p.orientation,
  p.features,
  p.description,
  p.images,
  p.video_url,
  p.floorplan_url,
  p.estate_id,
  p.district_slug,
  p.address,
  p.status,
  p.featured,
  p.source_site,
  p.legacy_detail_id,
  p.legacy_property_no,
  p.legacy_url,
  p.source_url,
  p.source_updated_at,
  p.last_seen_at,
  p.last_scraped_at,
  p.created_at,
  p.updated_at,
  e.name_zh AS estate_name_zh,
  e.slug AS estate_slug,
  e.district_slug AS estate_district_slug,
  e.year_completed AS estate_year_completed,
  e.developer AS estate_developer,
  e.lat AS estate_lat,
  e.lng AS estate_lng
`;

function sql() {
  const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is required.");
  return neon(databaseUrl);
}

function stringOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function stringOrEmpty(value: unknown) {
  return stringOrNull(value) ?? "";
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function booleanOrFalse(value: unknown) {
  return value === true;
}

function dateOrNull(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function textArrayOrNull(value: unknown) {
  if (!Array.isArray(value)) return null;
  return value.map(String);
}

function dealType(value: unknown): "sale" | "rent" {
  return value === "rent" ? "rent" : "sale";
}

function mapListingRow(row: DbRow): NeonPropertyRow {
  const estateSlug = stringOrNull(row.estate_slug);
  const estate = estateSlug
    ? {
        name_zh: stringOrEmpty(row.estate_name_zh),
        slug: estateSlug,
        district_slug: stringOrEmpty(row.estate_district_slug),
        year_completed: numberOrNull(row.estate_year_completed),
        developer: stringOrNull(row.estate_developer),
        lat: numberOrNull(row.estate_lat),
        lng: numberOrNull(row.estate_lng),
      }
    : null;

  return {
    id: stringOrEmpty(row.id),
    listing_no: stringOrEmpty(row.listing_no),
    title_zh: stringOrEmpty(row.title_zh),
    title_en: stringOrNull(row.title_en),
    deal_type: dealType(row.deal_type),
    estate_id: stringOrNull(row.estate_id),
    district_slug: stringOrEmpty(row.district_slug),
    address: stringOrNull(row.address),
    price: numberOrNull(row.price),
    rent: numberOrNull(row.rent),
    saleable_area: numberOrNull(row.saleable_area),
    gross_area: numberOrNull(row.gross_area),
    bedrooms: numberOrNull(row.bedrooms),
    bathrooms: numberOrNull(row.bathrooms),
    floor: stringOrNull(row.floor),
    orientation: stringOrNull(row.orientation),
    features: textArrayOrNull(row.features),
    description: stringOrNull(row.description),
    images: textArrayOrNull(row.images),
    video_url: stringOrNull(row.video_url),
    floorplan_url: stringOrNull(row.floorplan_url),
    status: stringOrEmpty(row.status),
    featured: booleanOrFalse(row.featured),
    source_site: stringOrNull(row.source_site),
    legacy_detail_id: stringOrNull(row.legacy_detail_id),
    legacy_property_no: stringOrNull(row.legacy_property_no),
    legacy_url: stringOrNull(row.legacy_url),
    source_url: stringOrNull(row.source_url),
    source_updated_at: dateOrNull(row.source_updated_at),
    last_seen_at: dateOrNull(row.last_seen_at),
    last_scraped_at: dateOrNull(row.last_scraped_at),
    created_at: dateOrNull(row.created_at),
    updated_at: dateOrNull(row.updated_at),
    estates: estate,
    profiles: null,
  };
}

function addParam(params: unknown[], value: unknown) {
  params.push(value);
  return `$${params.length}`;
}

function listingWhere(input: NeonListingFiltersInput, params: unknown[]) {
  const where = ["p.status = 'active'"];

  if (input.deal !== "all") {
    where.push(`p.deal_type = ${addParam(params, input.deal)}::deal_type`);
  }
  if (input.districtSlug) where.push(`p.district_slug = ${addParam(params, input.districtSlug)}`);

  const priceColumn = input.deal === "rent" ? "p.rent" : "p.price";
  if (input.minPrice !== undefined)
    where.push(`${priceColumn} >= ${addParam(params, input.minPrice)}`);
  if (input.maxPrice !== undefined)
    where.push(`${priceColumn} <= ${addParam(params, input.maxPrice)}`);

  if (input.bedrooms !== undefined) {
    where.push(
      input.bedrooms >= 4
        ? `p.bedrooms >= ${addParam(params, 4)}`
        : `p.bedrooms = ${addParam(params, input.bedrooms)}`,
    );
  }

  if (input.estateSlug) where.push(`e.slug = ${addParam(params, input.estateSlug)}`);
  return where.join(" AND ");
}

export async function searchListings(
  input: NeonListingFiltersInput,
): Promise<NeonListingSearchResult> {
  const db = sql();
  const page = Math.max(1, input.page);
  const pageSize = Math.min(Math.max(1, input.pageSize), 100);
  const offset = (page - 1) * pageSize;
  const params: unknown[] = [];
  const where = listingWhere(input, params);
  const countRows = await db.query(
    `SELECT count(*)::int AS total FROM properties p LEFT JOIN estates e ON e.id = p.estate_id WHERE ${where}`,
    params,
  );

  const rowParams = [...params];
  const limitParam = addParam(rowParams, pageSize);
  const offsetParam = addParam(rowParams, offset);
  const rows = await db.query(
    `
    SELECT ${listingColumns}
    FROM properties p
    LEFT JOIN estates e ON e.id = p.estate_id
    WHERE ${where}
    ORDER BY p.featured DESC, p.last_seen_at DESC NULLS LAST, p.created_at DESC
    LIMIT ${limitParam} OFFSET ${offsetParam}
    `,
    rowParams,
  );

  return {
    rows: rows.map(mapListingRow),
    total: Number(countRows[0]?.total ?? 0),
  };
}

export async function fetchFeaturedProperties(limit: number): Promise<NeonPropertyRow[]> {
  const result = await searchListings({ deal: "all", page: 1, pageSize: limit });
  return result.rows;
}

export async function fetchListingsForEstate(input: {
  estateSlug: string;
  limit: number;
}): Promise<NeonPropertyRow[]> {
  const result = await searchListings({
    deal: "all",
    estateSlug: input.estateSlug,
    page: 1,
    pageSize: input.limit,
  });
  return result.rows;
}

export async function fetchPropertyByListingNo(input: {
  listingNo: string;
}): Promise<NeonPropertyRow | null> {
  const rows = await sql().query(
    `
    SELECT ${listingColumns}
    FROM properties p
    LEFT JOIN estates e ON e.id = p.estate_id
    WHERE p.status = 'active' AND p.listing_no = $1
    LIMIT 1
    `,
    [input.listingNo],
  );
  return rows[0] ? mapListingRow(rows[0]) : null;
}

export async function fetchPropertyByLegacyDetailId(input: {
  oldId: string;
}): Promise<NeonLegacyPropertyMatch> {
  const rows = await sql().query(
    `
    SELECT listing_no
    FROM properties
    WHERE status = 'active' AND legacy_detail_id = $1
    ORDER BY deal_type ASC
    LIMIT 1
    `,
    [input.oldId],
  );
  return rows[0] ? { listing_no: stringOrEmpty(rows[0].listing_no) } : null;
}

export async function fetchSimilarListings(
  input: NeonSimilarListingsInput,
): Promise<NeonPropertyRow[]> {
  const rows = await sql().query(
    `
    SELECT ${listingColumns}
    FROM properties p
    LEFT JOIN estates e ON e.id = p.estate_id
    WHERE p.status = 'active'
      AND p.estate_id = $1
      AND p.deal_type = $2::deal_type
      AND p.id <> $3
    ORDER BY p.featured DESC, p.last_seen_at DESC NULLS LAST, p.created_at DESC
    LIMIT $4
    `,
    [input.estateId, input.dealType, input.excludeId, input.limit],
  );
  return rows.map(mapListingRow);
}

export async function fetchListingCountsByEstate(): Promise<Record<string, number>> {
  const rows = await sql().query(
    `
    SELECT e.slug AS estate_slug, count(*)::int AS count
    FROM properties p
    INNER JOIN estates e ON e.id = p.estate_id
    WHERE p.status = 'active'
    GROUP BY e.slug
    `,
  );
  return Object.fromEntries(rows.map((row) => [stringOrEmpty(row.estate_slug), Number(row.count)]));
}

export async function fetchEstateOptions(): Promise<NeonEstateOption[]> {
  const rows = await sql().query("SELECT slug, name_zh FROM estates ORDER BY name_zh");
  return rows.map((row) => ({
    slug: stringOrEmpty(row.slug),
    name_zh: stringOrEmpty(row.name_zh),
  }));
}
