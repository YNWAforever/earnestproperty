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
  PropertyOffering,
  NeonRecentTransactionsInput,
  NeonSimilarListingsInput,
  NeonTransactionRow,
} from "./public-data.types";
import { getSql } from "./db.server";
import { cachedPublicEstateOptions } from "./public-estate-options-cache";
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
  c.public_listing_no,
  c.listing_aliases,
  c.offerings,
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
  p.seo_title,
  p.seo_description,
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

// Listing-card transport has no long body, full gallery, floorplan or staff biography.
const detailListingColumns = listingColumns
  .replace(
    "p.saleable_area,",
    "COALESCE(p.saleable_area, group_facts.saleable_area) AS saleable_area,",
  )
  .replace("p.gross_area,", "COALESCE(p.gross_area, group_facts.gross_area) AS gross_area,")
  .replace("p.bedrooms,", "COALESCE(p.bedrooms, group_facts.bedrooms) AS bedrooms,")
  .replace("p.floor,", "COALESCE(p.floor, group_facts.floor) AS floor,");
const listingCardColumns = `
  p.id, p.listing_no, c.public_listing_no, c.listing_aliases, c.offerings, p.canonical_property_no, p.title_zh, p.deal_type,
  p.price, p.rent, p.saleable_area, p.bedrooms, p.bathrooms, p.features,
  p.images[1:1] AS images, p.video_url, p.estate_id, p.district_slug, p.address,
  p.status, p.featured, p.source_site, p.last_seen_at, p.created_at, p.updated_at,
  e.name_zh AS estate_name_zh, e.slug AS estate_slug, e.district_slug AS estate_district_slug
`;
function mapListingCardRow(row: DbRow): NeonPropertyRow {
  return mapListingRow({
    ...row,
    description: null,
    floorplan_url: null,
    agent_id: null,
    images: Array.isArray(row.images) ? row.images.slice(0, 1) : null,
  });
}
// Rank across every status before applying public filters. A newer withdrawal
// therefore suppresses an older active scrape for the same unit and deal.
function canonicalListingCte(
  where: string,
  splitByDeal = false,
  candidateOrder = LISTING_FRESHNESS_ORDER,
) {
  return `WITH ranked_offerings AS (
    SELECT p.id, ppm.public_listing_no, ROW_NUMBER() OVER (
      PARTITION BY ppm.public_listing_no, p.deal_type
      ORDER BY p.source_updated_at DESC NULLS LAST, p.last_seen_at DESC NULLS LAST, p.updated_at DESC NULLS LAST, p.created_at DESC, p.id ASC
    ) AS offering_rank
    FROM properties p
    JOIN property_public_members ppm ON ppm.property_id = p.id
  ), current_offerings AS (
    SELECT id, public_listing_no FROM ranked_offerings WHERE offering_rank = 1
  ), eligible_candidates AS (
    SELECT p.id, current_offerings.public_listing_no, ROW_NUMBER() OVER (
      PARTITION BY current_offerings.public_listing_no${splitByDeal ? ", p.deal_type" : ""}
      ORDER BY ${candidateOrder}
    ) AS group_rank
    FROM current_offerings
    JOIN properties p ON p.id = current_offerings.id
    LEFT JOIN estates e ON e.id = p.estate_id
    WHERE p.status = 'active' AND ${where}
  ), eligible_groups AS (
    SELECT id, public_listing_no FROM eligible_candidates WHERE group_rank = 1
  ), canonical AS (
    SELECT eligible_groups.id, eligible_groups.public_listing_no,
      ARRAY(
        SELECT alias_property.listing_no
        FROM property_public_members alias_member
        JOIN properties alias_property ON alias_property.id = alias_member.property_id
        WHERE alias_member.public_listing_no = eligible_groups.public_listing_no
        ORDER BY alias_property.listing_no
      ) AS listing_aliases,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', offering.id, 'listing_no', offering.listing_no,
          'deal_type', offering.deal_type, 'price', offering.price,
          'rent', offering.rent, 'status', offering.status
        ) ORDER BY offering.deal_type, offering.listing_no)
        FROM current_offerings all_current
        JOIN properties offering ON offering.id = all_current.id
        WHERE all_current.public_listing_no = eligible_groups.public_listing_no
          AND offering.status = 'active'
      ), '[]'::jsonb) AS offerings
    FROM eligible_groups
  )`;
}

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
    public_listing_no: stringOrNull(row.public_listing_no) ?? undefined,
    listing_aliases: textArrayOrNull(row.listing_aliases) ?? undefined,
    offerings: Array.isArray(row.offerings)
      ? row.offerings.map((offering): PropertyOffering => {
          const item = offering && typeof offering === "object" ? (offering as DbRow) : {};
          return {
            id: stringOrEmpty(item.id),
            listing_no: stringOrEmpty(item.listing_no),
            deal_type: dealType(item.deal_type),
            price: numberOrNull(item.price),
            rent: numberOrNull(item.rent),
            status: stringOrEmpty(item.status),
            ...(Object.prototype.hasOwnProperty.call(item, "description")
              ? { description: stringOrNull(item.description) }
              : {}),
          };
        })
      : undefined,
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
    seo_title: stringOrNull(row.seo_title),
    seo_description: stringOrNull(row.seo_description),
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

