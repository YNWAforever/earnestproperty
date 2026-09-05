import "@tanstack/react-start/server-only";

import type {
  NeonBranchRecord,
  NeonCorridorInventoryInput,
  NeonCorridorInventoryResult,
  NeonEstateOption,
  NeonLegacyPropertyMatch,
  NeonListingFiltersInput,
  NeonListingSearchResult,
  NeonListingSort,
  NeonPublicAgentProfile,
  NeonPropertyRow,
  NeonRecentTransactionsInput,
  NeonSimilarListingsInput,
  NeonTransactionRow,
} from "./public-data.types";
import { getSql } from "./db.server";
import { isMissingCmsVideosTableError } from "./cms-videos-schema";
import { isMissingBranchesTableError } from "./branches-schema";

type DbRow = Record<string, unknown>;

const agentProfileColumns = new Set([
  "public_slug",
  "job_title",
  "show_on_website",
  "display_order",
]);

const publicAgentJoin = `LEFT JOIN staff_users s ON s.id = p.agent_id
  AND s.active = true
  AND COALESCE((to_jsonb(s)->>'show_on_website')::boolean, false) = true`;

const publicAgentProfileColumns = `
  s.id AS agent_id,
  to_jsonb(s)->>'public_slug' AS agent_public_slug,
  s.name_zh AS agent_name_zh,
  s.name_en AS agent_name_en,
  to_jsonb(s)->>'job_title' AS agent_job_title,
  s.phone AS agent_phone,
  s.whatsapp AS agent_whatsapp,
  s.licence_no AS agent_licence_no,
  s.avatar_url AS agent_avatar_url,
  s.branch AS agent_branch,
  -- Guarded the same way languages/public_slug/etc. are (to_jsonb, never a
  -- bare column reference) -- branch_id is new in this exact deploy
  -- (20260830160000_branches_entity.sql), so referencing it directly would
  -- break every one of this projection's callers on a database that hasn't
  -- run that migration yet. See "public SQL must remain valid before the
  -- agent-profile migration adds these columns" in agent-profiles.contract.test.mjs.
  to_jsonb(s)->>'branch_id' AS agent_branch_id,
  s.bio AS agent_bio,
  ARRAY(SELECT jsonb_array_elements_text(COALESCE(to_jsonb(s)->'specialties', '[]'::jsonb)))
    AS agent_specialties,
  ARRAY(SELECT jsonb_array_elements_text(COALESCE(to_jsonb(s)->'served_estate_slugs', '[]'::jsonb)))
    AS agent_served_estate_slugs,
  ARRAY(
    SELECT jsonb_array_elements_text(to_jsonb(s)->'languages')
    WHERE jsonb_typeof(to_jsonb(s)->'languages') = 'array'
  ) AS agent_languages
`;

