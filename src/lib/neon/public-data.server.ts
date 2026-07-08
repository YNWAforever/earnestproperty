import "@tanstack/react-start/server-only";

import type {
  NeonCorridorInventoryInput,
  NeonCorridorInventoryResult,
  NeonEstateOption,
  NeonLegacyPropertyMatch,
  NeonListingFiltersInput,
  NeonListingSearchResult,
  NeonPropertyRow,
  NeonSimilarListingsInput,
} from "./public-data.types";
import { getSql } from "./db.server";

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
  s.id AS agent_id,
  s.name_zh AS agent_name_zh,
  s.name_en AS agent_name_en,
  s.phone AS agent_phone,
  s.whatsapp AS agent_whatsapp,
  s.licence_no AS agent_licence_no,
  s.avatar_url AS agent_avatar_url,
  s.branch AS agent_branch,
  s.bio AS agent_bio,
  e.name_zh AS estate_name_zh,
  e.slug AS estate_slug,
  e.district_slug AS estate_district_slug,
  e.year_completed AS estate_year_completed,
  e.developer AS estate_developer,
  e.lat AS estate_lat,
  e.lng AS estate_lng
`;

function sql() {
  return getSql();
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

function isMissingCmsVideosTableError(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "42P01" || message.includes('relation "cms_videos" does not exist');
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

  const agentId = stringOrNull(row.agent_id);
  const profile = agentId
    ? {
        id: agentId,
        name_zh: stringOrNull(row.agent_name_zh),
        name_en: stringOrNull(row.agent_name_en),
        phone: stringOrNull(row.agent_phone),
        whatsapp: stringOrNull(row.agent_whatsapp),
        licence_no: stringOrNull(row.agent_licence_no),
        avatar_url: stringOrNull(row.agent_avatar_url),
        branch: stringOrNull(row.agent_branch),
        bio: stringOrNull(row.agent_bio),
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
    profiles: profile,
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

  // For deal="all" both sale and rent listings are returned, so compare against
  // whichever price applies to each row (sale rows have p.price, rent rows have
  // p.rent). Using COALESCE keeps a single column comparison while still matching
  // rentals (whose p.price is NULL). The sale/rent cases stay on their own column.
  const priceColumn =
    input.deal === "rent"
      ? "p.rent"
      : input.deal === "sale"
        ? "p.price"
        : "COALESCE(p.price, p.rent)";
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

function cleanTerms(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function escapeLikeTerm(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function clampCorridorLimit(value: number) {
  const limit = Number.isFinite(value) ? value : 6;
  return Math.min(Math.max(1, limit), 24);
}

function normalizeCorridorInventoryInput(
  input: NeonCorridorInventoryInput,
): NeonCorridorInventoryInput {
  return {
    districtSlugs: cleanTerms(input.districtSlugs),
    estateSlugs: cleanTerms(input.estateSlugs),
    textAliases: cleanTerms(input.textAliases).map(escapeLikeTerm),
    limit: clampCorridorLimit(input.limit),
  };
}

function hasCorridorAliases(input: NeonCorridorInventoryInput) {
  return (
    input.districtSlugs.length > 0 || input.estateSlugs.length > 0 || input.textAliases.length > 0
  );
}

function emptyCorridorInventory(): NeonCorridorInventoryResult {
  return {
    saleTotal: 0,
    rentTotal: 0,
    saleRows: [],
    rentRows: [],
  };
}

function corridorWhere(input: NeonCorridorInventoryInput, params: unknown[]) {
  const parts: string[] = [];

  if (input.districtSlugs.length > 0) {
    parts.push(`p.district_slug = ANY(${addParam(params, input.districtSlugs)}::text[])`);
  }

  if (input.estateSlugs.length > 0) {
    parts.push(`e.slug = ANY(${addParam(params, input.estateSlugs)}::text[])`);
  }

  if (input.textAliases.length > 0) {
    parts.push(`
      EXISTS (
        SELECT 1
        FROM unnest(${addParam(params, input.textAliases)}::text[]) AS term(value)
        WHERE lower(
          concat_ws(' ',
            p.title_zh,
            p.title_en,
            p.address,
            p.district_slug,
            e.name_zh,
            e.slug
          )
        ) LIKE '%' || lower(term.value) || '%' ESCAPE '\\'
      )
    `);
  }

  return parts.length > 0 ? `p.status = 'active' AND (${parts.join(" OR ")})` : "FALSE";
}

async function fetchCorridorRows(
  input: NeonCorridorInventoryInput,
  params: unknown[],
  where: string,
): Promise<{ sale: NeonPropertyRow[]; rent: NeonPropertyRow[] }> {
  const limitParam = addParam(params, input.limit);
  // Collapse the previous two per-deal-type queries into one round-trip: rank each
  // listing within its deal_type partition using the same ordering as before, then
  // keep the top N per partition. This yields identical rows/order to running a
  // separate `LIMIT input.limit` query per deal type.
  const rows = await sql().query(
    `
    SELECT *
    FROM (
      SELECT
        ${listingColumns},
        ROW_NUMBER() OVER (
          PARTITION BY p.deal_type
          ORDER BY p.featured DESC, p.last_seen_at DESC NULLS LAST, p.created_at DESC
        ) AS corridor_rank
      FROM properties p
      LEFT JOIN estates e ON e.id = p.estate_id
      LEFT JOIN staff_users s ON s.id = p.agent_id
      WHERE ${where}
    ) ranked
    WHERE ranked.corridor_rank <= ${limitParam}
    ORDER BY ranked.deal_type, ranked.corridor_rank
    `,
    params,
  );

  const sale: NeonPropertyRow[] = [];
  const rent: NeonPropertyRow[] = [];
  for (const row of rows) {
    const mapped = mapListingRow(row);
    if (mapped.deal_type === "rent") rent.push(mapped);
    else sale.push(mapped);
  }
  return { sale, rent };
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
    LEFT JOIN staff_users s ON s.id = p.agent_id
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

export async function fetchCorridorInventory(
  input: NeonCorridorInventoryInput,
): Promise<NeonCorridorInventoryResult> {
  const normalized = normalizeCorridorInventoryInput(input);
  if (!hasCorridorAliases(normalized)) return emptyCorridorInventory();

  const countParams: unknown[] = [];
  const countWhere = corridorWhere(normalized, countParams);
  const rowParams: unknown[] = [];
  const rowWhere = corridorWhere(normalized, rowParams);

  const [countRows, rows] = await Promise.all([
    sql().query(
      `
      SELECT p.deal_type, count(*)::int AS total
      FROM properties p
      LEFT JOIN estates e ON e.id = p.estate_id
      WHERE ${countWhere}
      GROUP BY p.deal_type
      `,
      countParams,
    ),
    fetchCorridorRows(normalized, rowParams, rowWhere),
  ]);

  const totals = new Map(countRows.map((row) => [stringOrEmpty(row.deal_type), Number(row.total)]));

  return {
    saleTotal: totals.get("sale") ?? 0,
    rentTotal: totals.get("rent") ?? 0,
    saleRows: rows.sale,
    rentRows: rows.rent,
  };
}

export async function fetchFeaturedProperties(limit: number): Promise<NeonPropertyRow[]> {
  const pageSize = Math.min(Math.max(1, limit), 100);
  const rows = await sql().query(
    `
    SELECT ${listingColumns}
    FROM properties p
    LEFT JOIN estates e ON e.id = p.estate_id
    LEFT JOIN staff_users s ON s.id = p.agent_id
    WHERE p.status = 'active' AND p.featured = true
    ORDER BY p.last_seen_at DESC NULLS LAST, p.created_at DESC
    LIMIT $1
    `,
    [pageSize],
  );
  return rows.map(mapListingRow);
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
    LEFT JOIN staff_users s ON s.id = p.agent_id
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
    LEFT JOIN staff_users s ON s.id = p.agent_id
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

export async function fetchEstates(input: { districtSlug?: string } = {}) {
  const districtSlug = input.districtSlug ?? "sham-tseng";
  const rows = await sql().query(
    `
    SELECT *
    FROM estates
    WHERE district_slug = $1
    ORDER BY total_units DESC NULLS LAST, name_zh ASC
    `,
    [districtSlug],
  );
  return rows;
}

export async function fetchEstateBySlug(input: { slug: string }) {
  const rows = await sql().query("SELECT * FROM estates WHERE slug = $1 LIMIT 1", [input.slug]);
  return rows[0] ?? null;
}

export async function fetchFaqs(input: { scope: string }) {
  const rows = await sql().query(
    `
    SELECT question, answer
    FROM faqs
    WHERE scope = $1
    ORDER BY sort_order ASC, created_at ASC
    `,
    [input.scope],
  );
  return rows.map((row) => ({
    question: stringOrEmpty(row.question),
    answer: stringOrEmpty(row.answer),
  }));
}

export async function fetchCmsVideos() {
  let rows: DbRow[];
  try {
    rows = await sql().query(
      `
      SELECT id, title, video_url, description, sort_order, created_at
      FROM cms_videos
      WHERE published = true
      ORDER BY sort_order ASC, created_at DESC
      `,
    );
  } catch (error) {
    if (isMissingCmsVideosTableError(error)) return [];
    throw error;
  }

  return rows.map((row) => ({
    id: stringOrEmpty(row.id),
    title: stringOrEmpty(row.title),
    video_url: stringOrEmpty(row.video_url),
    description: stringOrNull(row.description),
    sort_order: Number(row.sort_order ?? 0),
    created_at: dateOrNull(row.created_at),
  }));
}

export async function fetchDistrictTransactions(input: {
  districtSlug: string;
  monthsBack: number;
}) {
  const rows = await sql().query(
    `
    SELECT
      t.deal_date,
      t.saleable_psf,
      t.price,
      t.saleable_area,
      t.unit,
      e.name_zh AS estate_name_zh,
      e.slug AS estate_slug
    FROM transactions t
    INNER JOIN estates e ON e.id = t.estate_id
    WHERE e.district_slug = $1
      AND t.deal_type = 'sale'
      AND t.deal_date >= (CURRENT_DATE - ($2::int * INTERVAL '1 month'))::date
    ORDER BY t.deal_date ASC
    `,
    [input.districtSlug, input.monthsBack],
  );
  return rows.map((row) => ({
    deal_date: dateOrNull(row.deal_date),
    saleable_psf: numberOrNull(row.saleable_psf),
    price: numberOrNull(row.price),
    saleable_area: numberOrNull(row.saleable_area),
    unit: stringOrNull(row.unit),
    estates: {
      name_zh: stringOrEmpty(row.estate_name_zh),
      slug: stringOrEmpty(row.estate_slug),
    },
  }));
}

export async function fetchEstateTransactions(input: { estateId: string; limit: number }) {
  const rows = await sql().query(
    `
    SELECT deal_date, unit, saleable_area, saleable_psf, price
    FROM transactions
    WHERE estate_id = $1 AND deal_type = 'sale'
    ORDER BY deal_date DESC NULLS LAST
    LIMIT $2
    `,
    [input.estateId, input.limit],
  );
  return rows.map((row) => ({
    deal_date: dateOrNull(row.deal_date),
    unit: stringOrNull(row.unit),
    saleable_area: numberOrNull(row.saleable_area),
    saleable_psf: numberOrNull(row.saleable_psf),
    price: numberOrNull(row.price),
  }));
}

export async function fetchPublishedArticles() {
  const rows = await sql().query(
    `
    SELECT slug, title, excerpt, cover_image, category, reading_minutes, published_at
    FROM articles
    WHERE published = true
    ORDER BY published_at DESC NULLS LAST, created_at DESC
    `,
  );
  return rows.map((row) => ({
    slug: stringOrEmpty(row.slug),
    title: stringOrEmpty(row.title),
    excerpt: stringOrNull(row.excerpt),
    cover_image: stringOrNull(row.cover_image),
    category: stringOrNull(row.category),
    reading_minutes: numberOrNull(row.reading_minutes),
    published_at: dateOrNull(row.published_at) ?? new Date().toISOString(),
  }));
}

export async function fetchArticleBySlug(input: { slug: string }) {
  const rows = await sql().query(
    `
    SELECT slug, title, excerpt, content, cover_image, category, reading_minutes, published_at
    FROM articles
    WHERE slug = $1 AND published = true
    LIMIT 1
    `,
    [input.slug],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    slug: stringOrEmpty(row.slug),
    title: stringOrEmpty(row.title),
    excerpt: stringOrNull(row.excerpt),
    content: stringOrNull(row.content),
    cover_image: stringOrNull(row.cover_image),
    category: stringOrNull(row.category),
    reading_minutes: numberOrNull(row.reading_minutes),
    published_at: dateOrNull(row.published_at) ?? new Date().toISOString(),
  };
}