function assertPublicNumber(value: unknown): void {
  if (value === undefined) return;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    throw new TypeError("INVALID_PUBLIC_FILTER");
  }
}

function assertListingFilters(input: NeonListingFiltersInput): void {
  if (!input || (input.deal !== "sale" && input.deal !== "rent" && input.deal !== "all")) {
    throw new TypeError("INVALID_PUBLIC_FILTER");
  }
  for (const value of [input.minPrice, input.maxPrice, input.minArea, input.maxArea]) {
    assertPublicNumber(value);
  }
  if (
    input.bedrooms !== undefined &&
    (!Number.isSafeInteger(input.bedrooms) || input.bedrooms < 0 || input.bedrooms > 4)
  ) {
    throw new TypeError("INVALID_PUBLIC_FILTER");
  }
}

function assertTransactionFilters(
  input: Pick<NeonRecentTransactionsInput, "dealType" | "minPrice" | "maxPrice">,
): void {
  if (
    !input ||
    (input.dealType !== undefined &&
      input.dealType !== "all" &&
      input.dealType !== "sale" &&
      input.dealType !== "rent")
  ) {
    throw new TypeError("INVALID_PUBLIC_FILTER");
  }
  assertPublicNumber(input.minPrice);
  assertPublicNumber(input.maxPrice);
}

function boundedPublicCount(value: number, fallback: number, max: number): number {
  return Number.isSafeInteger(value) && value >= 1 ? Math.min(value, max) : fallback;
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
    const term = addParam(params, keyword);
    where.push(`(
      lower(concat_ws(' ',
        p.title_zh,
        p.title_en,
        p.address,
        p.listing_no,
        p.district_slug,
        e.name_zh,
        e.name_en,
        e.slug
      )) LIKE '%' || lower(${term}) || '%' ESCAPE '\\'
      OR EXISTS (
        SELECT 1
        FROM property_public_members search_member
        JOIN property_public_members alias_member
          ON alias_member.public_listing_no = search_member.public_listing_no
        JOIN properties alias_property ON alias_property.id = alias_member.property_id
        WHERE search_member.property_id = p.id
          AND (
            lower(search_member.public_listing_no)
              LIKE '%' || lower(${term}) || '%' ESCAPE '\\'
            OR lower(alias_property.listing_no)
              LIKE '%' || lower(${term}) || '%' ESCAPE '\\'
          )
      )
    )`);
  }

  return where.join(" AND ");
}

// Every call site that hardcodes this exact chain (fetchCorridorRows,
// fetchFeaturedProperties, fetchSimilarListings) is a listing set with no
// user-facing sort control, so it stays untouched by the `sort` param below --
// only searchListings (the general /listings search path) accepts a sort.
const LISTING_FRESHNESS_ORDER =
  "p.featured DESC, p.last_seen_at DESC NULLS LAST, p.created_at DESC, p.id ASC";
// Newest means first recorded on this site, not featured status or scraper last-seen time.
const LISTING_NEWEST_ORDER = "p.created_at DESC, p.id ASC";

// Price/area/PSF sorts retain the existing featured/source-check tie breakers.
// Newest uses creation order consistently for representative selection and paging;
// canonical current-offer ranking still suppresses superseded active records.
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
      return LISTING_NEWEST_ORDER;
  }
}

const MAX_PUBLIC_SCOPE_TERMS_PER_LIST = 48;
const MAX_PUBLIC_SCOPE_TERMS_TOTAL = 96;
const MAX_PUBLIC_SCOPE_TERM_LENGTH = 160;