const listingColumns = `
  p.id,
  p.listing_no,
  p.canonical_property_no,
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
  p.management_fee,
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
  ${publicAgentProfileColumns},
  e.name_zh AS estate_name_zh,
  e.slug AS estate_slug,
  e.district_slug AS estate_district_slug,
  e.year_completed AS estate_year_completed,
  e.developer AS estate_developer,
  e.total_units AS estate_total_units,
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

function isMissingAgentProfileColumnError(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error) || String(error.code) !== "42703") {
    return false;
  }

  const reportedColumn =
    "column" in error
      ? String(error.column ?? "")
          .replaceAll('"', "")
          .split(".")
          .at(-1)
          ?.toLowerCase()
      : "";
  if (reportedColumn) return agentProfileColumns.has(reportedColumn);

  const message =
    error instanceof Error ? error.message : "message" in error ? String(error.message ?? "") : "";
  const missingColumn = message.match(
    /\bcolumn\s+(?:(?:"[^"]+"|[a-z_][a-z0-9_]*)\.)?"?([a-z_][a-z0-9_]*)"?\s+does not exist\b/i,
  )?.[1];
  return Boolean(missingColumn && agentProfileColumns.has(missingColumn.toLowerCase()));
}

async function withAgentProfileRolloutFallback<T>(operation: () => Promise<T>, fallback: T) {
  try {
    return await operation();
  } catch (error) {
    if (isMissingAgentProfileColumnError(error)) return fallback;
    throw error;
  }
}

function dealType(value: unknown): "sale" | "rent" {
  return value === "rent" ? "rent" : "sale";
}

function mapPublicAgentProfile(row: DbRow): NeonPublicAgentProfile | null {
  const id = stringOrNull(row.agent_id);
  if (!id) return null;
  return {
    id,
    public_slug: stringOrNull(row.agent_public_slug),
    name_zh: stringOrNull(row.agent_name_zh),
    name_en: stringOrNull(row.agent_name_en),
    job_title: stringOrNull(row.agent_job_title),
    phone: stringOrNull(row.agent_phone),
    whatsapp: stringOrNull(row.agent_whatsapp),
    licence_no: stringOrNull(row.agent_licence_no),
    avatar_url: stringOrNull(row.agent_avatar_url),
    branch: stringOrNull(row.agent_branch),
    branch_id: stringOrNull(row.agent_branch_id),
    bio: stringOrNull(row.agent_bio),
    specialties: textArrayOrNull(row.agent_specialties) ?? [],
    served_estate_slugs: textArrayOrNull(row.agent_served_estate_slugs) ?? [],
    languages: textArrayOrNull(row.agent_languages) ?? [],
  };
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
        total_units: numberOrNull(row.estate_total_units),
        lat: numberOrNull(row.estate_lat),
        lng: numberOrNull(row.estate_lng),
      }
    : null;

  const profile = mapPublicAgentProfile(row);

  return {
    id: stringOrEmpty(row.id),
    listing_no: stringOrEmpty(row.listing_no),
    canonical_property_no: stringOrNull(row.canonical_property_no),
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
    management_fee: numberOrNull(row.management_fee),
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

// Long enough for a full estate name plus a street; anything past this is
// paste noise and only widens the scan.
const KEYWORD_MAX_LENGTH = 80;

function normalizeKeyword(value: string | undefined) {
  const trimmed = (value ?? "").trim().slice(0, KEYWORD_MAX_LENGTH);
  return trimmed ? escapeLikeTerm(trimmed) : null;
}

function listingWhere(input: NeonListingFiltersInput, params: unknown[]) {
  const where = ["p.status = 'active'"];

  // Filter before COUNT/LIMIT so older video listings are not lost behind
  // newer listings without video. A non-space character excludes null,
  // empty strings, and whitespace-only values (including tabs/newlines).
  if (input.hasVideo === true) where.push("p.video_url ~ '[^[:space:]]'");

  if (input.deal !== "all") {
    where.push(`p.deal_type = ${addParam(params, input.deal)}::deal_type`);
  }
  if (input.districtSlug) where.push(`p.district_slug = ${addParam(params, input.districtSlug)}`);

  // Price only means something once the deal type is known -- sale prices are
  // in millions, rents in thousands. Under deal="all" the previous
  // COALESCE(p.price, p.rent) made a sale budget match every rental (rent <=
  // 8,000,000 is always true) and a rent budget exclude every sale, silently
  // deleting half the inventory. No single number can mean both, so the bound
  // is dropped entirely when the deal type isn't chosen; the filter panel
  // disables the price inputs under "all" so this combination can't be
  // produced from the UI, and this guard covers a hand-edited URL.
  if (input.deal !== "all") {
    const priceColumn = input.deal === "rent" ? "p.rent" : "p.price";
    if (input.minPrice !== undefined)
      where.push(`${priceColumn} >= ${addParam(params, input.minPrice)}`);
    if (input.maxPrice !== undefined)
      where.push(`${priceColumn} <= ${addParam(params, input.maxPrice)}`);
  }

  // Unlike price, saleable_area is meaningful regardless of deal type (sale
  // and rent listings both carry a plain square-foot figure), so this bound
  // applies under deal="all" too -- it is not gated the way the price bound
  // above deliberately is.
  if (input.minArea !== undefined)
    where.push(`p.saleable_area >= ${addParam(params, input.minArea)}`);
  if (input.maxArea !== undefined)
    where.push(`p.saleable_area <= ${addParam(params, input.maxArea)}`);

  if (input.bedrooms !== undefined) {
    where.push(
      input.bedrooms >= 4
        ? `p.bedrooms >= ${addParam(params, 4)}`
        : `p.bedrooms = ${addParam(params, input.bedrooms)}`,
    );
  }

  if (input.estateSlug) where.push(`e.slug = ${addParam(params, input.estateSlug)}`);
  if (input.agentId) where.push(`p.agent_id = ${addParam(params, input.agentId)}`);

  // Matched as one whole term, not split on whitespace: the primary search
  // language is Chinese, which has no word boundaries, so tokenising buys
  // nothing and only introduces surprising OR/AND semantics.
  //
  // p.description and p.features are deliberately excluded.
  // normalize-old-site.mjs fills description from the old site's meta
  // description, which routinely name-drops neighbouring estates --
  // including it would make a search for one estate return a different one.
  // p.title_zh and p.address always carry the building name (see
  // normalize-old-site.mjs's titleFor/address builders), so the estate is
  // findable even on the many rows whose estate_id is still NULL because the
  // importer only links an estate via a handful of hardcoded regexes.
  const keyword = normalizeKeyword(input.keyword);
  if (keyword) {
    where.push(`lower(
      concat_ws(' ',
        p.title_zh,
        p.title_en,
        p.address,
        p.listing_no,
        p.district_slug,
        e.name_zh,
        e.name_en,
        e.slug
      )
    ) LIKE '%' || lower(${addParam(params, keyword)}) || '%' ESCAPE '\\'`);
  }

  return where.join(" AND ");
}

// Every call site that hardcodes this exact chain (fetchCorridorRows,
// fetchFeaturedProperties, fetchSimilarListings) is a listing set with no
// user-facing sort control, so it stays untouched by the `sort` param below --
// only searchListings (the general /listings search path) accepts a sort.
const LISTING_FRESHNESS_ORDER =
  "p.featured DESC, p.last_seen_at DESC NULLS LAST, p.created_at DESC";

// dedupeListings (src/lib/queries.ts) keeps the FIRST occurrence of a
// duplicate pair and relies on callers pre-ordering rows by
// LISTING_FRESHNESS_ORDER so the kept row is the freshest. A user-chosen sort
// changes the primary ORDER BY column, but true duplicates (re-scrapes of the
// same physical unit) almost always tie on price/area/psf, so the freshness
// chain is always appended as a tiebreaker -- this keeps dedup's "kept row is
// freshest" guarantee intact on the common tie case without trying to solve
// the rare non-identical-duplicate edge case here.
function listingOrderBy(sort: NeonListingSort): string {
  switch (sort) {
    case "price_asc":
      return `COALESCE(p.price, p.rent) ASC NULLS LAST, ${LISTING_FRESHNESS_ORDER}`;
    case "price_desc":
      return `COALESCE(p.price, p.rent) DESC NULLS LAST, ${LISTING_FRESHNESS_ORDER}`;
    case "area":
      return `p.saleable_area DESC NULLS LAST, ${LISTING_FRESHNESS_ORDER}`;
    case "psf":
      // PSF isn't a stored column -- it's price or rent divided by
      // saleable_area, and dividing by a possibly-zero/null area needs the
      // same guard src/lib/format.ts's formatPsf() already applies
      // client-side (area > 0, not just non-null): NULLIF alone would still
      // let a negative-or-zero area through, so this uses an explicit CASE.
      return (
        "CASE WHEN p.saleable_area > 0 THEN COALESCE(p.price, p.rent) / p.saleable_area END " +
        `ASC NULLS LAST, ${LISTING_FRESHNESS_ORDER}`
      );
    case "newest":
    default:
      // The pre-existing hardcoded order already IS "newest" -- mapping it to
      // the freshness chain alone (rather than restating those same three
      // columns as a separate "primary" clause) avoids duplicating them.
      return LISTING_FRESHNESS_ORDER;
  }
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
    outOfScopeTextAliases: cleanTerms(input.outOfScopeTextAliases).map(escapeLikeTerm),
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

  if (parts.length === 0) return "FALSE";

  let where = `p.status = 'active' AND (${parts.join(" OR ")})`;

  if (input.outOfScopeTextAliases.length > 0) {
    // Exclude a row matching one of the inclusion predicates above if it also
    // names a place outside the corridor (e.g. a district_slug:
    // "castle-peak-road" row whose title/address says 屯門). Applied here at
    // the SQL level -- not just filtered client-side afterward -- so both the
    // COUNT totals and the fetched/ranked rows agree on the same excluded set.
    where += `
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(${addParam(params, input.outOfScopeTextAliases)}::text[]) AS term(value)
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
    `;
  }

  return where;
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
      ${publicAgentJoin}
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
    ${publicAgentJoin}
    WHERE ${where}
    ORDER BY ${listingOrderBy(input.sort)}
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
  // p.featured is manually flagged and the MLS importer always writes it false
  // (see normalize-old-site.mjs), so a strict `featured = true` filter showed
  // only the handful of listings someone had hand-flagged -- 1 of 398 at audit
  // time. Sorting featured-first instead of filtering on it surfaces any
  // hand-picked listings ahead of the rest while always backfilling the
  // section from the newest active inventory (sale + rent mixed), so 精選筍盤
  // never shows fewer than `limit` cards while any active listings exist.
  const rows = await sql().query(
    `
    SELECT ${listingColumns}
    FROM properties p
    LEFT JOIN estates e ON e.id = p.estate_id
    ${publicAgentJoin}
    WHERE p.status = 'active'
    ORDER BY p.featured DESC, p.last_seen_at DESC NULLS LAST, p.created_at DESC
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
    sort: "newest",
    page: 1,
    pageSize: input.limit,
  });
  return result.rows;
}