function cleanTerms(values: string[], maxEntries = MAX_PUBLIC_SCOPE_TERMS_PER_LIST) {
  if (
    !Array.isArray(values) ||
    values.length > maxEntries ||
    values.some((value) => typeof value !== "string" || value.length > MAX_PUBLIC_SCOPE_TERM_LENGTH)
  ) {
    throw new TypeError("INVALID_PUBLIC_SCOPE");
  }
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
  if (!input) throw new TypeError("INVALID_PUBLIC_SCOPE");
  const districtSlugs = cleanTerms(input.districtSlugs);
  const estateSlugs = cleanTerms(input.estateSlugs);
  const textAliases = cleanTerms(input.textAliases);
  const outOfScopeTextAliases = cleanTerms(input.outOfScopeTextAliases);
  if (
    districtSlugs.length + estateSlugs.length + textAliases.length + outOfScopeTextAliases.length >
    MAX_PUBLIC_SCOPE_TERMS_TOTAL
  ) {
    throw new TypeError("INVALID_PUBLIC_SCOPE");
  }
  return {
    districtSlugs,
    estateSlugs,
    textAliases: textAliases.map(escapeLikeTerm),
    outOfScopeTextAliases: outOfScopeTextAliases.map(escapeLikeTerm),
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
    ${canonicalListingCte(where, true)}
    SELECT *
    FROM (
      SELECT
        ${listingCardColumns},
        ROW_NUMBER() OVER (
          PARTITION BY p.deal_type
          ORDER BY p.featured DESC, p.last_seen_at DESC NULLS LAST, p.created_at DESC, p.id ASC
        ) AS corridor_rank
      FROM properties p JOIN canonical c ON c.id=p.id
      LEFT JOIN estates e ON e.id = p.estate_id

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
    const mapped = mapListingCardRow(row);
    if (mapped.deal_type === "rent") rent.push(mapped);
    else sale.push(mapped);
  }
  return { sale, rent };
}

export async function searchListings(
  input: NeonListingFiltersInput,
): Promise<NeonListingSearchResult> {
  assertListingFilters(input);
  const db = sql();
  // This server function is directly callable, so route search validation alone
  // cannot keep an extreme page from becoming Infinity in the SQL OFFSET.
  const page =
    Number.isSafeInteger(input.page) && input.page >= 1 && input.page <= 10_000 ? input.page : 1;
  const pageSize = Number.isSafeInteger(input.pageSize)
    ? Math.min(Math.max(1, input.pageSize), 100)
    : 1;
  const offset = (page - 1) * pageSize;
  const params: unknown[] = [];
  const where = listingWhere(input, params);
  const candidateOrder =
    !input.sort || input.sort === "newest" ? LISTING_NEWEST_ORDER : LISTING_FRESHNESS_ORDER;
  const rowParams = [...params];
  // The keyword is listingWhere's final bound value. Public exact matches
  // lead the selected sort without changing the canonical source ranking.
  const exactPublicRank = normalizeKeyword(input.keyword)
    ? `CASE WHEN lower(c.public_listing_no) = lower($${params.length}) THEN 0 ELSE 1 END, `
    : "";
  const limitParam = addParam(rowParams, pageSize);
  const offsetParam = addParam(rowParams, offset);
  // Both reads are independent; list totals may reflect a concurrent import until the next refresh.
  const [countRows, rows] = await Promise.all([
    db.query(
      `${canonicalListingCte(where, false, candidateOrder)}
      SELECT count(*)::int AS total FROM eligible_groups`,
      params,
    ),
    db.query(
      `${canonicalListingCte(where, false, candidateOrder)}
      SELECT ${listingCardColumns} FROM properties p JOIN canonical c ON c.id=p.id
      LEFT JOIN estates e ON e.id=p.estate_id WHERE ${where}
      ORDER BY ${exactPublicRank}${listingOrderBy(input.sort)} LIMIT ${limitParam} OFFSET ${offsetParam}`,
      rowParams,
    ),
  ]);

  return {
    rows: rows.map(mapListingCardRow),
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
      ${canonicalListingCte(countWhere, true)}
      SELECT p.deal_type, count(*)::int AS total
      FROM properties p JOIN canonical c ON c.id=p.id
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

/**
 * The verified 28Hse promotion grade for a listing, as a rank the client's
 * requested order can sort on: 黃金 > 置頂 > 普通, with an unobserved listing
 * last (網頁07092026.docx p5).
 *
 * Resolved through property_source_links, the same join both ingestion
 * generations maintain, so the tier belongs to the canonical property rather
 * than to whichever source row happened to win field selection. Only an
 * `active` link counts, so a delisted source row cannot keep pinning a
 * listing to the top. min() picks the strongest grade deterministically when a
 * property has several verified linked source observations -- it never changes
 * which source or agent the listing itself is attributed to.
 *
 * COALESCE to 3 means "no verified grade observed": an unclassified or
 * Property.hk-only listing keeps its existing unpromoted fallback position and
 * is never presented as a paid tier.
 */
const PROMOTION_TIER_RANK_JOIN = `LEFT JOIN LATERAL (
  SELECT min(
    CASE t.promotion_tier
      WHEN 'gold' THEN 0
      WHEN 'pinned' THEN 1
      WHEN 'normal' THEN 2
      ELSE 3
    END
  ) AS rank
  FROM property_source_links psl
  JOIN mls_source_promotion_tiers t
    ON t.source = psl.source
   AND t.external_listing_id = psl.external_listing_id
   AND t.deal_type = psl.deal_type
  WHERE psl.property_id = p.id AND psl.status = 'active'
) promotion ON TRUE`;

const PROMOTION_TIER_RANK_EXPRESSION = "COALESCE(promotion.rank, 3)";

/**
 * Whether mls_source_promotion_tiers exists yet.
 *
 * Postgres rejects a query naming a missing relation at parse time, so the
 * ranked feed cannot simply be attempted and caught -- the homepage would 500
 * for every visitor between this code deploying and
 * 20260909120000_source_promotion_tiers.sql being applied. Same probe-then-
 * degrade shape readPublicSourceMetadata (public-source-metadata.mjs) already
 * uses for its own optional tables.
 *
 * Cached briefly rather than forever so the ranking starts working once the
 * migration is applied, with no redeploy, and rather than per request so the
 * feed does not pay for two round trips on every homepage view. A negative
 * result is cached for the same short window: the cost of being wrong is one
 * page render without the tier ordering, not an error.
 */
const PROMOTION_TIER_TABLE_TTL_MS = 60_000;
let promotionTierTable: { available: boolean; checkedAt: number } | null = null;

async function promotionTierTableAvailable(): Promise<boolean> {
  if (promotionTierTable && Date.now() - promotionTierTable.checkedAt < PROMOTION_TIER_TABLE_TTL_MS)
    return promotionTierTable.available;
  try {
    const rows = await sql().query(
      "SELECT to_regclass('mls_source_promotion_tiers') IS NOT NULL AS available",
    );
    const available = rows[0]?.available === true;
    promotionTierTable = { available, checkedAt: Date.now() };
    return available;
  } catch {
    // A probe failure is not a reason to fail the homepage. Degrade to the
    // unranked feed, and re-probe after the TTL.
    promotionTierTable = { available: false, checkedAt: Date.now() };
    return false;
  }
}

/**
 * The homepage's live listing feed.
 *
 * Ordering happens in SQL, before the row limit, and the region predicate is
 * applied in SQL too. Both were previously done in the caller
 * (queries.ts's fetchFeaturedProperties) on a fixed 24-row over-fetch, which
 * meant a higher-priority listing sitting at row 25 could never appear no
 * matter how it ranked -- the 黃金-first ordering the client asked for cannot
 * be built on top of a window that has already discarded candidates.
 *
 * Deduplication still happens first: canonicalListingCte collapses each
 * public_listing_no to one row before this ORDER BY sees it, so a listing with
 * several source rows or several offers is one card, ranked once.
 *
 * Staff `featured` flags and publication/delisting rules are untouched --
 * `p.status = 'active'` is still the gate, and LISTING_NEWEST_ORDER remains
 * the within-tier order, so this only inserts the client's tier priority
 * ahead of the existing deterministic freshness/id tiebreak.
 */
export async function fetchFeaturedProperties(input: {
  limit: number;
  districtSlugs?: string[];
  estateSlugs?: string[];
  textAliases?: string[];
  outOfScopeTextAliases?: string[];
}): Promise<NeonPropertyRow[]> {
  const pageSize = boundedPublicCount(input.limit, 6, 100);
  const scope = normalizeCorridorInventoryInput({
    districtSlugs: input.districtSlugs ?? [],
    estateSlugs: input.estateSlugs ?? [],
    textAliases: input.textAliases ?? [],
    outOfScopeTextAliases: input.outOfScopeTextAliases ?? [],
    limit: pageSize,
  });

  const ranked = await promotionTierTableAvailable();

  const params: unknown[] = [];
  // With no scope terms the feed stays exactly as broad as it was before the
  // region predicate moved into SQL -- every active listing, with the caller's
  // own filter still applied afterwards as defense in depth.
  const where = hasCorridorAliases(scope) ? corridorWhere(scope, params) : "p.status = 'active'";
  // Before the migration lands there is no tier to rank on, so the feed keeps
  // its previous freshness order rather than erroring.
  const order = ranked
    ? `${PROMOTION_TIER_RANK_EXPRESSION} ASC, ${LISTING_NEWEST_ORDER}`
    : LISTING_NEWEST_ORDER;
  const limitParam = addParam(params, pageSize);

  const rows = await sql().query(
    `
    ${canonicalListingCte(where, false, LISTING_NEWEST_ORDER)}
    SELECT ${listingCardColumns}
    FROM properties p JOIN canonical c ON c.id=p.id
    LEFT JOIN estates e ON e.id = p.estate_id
    ${ranked ? PROMOTION_TIER_RANK_JOIN : ""}
    WHERE ${where}
    ORDER BY ${order}
    LIMIT ${limitParam}
    `,
    params,
  );
  return rows.map(mapListingCardRow);
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
    WITH requested AS (
      SELECT requested.id, requested_public.public_listing_no
      FROM properties requested
      JOIN property_public_members requested_public ON requested_public.property_id = requested.id
      WHERE requested.listing_no = $1 OR requested_public.public_listing_no = $1
    ), ranked AS (
      SELECT p.id, ppm.public_listing_no, ROW_NUMBER() OVER (
        PARTITION BY ppm.public_listing_no, p.deal_type
        ORDER BY p.source_updated_at DESC NULLS LAST, p.last_seen_at DESC NULLS LAST, p.updated_at DESC NULLS LAST, p.created_at DESC, p.id ASC
      ) AS offering_rank
      FROM property_public_members ppm
      JOIN properties p ON p.id = ppm.property_id
      WHERE ppm.public_listing_no = (SELECT public_listing_no FROM requested LIMIT 1)
    ), current_offerings AS (
      SELECT p.*, ranked.public_listing_no
      FROM ranked JOIN properties p ON p.id = ranked.id
      WHERE ranked.offering_rank = 1
    ), c AS (
      SELECT current_offerings.id, current_offerings.public_listing_no,
        ARRAY(
          SELECT alias_property.listing_no
          FROM property_public_members alias_member
          JOIN properties alias_property ON alias_property.id = alias_member.property_id
          WHERE alias_member.public_listing_no = current_offerings.public_listing_no
          ORDER BY alias_property.listing_no
        ) AS listing_aliases,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', offering.id, 'listing_no', offering.listing_no,
          'deal_type', offering.deal_type, 'price', offering.price,
          'rent', offering.rent, 'status', offering.status,
          'description', offering.description
        ) ORDER BY offering.deal_type, offering.listing_no)
        FROM current_offerings offering WHERE offering.status = 'active'), '[]'::jsonb) AS offerings
      FROM current_offerings
      ORDER BY (current_offerings.status = 'active') DESC,
        current_offerings.source_updated_at DESC NULLS LAST,
        current_offerings.last_seen_at DESC NULLS LAST,
        current_offerings.updated_at DESC NULLS LAST,
        current_offerings.created_at DESC,
        current_offerings.id ASC
      LIMIT 1
    )
    SELECT ${detailListingColumns}
    FROM c JOIN properties p ON p.id = c.id
    LEFT JOIN estates e ON e.id = p.estate_id
    LEFT JOIN LATERAL (
      SELECT CASE WHEN COUNT(DISTINCT member_property.saleable_area) = 1 THEN MAX(member_property.saleable_area) END AS saleable_area,
        CASE WHEN COUNT(DISTINCT member_property.gross_area) = 1 THEN MAX(member_property.gross_area) END AS gross_area,
        CASE WHEN COUNT(DISTINCT member_property.bedrooms) = 1 THEN MAX(member_property.bedrooms) END AS bedrooms,
        CASE WHEN COUNT(DISTINCT member_property.floor) = 1 THEN MAX(member_property.floor) END AS floor
      FROM property_public_members group_member
      JOIN properties member_property ON member_property.id = group_member.property_id
      WHERE group_member.public_listing_no = c.public_listing_no
    ) group_facts ON true
    ${publicAgentJoin}
    LIMIT 1
    `,
    [input.listingNo],
  );
  if (!rows[0]) return null;
  let row = rows[0];
  // Shared page copy is independent of each offering's materialized note. Probe
  // the additive table before referencing it so pre-migration public reads work.
  const [managementSchema] = await sql().query(
    `SELECT to_regclass('admin_property_overrides') IS NOT NULL AS available`,
  );
  if (managementSchema?.available === true) {
    const [override] = await sql().query(
      `SELECT shared->>'description' AS description FROM admin_property_overrides
       WHERE property_no = $1 AND shared ? 'description'`,
      [row.public_listing_no],
    );
    // Presence, rather than COALESCE, preserves an intentional null/empty edit.
    if (override) row = { ...row, description: override.description };
  }
  const metadata = await import("../mls/public-source-metadata.mjs");
  const sourceMetadata = await metadata.readPublicSourceMetadata(
    (statement, params) => sql().query(statement, params),
    String(row.id),
  );
  return { ...mapListingRow(row), ...sourceMetadata };
}
export async function fetchPropertyByLegacyDetailId(input: {
  oldId: string;
}): Promise<NeonLegacyPropertyMatch> {
  const rows = await sql().query(
    `
    SELECT ppm.public_listing_no AS listing_no
    FROM properties legacy
    JOIN property_public_members ppm ON ppm.property_id = legacy.id
    WHERE legacy.legacy_detail_id = $1
      AND EXISTS (
        SELECT 1
        FROM (
          SELECT latest.status, ROW_NUMBER() OVER (
            PARTITION BY latest.deal_type
            ORDER BY latest.source_updated_at DESC NULLS LAST,
              latest.last_seen_at DESC NULLS LAST, latest.updated_at DESC NULLS LAST,
              latest.created_at DESC, latest.id ASC
          ) AS offering_rank
          FROM property_public_members active_member
          JOIN properties latest ON latest.id = active_member.property_id
          WHERE active_member.public_listing_no = ppm.public_listing_no
        ) current_group_offerings
        WHERE current_group_offerings.offering_rank = 1
          AND current_group_offerings.status = 'active'
      )
    ORDER BY legacy.deal_type ASC
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
    ${canonicalListingCte(`p.status = 'active' AND p.estate_id = $1 AND p.deal_type = $2::deal_type AND p.id <> $3
      AND NOT EXISTS (
        SELECT 1 FROM property_public_members current_member
        WHERE current_member.property_id = $3
          AND current_member.public_listing_no = current_offerings.public_listing_no
      )`)}
    SELECT ${listingCardColumns}
    FROM properties p JOIN canonical c ON c.id=p.id
    LEFT JOIN estates e ON e.id = p.estate_id

    WHERE p.status = 'active'
      AND p.estate_id = $1
      AND p.deal_type = $2::deal_type
      AND p.id <> $3
    ORDER BY p.featured DESC, p.last_seen_at DESC NULLS LAST, p.created_at DESC, p.id ASC
    LIMIT $4
    `,
    [input.estateId, input.dealType, input.excludeId, boundedPublicCount(input.limit, 4, 100)],
  );
  return rows.map(mapListingCardRow);
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
/**
 * One URL per public listing group for sitemap.xml: the canonical
 * public_listing_no (what /property/$listingNo self-canonicalises to) and
 * the newest updated_at across the group's members. Only groups with a
 * currently-active member are listed -- sold/rented pages are noindex'd and
 * offline/draft ones 404, so neither belongs in the sitemap.
 */
export async function fetchSitemapListings(): Promise<
  Array<{ public_listing_no: string; updated_at: string | null }>
> {
  const rows = await sql().query(
    `
    WITH ranked_offerings AS (
      SELECT ppm.public_listing_no, p.status, p.updated_at,
        ROW_NUMBER() OVER (
          PARTITION BY ppm.public_listing_no, p.deal_type
          ORDER BY p.source_updated_at DESC NULLS LAST,
            p.last_seen_at DESC NULLS LAST, p.updated_at DESC NULLS LAST,
            p.created_at DESC, p.id ASC
        ) AS offering_rank
      FROM property_public_members ppm
      JOIN properties p ON p.id = ppm.property_id
    )
    SELECT public_listing_no, MAX(updated_at) AS updated_at
    FROM ranked_offerings
    WHERE offering_rank = 1 AND status = 'active'
    GROUP BY public_listing_no
    ORDER BY public_listing_no
    `,
  );
  return rows.map((row) => ({
    public_listing_no: stringOrEmpty(row.public_listing_no),
    updated_at: dateOrNull(row.updated_at),
  }));
}

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
    ${canonicalListingCte("p.status = 'active'")}
    SELECT e.slug AS estate_slug, count(*)::int AS count
    FROM properties p JOIN canonical c ON c.id=p.id
    INNER JOIN estates e ON e.id = p.estate_id
    WHERE p.status = 'active'
    GROUP BY e.slug
    `,
  );
  return Object.fromEntries(rows.map((row) => [stringOrEmpty(row.estate_slug), Number(row.count)]));
}

export async function fetchEstateOptions(): Promise<NeonEstateOption[]> {
  return cachedPublicEstateOptions(async () => {
    const rows = await sql().query(
      "SELECT slug, name_zh FROM estates WHERE COALESCE((to_jsonb(estates)->>'published')::boolean, true) ORDER BY name_zh",
    );
    return rows.map((row) => ({
      slug: stringOrEmpty(row.slug),
      name_zh: stringOrEmpty(row.name_zh),
    }));
  });
}

// Latest source offering per property/deal, before status and estate filters.
// These are asking prices, never transaction valuations or cached manual figures.
const estateMarketJoin = `LEFT JOIN LATERAL (
  WITH ranked AS (
    SELECT p.*, ROW_NUMBER() OVER (
      PARTITION BY m.public_listing_no,p.deal_type
      ORDER BY p.source_updated_at DESC NULLS LAST,p.last_seen_at DESC NULLS LAST,
        p.updated_at DESC NULLS LAST,p.created_at DESC,p.id ASC
    ) AS rank
    FROM properties p JOIN property_public_members m ON m.property_id=p.id
  ), current AS (SELECT * FROM ranked WHERE rank=1 AND status='active' AND estate_id=e.id)
  SELECT ROUND(AVG(price / NULLIF(saleable_area,0)) FILTER (
    WHERE deal_type='sale' AND price>0 AND saleable_area>0)) AS asking_psf,
    (SELECT images[1] FROM current WHERE array_length(images,1)>0
      ORDER BY source_updated_at DESC NULLS LAST,id LIMIT 1) AS listing_image
  FROM current
) market ON true`;