export async function fetchListingsForAgent(input: {
  agentId: string;
  limit: number;
}): Promise<NeonPropertyRow[]> {
  const result = await searchListings({
    deal: "all",
    agentId: input.agentId,
    sort: "newest",
    page: 1,
    pageSize: input.limit,
  });
  return result.rows;
}

// Deliberately not filtered to status = 'active': the caller (the
// property-detail route, its only caller -- see queries.ts/public-data.ts)
// needs to distinguish a listing that was withdrawn/sold/rented from one
// that never existed, so this fetches by listing_no regardless of status
// and lets the caller branch on the returned status. Every other public
// listing query in this file (searchListings, fetchSimilarListings, etc.)
// keeps its own 'active' filter untouched -- this loosening is scoped to
// this single-listing lookup only.
export async function fetchPropertyByListingNo(input: {
  listingNo: string;
}): Promise<NeonPropertyRow | null> {
  const rows = await sql().query(
    `
    SELECT ${listingColumns}
    FROM properties p
    LEFT JOIN estates e ON e.id = p.estate_id
    ${publicAgentJoin}
    WHERE p.listing_no = $1
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
    ${publicAgentJoin}
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

export async function listPublicAgentProfiles(): Promise<NeonPublicAgentProfile[]> {
  return withAgentProfileRolloutFallback(async () => {
    const rows = await sql().query(
      `
      SELECT ${publicAgentProfileColumns}
      FROM staff_users s
      WHERE s.active = true
        AND COALESCE((to_jsonb(s)->>'show_on_website')::boolean, false) = true
      ORDER BY COALESCE((to_jsonb(s)->>'display_order')::integer, 0) ASC,
        COALESCE(s.name_zh, s.name_en) ASC NULLS LAST,
        s.id ASC
      `,
    );
    return rows.flatMap((row) => {
      const profile = mapPublicAgentProfile(row);
      return profile ? [profile] : [];
    });
  }, []);
}

export async function fetchPublicAgentProfileBySlug(input: {
  slug: string;
}): Promise<NeonPublicAgentProfile | null> {
  const slug = input.slug.trim().toLowerCase();
  if (!slug) return null;
  return withAgentProfileRolloutFallback(async () => {
    const rows = await sql().query(
      `
      SELECT ${publicAgentProfileColumns}
      FROM staff_users s
      WHERE to_jsonb(s)->>'public_slug' = $1
        AND s.active = true
        AND COALESCE((to_jsonb(s)->>'show_on_website')::boolean, false) = true
      LIMIT 1
      `,
      [slug],
    );
    return rows[0] ? mapPublicAgentProfile(rows[0]) : null;
  }, null);
}

/**
 * Real per-entity `updated_at` for the sitemap's estate and article URLs
 * (P7a) -- both columns are already written by the admin CMS's archive/
 * publish paths. Genuinely static pages (home, about, district hubs, etc.)
 * have no per-page change signal to draw on and keep sitemap.xml.ts's
 * existing shared generation timestamp instead of a fabricated one.
 */
export async function fetchSitemapTimestamps(): Promise<{
  estates: Record<string, string | null>;
  articles: Record<string, string | null>;
}> {
  const [estateRows, articleRows] = await Promise.all([
    sql().query("SELECT slug, updated_at FROM estates WHERE published = true"),
    sql().query("SELECT slug, updated_at FROM articles WHERE published = true"),
  ]);
  return {
    estates: Object.fromEntries(
      estateRows.map((row) => [stringOrEmpty(row.slug), dateOrNull(row.updated_at)]),
    ),
    articles: Object.fromEntries(
      articleRows.map((row) => [stringOrEmpty(row.slug), dateOrNull(row.updated_at)]),
    ),
  };
}

/**
 * All rows from the `branches` table (20260830160000_branches_entity.sql).
 * Small, fully-public, no filters needed -- callers resolve a specific
 * agent's branch_id against this list themselves (see agentBranchName() in
 * src/lib/agent-directory.ts), rather than this function taking an id and
 * risking a `.find()` that silently falls back to the first row on a miss.
 *
 * Deliberately NOT joined into publicAgentJoin/publicAgentProfileColumns
 * (the query shared by every property/listing/agent-profile fetch): joining
 * a brand-new table into that widely-shared join would make five unrelated,
 * already-working queries fail if `branches` hasn't been migrated yet. A
 * dedicated, independently-guarded function (matching fetchCmsVideos'
 * isMissingCmsVideosTableError precedent) keeps that blast radius to just
 * the branch_id resolution itself.
 */
export async function listBranches(): Promise<NeonBranchRecord[]> {
  try {
    const rows = await sql().query(
      "SELECT id, slug, name, address, phone, whatsapp, photo FROM branches ORDER BY name ASC",
    );
    return rows.map((row) => ({
      id: stringOrEmpty(row.id),
      slug: stringOrEmpty(row.slug),
      name: stringOrEmpty(row.name),
      address: stringOrNull(row.address),
      phone: stringOrNull(row.phone),
      whatsapp: stringOrNull(row.whatsapp),
      photo: stringOrNull(row.photo),
    }));
  } catch (error) {
    if (isMissingBranchesTableError(error)) return [];
    throw error;
  }
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
  const rows = await sql().query(
    "SELECT slug, name_zh FROM estates WHERE COALESCE((to_jsonb(estates)->>'published')::boolean, true) ORDER BY name_zh",
  );
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
      AND COALESCE((to_jsonb(estates)->>'published')::boolean, true)
    ORDER BY total_units DESC NULLS LAST, name_zh ASC
    `,
    [districtSlug],
  );
  return rows;
}