export async function fetchEstates(input: { districtSlug?: string } = {}) {
  const districtSlug = input.districtSlug ?? "sham-tseng";
  const rows = await sql().query(
    `
    SELECT e.*, market.asking_psf AS avg_saleable_psf,
      COALESCE(NULLIF(e.hero_image,''),market.listing_image) AS hero_image
    FROM estates e ${estateMarketJoin}
    WHERE e.district_slug = $1
      AND COALESCE((to_jsonb(e)->>'published')::boolean, true)
    ORDER BY total_units DESC NULLS LAST, name_zh ASC
    `,
    [districtSlug],
  );
  return rows;
}

/**
 * Loads the published `estates` rows for an explicit, bounded set of canonical
 * slugs, in one round trip.
 *
 * Added for the client's 2026-09-07 presentation groups, which span more than
 * one `district_slug` (深井 / 青龍頭 is "sham-tseng" *and* "tsing-lung-tau"):
 * fetchEstates() above can only ask for one district, so 帝華軒 -- a real,
 * published, tsing-lung-tau row -- was never returned to the homepage. Asking
 * by approved canonical membership instead of by district also avoids a
 * per-estate request loop and keeps the query bounded regardless of how many
 * districts a group grows to span.
 *
 * Publication is still gated exactly as fetchEstates() gates it, and the
 * ordering below is only a stable tiebreak -- the caller re-orders into the
 * client's own sequence.
 */
export async function fetchEstatesBySlugs(input: { slugs: string[] }) {
  if (!input) throw new TypeError("INVALID_PUBLIC_SCOPE");
  const slugs = cleanTerms(input.slugs, 64);
  if (slugs.length === 0) return [];
  const rows = await sql().query(
    `
    SELECT e.*, market.asking_psf AS avg_saleable_psf,
      COALESCE(NULLIF(e.hero_image,''),market.listing_image) AS hero_image
    FROM estates e ${estateMarketJoin}
    WHERE e.slug = ANY($1::text[])
      AND COALESCE((to_jsonb(e)->>'published')::boolean, true)
    ORDER BY e.slug ASC
    `,
    [slugs],
  );
  return rows;
}

export async function fetchEstateBySlug(input: { slug: string }) {
  const rows = await sql().query(
    `SELECT e.*, market.asking_psf AS avg_saleable_psf,
      COALESCE(NULLIF(e.hero_image,''),market.listing_image) AS hero_image
     FROM estates e ${estateMarketJoin}
     WHERE e.slug = $1 AND COALESCE((to_jsonb(e)->>'published')::boolean, true) LIMIT 1`,
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
    [input.districtSlug, boundedPublicCount(input.monthsBack, 12, 36)],
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
    [input.estateId, boundedPublicCount(input.limit, 8, 100)],
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
  assertTransactionFilters(input);
  const params: unknown[] = [];
  const where = transactionsWhere(input, params);
  const limit = Number.isSafeInteger(input.limit) ? Math.min(Math.max(1, input.limit), 100) : 1;
  const requestedOffset = input.offset ?? 0;
  const offset =
    Number.isSafeInteger(requestedOffset) && requestedOffset >= 0 && requestedOffset <= 1_000_000
      ? requestedOffset
      : 0;
  const limitParam = addParam(params, limit);
  const offsetParam = addParam(params, offset);
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
  assertTransactionFilters(input);
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
    SELECT slug, title, excerpt, cover_image, category, reading_minutes, published_at, updated_at
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
    // The admin CMS has collected these two per article since
    // 20260623090000_neon_admin_crm_whatsapp.sql, and nothing ever selected
    // them -- so every hand-written article SEO 標題/描述 was written to the
    // database and silently discarded. blog_.$slug.tsx's head() reads them now.
    seo_title: stringOrNull(row.seo_title),
    seo_description: stringOrNull(row.seo_description),
    published_at: dateOrNull(row.published_at) ?? new Date().toISOString(),
    updated_at: dateOrNull(row.updated_at),
  }));
}