export async function fetchEstateBySlug(input: { slug: string }) {
  const rows = await sql().query(
    "SELECT * FROM estates WHERE slug = $1 AND COALESCE((to_jsonb(estates)->>'published')::boolean, true) LIMIT 1",
    [input.slug],
  );
  return rows[0] ?? null;
}

export async function fetchFaqs(input: { scope: string }) {
  const rows = await sql().query(
    `
    SELECT question, answer
    FROM faqs
    WHERE scope = $1
      AND COALESCE((to_jsonb(faqs)->>'published')::boolean, true)
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
      SELECT id, title, video_url, description, sort_order, created_at, youtube_published_at, category
      FROM cms_videos
      WHERE published = true
        AND (youtube_managed = false OR youtube_available = true)
      ORDER BY sort_order ASC, COALESCE(youtube_published_at, created_at) DESC
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
    youtube_published_at: dateOrNull(row.youtube_published_at),
    category: stringOrNull(row.category),
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
      -- Only published, human-verified rows render publicly -- see
      -- 20260830140000_transaction_provenance.sql's own comment for why
      -- every existing row starts excluded by this pair.
      AND t.published = true
      AND t.verification_state = 'verified'
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
    WHERE estate_id = $1
      AND deal_type = 'sale'
      -- Same published/verified gate as fetchDistrictTransactions above.
      AND published = true
      AND verification_state = 'verified'
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

// "YYYY-MM" only -- anything else is silently ignored rather than passed
// through to the date cast below, matching this file's other defense-in-
// depth guards (e.g. clampCorridorLimit) against a hand-edited URL.
const TRANSACTION_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function transactionsWhere(input: NeonRecentTransactionsInput, params: unknown[]) {
  // /transactions (the only caller of this query) shows only published,
  // human-verified rows -- see 20260830140000_transaction_provenance.sql's
  // own comment for why every existing row starts excluded by this pair.
  const where = ["t.published = true", "t.verification_state = 'verified'"];

  if (input.districtSlug) where.push(`e.district_slug = ${addParam(params, input.districtSlug)}`);
  if (input.estateSlug) where.push(`e.slug = ${addParam(params, input.estateSlug)}`);
  if (input.dealType && input.dealType !== "all") {
    where.push(`t.deal_type = ${addParam(params, input.dealType)}::deal_type`);
  }
  if (input.month && TRANSACTION_MONTH_PATTERN.test(input.month)) {
    const monthStart = `${input.month}-01`;
    where.push(`t.deal_date >= ${addParam(params, monthStart)}::date`);
    where.push(`t.deal_date < (${addParam(params, monthStart)}::date + INTERVAL '1 month')`);
  }
  if (input.minPrice !== undefined) where.push(`t.price >= ${addParam(params, input.minPrice)}`);
  if (input.maxPrice !== undefined) where.push(`t.price <= ${addParam(params, input.maxPrice)}`);

  return where.join(" AND ");
}

function mapTransactionRow(row: DbRow): NeonTransactionRow {
  const estateSlug = stringOrNull(row.estate_slug);
  return {
    id: stringOrEmpty(row.id),
    deal_date: dateOrNull(row.deal_date),
    deal_type: dealType(row.deal_type),
    price: numberOrNull(row.price),
    saleable_area: numberOrNull(row.saleable_area),
    saleable_psf: numberOrNull(row.saleable_psf),
    unit: stringOrNull(row.unit),
    block: stringOrNull(row.block),
    floor_band: stringOrNull(row.floor_band),
    source: stringOrNull(row.source),
    source_url: stringOrNull(row.source_url),
    verified_at: dateOrNull(row.verified_at),
    estates: estateSlug
      ? {
          name_zh: stringOrEmpty(row.estate_name_zh),
          slug: estateSlug,
          district_slug: stringOrEmpty(row.estate_district_slug),
        }
      : null,
  };
}

/**
 * Replaces the old queries.ts approach of looping over three hardcoded
 * district slugs and merging client-side -- this queries every district in
 * one round trip and accepts real filters (district/estate/deal type/month/
 * price range), matching /listings' searchListings() shape. `id` is
 * selected so /transactions can render a shareable `?tx=<id>` reference per
 * row (no dedicated single-transaction route/SEO surface exists, so this is
 * a highlight-within-the-list, not a distinct page).
 */
export async function fetchRecentTransactions(
  input: NeonRecentTransactionsInput,
): Promise<NeonTransactionRow[]> {
  const params: unknown[] = [];
  const where = transactionsWhere(input, params);
  const limitParam = addParam(params, Math.min(Math.max(1, input.limit), 100));
  const offsetParam = addParam(params, Math.max(0, input.offset ?? 0));
  const rows = await sql().query(
    `
    SELECT
      t.id,
      t.deal_date,
      t.deal_type,
      t.price,
      t.saleable_area,
      t.saleable_psf,
      t.unit,
      t.block,
      t.floor_band,
      t.source,
      t.source_url,
      t.verified_at,
      e.name_zh AS estate_name_zh,
      e.slug AS estate_slug,
      e.district_slug AS estate_district_slug
    FROM transactions t
    INNER JOIN estates e ON e.id = t.estate_id
    WHERE ${where}
    ORDER BY t.deal_date DESC NULLS LAST, t.created_at DESC
    LIMIT ${limitParam}
    OFFSET ${offsetParam}
    `,
    params,
  );
  return rows.map(mapTransactionRow);
}

/**
 * Total row count for the same filters fetchRecentTransactions applies --
 * kept as a separate query (not a window function on the paged query above)
 * so callers that only want existence/paging metadata, like this function's
 * own callers, aren't forced to also fetch a page of rows, and so
 * fetchRecentTransactions's own return shape (a plain row array) stays
 * unchanged for its existing callers (e.g. sitemap[.]xml.ts's `limit: 1`
 * existence check).
 */
export async function fetchRecentTransactionsCount(
  input: Omit<NeonRecentTransactionsInput, "limit" | "offset">,
): Promise<number> {
  const params: unknown[] = [];
  const where = transactionsWhere({ ...input, limit: 0 }, params);
  const rows = await sql().query(
    `
    SELECT count(*)::int AS count
    FROM transactions t
    INNER JOIN estates e ON e.id = t.estate_id
    WHERE ${where}
    `,
    params,
  );
  return numberOrNull(rows[0]?.count) ?? 0;
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