export async function fetchArticleBySlug(input: { slug: string }) {
  const rows = await sql().query(
    `
    SELECT slug, title, excerpt, content, cover_image, category, reading_minutes,
      published_at, updated_at, seo_title, seo_description
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
    // The admin CMS has collected these two per article since
    // 20260623090000_neon_admin_crm_whatsapp.sql, and nothing ever selected
    // them -- so every hand-written article SEO 標題/描述 was written to the
    // database and silently discarded. blog_.$slug.tsx's head() reads them now.
    seo_title: stringOrNull(row.seo_title),
    seo_description: stringOrNull(row.seo_description),
    published_at: dateOrNull(row.published_at) ?? new Date().toISOString(),
    updated_at: dateOrNull(row.updated_at),
  };
}

export async function fetchEstateDirectory(): Promise<
  import("../estate-directory").EstateDirectoryData
> {
  const rows = await sql().query(
    `
 WITH ranked AS (
   SELECT p.*,m.public_listing_no,ROW_NUMBER() OVER(
    PARTITION BY m.public_listing_no,p.deal_type
    ORDER BY p.source_updated_at DESC NULLS LAST,p.last_seen_at DESC NULLS LAST,
      p.updated_at DESC NULLS LAST,p.created_at DESC,p.id ASC
   ) AS rank
   FROM properties p JOIN property_public_members m ON m.property_id=p.id
 ), current AS (SELECT * FROM ranked WHERE rank=1 AND status='active')
 SELECT e.slug,e.name_zh,e.name_en,e.aliases,e.district_slug,
   count(DISTINCT c.public_listing_no)::int AS total,
   count(DISTINCT c.public_listing_no) FILTER(WHERE c.deal_type='sale')::int AS sale,
   count(DISTINCT c.public_listing_no) FILTER(WHERE c.deal_type='rent')::int AS rent
 FROM estates e LEFT JOIN current c ON c.estate_id=e.id
 WHERE e.published=true
 GROUP BY e.id,e.slug,e.name_zh,e.name_en,e.aliases,e.district_slug
 ORDER BY e.name_zh`,
    [],
  );
  return {
    generatedAt: new Date().toISOString(),
    rows: rows.map((row) => ({
      slug: stringOrEmpty(row.slug),
      nameZh: stringOrEmpty(row.name_zh),
      nameEn: stringOrNull(row.name_en),
      aliases: textArrayOrNull(row.aliases) ?? [],
      districtSlug: stringOrNull(row.district_slug),
      total: Number(row.total),
      sale: Number(row.sale),
      rent: Number(row.rent),
    })),
  };
}
