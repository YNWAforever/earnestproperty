import "@tanstack/react-start/server-only";

import {
  addParam,
  dateOrNull,
  numberOrNull,
  queryRows,
  stringOrEmpty,
  stringOrNull,
} from "./db.server";
import type { StaffAccess } from "./auth.server";
import type {
  AdminLeadAiProfile,
  AdminArticleInput,
  AdminAudienceInput,
  AdminCampaignInput,
  AdminConversationUpdateInput,
  AdminEstateInput,
  AdminFaqInput,
  AdminLeadActivityInput,
  AdminLeadUpdateInput,
  AdminListingFiltersInput,
  AdminAudiencePreview,
  AdminAiKnowledgeRebuildResult,
  AdminAiKnowledgeStatus,
  AdminCrmSegmentPreview,
  AdminCrmSegmentRow,
} from "./admin-data.types";
import { getAiServerConfig } from "../ai/config.server.ts";
import { analyzeCrmLead, approveCrmAiTag, fetchCrmAiProfile } from "../ai/crm-enrichment.server.ts";
import { rebuildAiKnowledgeIndex } from "../ai/knowledge.server.ts";
import type { CrmSegmentFilters } from "../ai/ai-types";
import {
  listCrmSegments,
  materializeCrmSegment,
  previewCrmSegment,
  saveCrmSegment,
} from "../ai/segments.server.ts";
import {
  canPrepareAdminCampaignQueue,
  canQueueAdminCampaign,
  normalizeAdminPhone,
} from "./admin-workflow";

export type AdminPropertyInput = {
  id?: string;
  listing_no: string;
  title_zh: string;
  deal_type: "sale" | "rent";
  estate_id: string | null;
  district_slug: string;
  address: string | null;
  price: number | null;
  rent: number | null;
  saleable_area: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor: string | null;
  description: string | null;
  status: "draft" | "active" | "sold" | "rented" | "offline";
  featured: boolean;
  images: string[];
  agent_id: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
};

type AdminListingInput = AdminListingFiltersInput & { limit?: number };
type AudienceFilters = AdminAudienceInput["filters"];
type AudienceSummary = {
  total: number;
  eligible: number;
  optedOut: number;
  missingPhone: number;
  notOptedIn: number;
};

const RECIPIENT_ELIGIBILITY_SQL = `
SELECT DISTINCT ON (c.id) c.id, c.normalized_phone, c.opt_in_whatsapp, c.opted_out_whatsapp
FROM crm_contacts c
LEFT JOIN crm_leads l ON l.contact_id = c.id
LEFT JOIN properties p ON p.id = l.property_id
LEFT JOIN estates estate ON estate.id = p.estate_id
WHERE ($1::text IS NULL OR l.intent = $1)
  AND ($2::text IS NULL OR c.source = $2)
  AND ($3::uuid IS NULL OR c.assigned_agent_id = $3::uuid OR l.assigned_agent_id = $3::uuid)
  AND ($4::text IS NULL OR $4::text = ANY(l.preferred_estates) OR estate.slug = $4::text)
ORDER BY c.id, l.updated_at DESC NULLS LAST, l.created_at DESC NULLS LAST
`;

function rowDate(value: unknown) {
  return dateOrNull(value) ?? new Date().toISOString();
}

function requireNonEmpty(value: string | null | undefined, label: string) {
  if (!value?.trim()) throw new Error(`${label} is required`);
}

function optionalText(value: unknown) {
  const text = stringOrNull(value)?.trim();
  return text || undefined;
}

function normalizeAudienceFilters(filters: AudienceFilters | null | undefined): AudienceFilters {
  return {
    intent: optionalText(filters?.intent),
    source: optionalText(filters?.source),
    estate: optionalText(filters?.estate),
    assigned_agent_id: optionalText(filters?.assigned_agent_id),
  };
}

function audienceFiltersFromRecord(value: Record<string, unknown>): AudienceFilters {
  return normalizeAudienceFilters({
    intent: optionalText(value.intent),
    source: optionalText(value.source),
    estate: optionalText(value.estate),
    assigned_agent_id: optionalText(value.assigned_agent_id),
  });
}

function parseAudienceFilters(value: unknown): AudienceFilters {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return audienceFiltersFromRecord(parsed);
    } catch {
      return {};
    }
  }
  if (typeof value === "object") return audienceFiltersFromRecord(value as Record<string, unknown>);
  return {};
}

function audienceFilterParams(filters: AudienceFilters) {
  const normalized = normalizeAudienceFilters(filters);
  return [
    normalized.intent ?? null,
    normalized.source ?? null,
    normalized.assigned_agent_id ?? null,
    normalized.estate ?? null,
  ];
}

function isEligibleAudienceRow(row: Record<string, unknown>) {
  return (
    Boolean(row.normalized_phone) &&
    row.opt_in_whatsapp === true &&
    row.opted_out_whatsapp === false
  );
}

function summarizeAudienceRows(rows: Record<string, unknown>[]): AudienceSummary {
  return rows.reduce<AudienceSummary>(
    (summary, row) => {
      summary.total += 1;
      if (isEligibleAudienceRow(row)) summary.eligible += 1;
      if (!row.normalized_phone) summary.missingPhone += 1;
      if (row.opted_out_whatsapp === true) summary.optedOut += 1;
      if (row.opt_in_whatsapp !== true) summary.notOptedIn += 1;
      return summary;
    },
    { total: 0, eligible: 0, optedOut: 0, missingPhone: 0, notOptedIn: 0 },
  );
}

async function fetchAudienceRecipientRows(filters: AudienceFilters) {
  return queryRows(RECIPIENT_ELIGIBILITY_SQL, audienceFilterParams(filters));
}

async function resolveAudienceFilters(input: { audience_id?: string; filters?: AudienceFilters }) {
  if (input.filters) return normalizeAudienceFilters(input.filters);
  if (!input.audience_id) return {};
  const rows = await queryRows("SELECT filters FROM whatsapp_audiences WHERE id = $1 LIMIT 1", [
    input.audience_id,
  ]);
  return parseAudienceFilters(rows[0]?.filters);
}

export async function getAdminOverview() {
  const [properties, leads, contacts, conversations, campaigns] = await Promise.all([
    queryRows("SELECT count(*)::int AS total FROM properties"),
    queryRows(
      "SELECT count(*)::int AS total FROM crm_leads WHERE stage NOT IN ('closed_won', 'closed_lost')",
    ),
    queryRows("SELECT count(*)::int AS total FROM crm_contacts"),
    queryRows("SELECT count(*)::int AS total FROM whatsapp_conversations WHERE status = 'open'"),
    queryRows(
      "SELECT count(*)::int AS total FROM whatsapp_campaigns WHERE status IN ('draft', 'review', 'queued', 'sending')",
    ),
  ]);
  return {
    properties: Number(properties[0]?.total ?? 0),
    openLeads: Number(leads[0]?.total ?? 0),
    contacts: Number(contacts[0]?.total ?? 0),
    openConversations: Number(conversations[0]?.total ?? 0),
    activeCampaigns: Number(campaigns[0]?.total ?? 0),
  };
}

export async function listAdminListings(input: AdminListingInput = {}) {
  const params: unknown[] = [];
  const where: string[] = [];

  if (input.q?.trim()) {
    const param = addParam(params, `%${input.q.trim()}%`);
    where.push(
      `(p.listing_no ILIKE ${param} OR p.title_zh ILIKE ${param} OR e.name_zh ILIKE ${param} OR s.name_zh ILIKE ${param} OR s.name_en ILIKE ${param})`,
    );
  }
  if (input.status && input.status !== "all") {
    where.push(`p.status = ${addParam(params, input.status)}::property_status`);
  }
  if (input.deal_type && input.deal_type !== "all") {
    where.push(`p.deal_type = ${addParam(params, input.deal_type)}::deal_type`);
  }
  if (input.estate_id && input.estate_id !== "all") {
    where.push(`p.estate_id = ${addParam(params, input.estate_id)}::uuid`);
  }
  if (input.featured && input.featured !== "all") {
    where.push(`p.featured = ${addParam(params, input.featured === "yes")}`);
  }
  if (input.agent_id && input.agent_id !== "all") {
    where.push(`p.agent_id = ${addParam(params, input.agent_id)}::uuid`);
  }

  const requestedLimit = Number(input.limit ?? 80);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 200) : 80;
  const limitParam = addParam(params, limit);
  const rows = await queryRows(
    `
    SELECT
      p.id,
      p.listing_no,
      p.title_zh,
      p.deal_type,
      p.price,
      p.rent,
      p.saleable_area,
      p.status,
      p.featured,
      p.images,
      p.updated_at,
      e.name_zh AS estate_name_zh,
      s.name_zh AS agent_name_zh,
      s.name_en AS agent_name_en
    FROM properties p
    LEFT JOIN estates e ON e.id = p.estate_id
    LEFT JOIN staff_users s ON s.id = p.agent_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
    LIMIT ${limitParam}
    `,
    params,
  );
  return rows.map((row) => ({
    id: stringOrEmpty(row.id),
    listing_no: stringOrEmpty(row.listing_no),
    title_zh: stringOrEmpty(row.title_zh),
    deal_type: stringOrEmpty(row.deal_type),
    price: numberOrNull(row.price),
    rent: numberOrNull(row.rent),
    saleable_area: numberOrNull(row.saleable_area),
    status: stringOrEmpty(row.status),
    featured: row.featured === true,
    images: Array.isArray(row.images) ? row.images.map(String) : [],
    updated_at: rowDate(row.updated_at),
    estate_name_zh: stringOrNull(row.estate_name_zh),
    agent_name: stringOrNull(row.agent_name_zh) ?? stringOrNull(row.agent_name_en),
  }));
}

export async function getAdminProperty(id: string) {
  const rows = await queryRows("SELECT * FROM properties WHERE id = $1 LIMIT 1", [id]);
  return rows[0] ?? null;
}

export async function listAdminEstateOptions() {
  const rows = await queryRows(
    "SELECT id, name_zh, district_slug FROM estates ORDER BY name_zh ASC",
  );
  return rows.map((row) => ({
    id: stringOrEmpty(row.id),
    name_zh: stringOrEmpty(row.name_zh),
    district_slug: stringOrEmpty(row.district_slug),
  }));
}

export async function saveAdminProperty(input: AdminPropertyInput, actor: StaffAccess) {
  const params = [
    input.listing_no,
    input.title_zh,
    input.deal_type,
    input.estate_id,
    input.district_slug,
    input.address,
    input.price,
    input.rent,
    input.saleable_area,
    input.bedrooms,
    input.bathrooms,
    input.floor,
    input.description,
    input.status,
    input.featured,
    input.images,
    input.seo_title ?? null,
    input.seo_description ?? null,
    input.agent_id ?? null,
  ];

  const rows = input.id
    ? await queryRows(
        `
        UPDATE properties SET
          listing_no = $1,
          title_zh = $2,
          deal_type = $3::deal_type,
          estate_id = $4,
          district_slug = $5,
          address = $6,
          price = $7,
          rent = $8,
          saleable_area = $9,
          bedrooms = $10,
          bathrooms = $11,
          floor = $12,
          description = $13,
          status = $14::property_status,
          featured = $15,
          images = $16::text[],
          seo_title = $17,
          seo_description = $18,
          agent_id = $19,
          updated_at = now()
        WHERE id = $20
        RETURNING id
        `,
        [...params, input.id],
      )
    : await queryRows(
        `
        INSERT INTO properties (
          listing_no, title_zh, deal_type, estate_id, district_slug, address, price, rent,
          saleable_area, bedrooms, bathrooms, floor, description, status, featured, images,
          seo_title, seo_description, agent_id
        )
        VALUES ($1, $2, $3::deal_type, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::property_status, $15, $16::text[], $17, $18, $19)
        RETURNING id
        `,
        params,
      );

  if (input.id && !rows[0]) return { id: "", error: "Not found" };
  const id = stringOrEmpty(rows[0]?.id);
  await writeAudit(actor.staffId, input.id ? "property.update" : "property.create", "property", id);
  return { id };
}

export async function updateAdminPropertyStatus(
  id: string,
  status: AdminPropertyInput["status"],
  actor: StaffAccess,
) {
  const rows = await queryRows(
    "UPDATE properties SET status = $1::property_status, updated_at = now() WHERE id = $2 RETURNING id",
    [status, id],
  );
  if (!rows[0]) return { ok: false, error: "Not found" };
  await writeAudit(actor.staffId, "property.status", "property", id, { status });
  return { ok: true };
}

export async function deleteAdminProperty(id: string, actor: StaffAccess) {
  const rows = await queryRows("DELETE FROM properties WHERE id = $1 RETURNING id", [id]);
  if (!rows[0]) return { ok: false, error: "Not found" };
  await writeAudit(actor.staffId, "property.delete", "property", id);
  return { ok: true };
}

export async function fetchAdminAgents() {
  const rows = await queryRows(`
    SELECT
      s.id,
      COALESCE(s.name_zh, s.name_en) AS name,
      s.email,
      s.active,
      COALESCE(array_to_json(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL)), '[]'::json) AS roles
    FROM staff_users s
    LEFT JOIN staff_roles r ON r.staff_user_id = s.id
    GROUP BY s.id
    ORDER BY s.active DESC, name ASC NULLS LAST, s.email ASC NULLS LAST
  `);
  return rows.map((row) => ({
    id: stringOrEmpty(row.id),
    name: stringOrNull(row.name),
    email: stringOrNull(row.email),
    active: row.active === true,
    roles: Array.isArray(row.roles) ? row.roles.map(String) : [],
  }));
}

export async function fetchAdminAiKnowledgeStatus(
  actor: StaffAccess,
): Promise<AdminAiKnowledgeStatus> {
  void actor;
  const config = getAiServerConfig();
  const rows = await queryRows(
    `SELECT
       (SELECT count(*)::int FROM ai_knowledge_sources) AS sources,
       (SELECT count(*)::int FROM ai_knowledge_chunks) AS chunks,
       (SELECT count(*)::int
        FROM ai_knowledge_chunks c
        JOIN ai_knowledge_sources s ON s.id = c.source_id
        WHERE c.visibility = 'public'
          AND s.public_visibility = 'public'
          AND c.stale = false
          AND s.published = true) AS public_chunks,
       (SELECT count(*)::int FROM ai_knowledge_chunks WHERE stale = true) AS stale_chunks,
       (SELECT max(last_indexed_at) FROM ai_knowledge_sources) AS last_indexed_at`,
  );
  const row = rows[0] ?? {};
  return {
    enabled: config.enabled,
    sources: numberOrNull(row.sources) ?? 0,
    chunks: numberOrNull(row.chunks) ?? 0,
    publicChunks: numberOrNull(row.public_chunks) ?? 0,
    staleChunks: numberOrNull(row.stale_chunks) ?? 0,
    lastIndexedAt: dateOrNull(row.last_indexed_at),
  };
}

export async function rebuildAdminAiKnowledge(
  actor: StaffAccess,
): Promise<AdminAiKnowledgeRebuildResult> {
  const result = await rebuildAiKnowledgeIndex();
  await writeAudit(actor.staffId, "ai.knowledge.rebuild", "ai_knowledge", undefined, result);
  return result;
}

export async function fetchAdminCrmSegments(actor: StaffAccess): Promise<AdminCrmSegmentRow[]> {
  void actor;
  return listCrmSegments();
}

export async function previewAdminCrmSegment(
  input: { prompt: string },
  actor: StaffAccess,
): Promise<AdminCrmSegmentPreview> {
  void actor;
  return previewCrmSegment({ prompt: input.prompt });
}

export async function saveAdminCrmSegment(
  input: {
    id?: string;
    name: string;
    description: string | null;
    natural_language_prompt: string;
    structured_filters: CrmSegmentFilters;
    status: "draft" | "active" | "archived";
  },
  actor: StaffAccess,
) {
  const id = await saveCrmSegment({
    ...input,
    staffId: actor.staffId,
  });
  await writeAudit(
    actor.staffId,
    input.id ? "ai.segment.update" : "ai.segment.create",
    "crm_segment",
    id,
  );
  return id;
}

export async function materializeAdminCrmSegment(input: { segmentId: string }, actor: StaffAccess) {
  const result = await materializeCrmSegment({ segmentId: input.segmentId });
  await writeAudit(actor.staffId, "ai.segment.materialize", "crm_segment", input.segmentId, result);
  return result;
}

export async function listAdminCms() {
  const [estates, articles, faqGroups, faqs] = await Promise.all([
    queryRows(
      `SELECT id, slug, name_zh, name_en, district_slug, developer, year_completed, phases,
        total_units, area_min, area_max, description, hero_image, facilities,
        seo_title, seo_description, updated_at
       FROM estates
       ORDER BY updated_at DESC
       LIMIT 40`,
    ),
    queryRows(
      `SELECT id, slug, title, excerpt, content, cover_image, category, reading_minutes,
        published, published_at, seo_title, seo_description, updated_at
       FROM articles
       ORDER BY updated_at DESC
       LIMIT 40`,
    ),
    queryRows(
      "SELECT scope, count(*)::int AS total FROM faqs GROUP BY scope ORDER BY scope ASC LIMIT 80",
    ),
    queryRows(
      `SELECT id, scope, question, answer, sort_order, created_at
       FROM faqs
       ORDER BY scope ASC, sort_order ASC, created_at ASC
       LIMIT 120`,
    ),
  ]);
  return {
    estates: estates.map((row) => ({
      id: stringOrEmpty(row.id),
      slug: stringOrEmpty(row.slug),
      name_zh: stringOrEmpty(row.name_zh),
      name_en: stringOrNull(row.name_en),
      district_slug: stringOrEmpty(row.district_slug),
      developer: stringOrNull(row.developer),
      year_completed: numberOrNull(row.year_completed),
      phases: numberOrNull(row.phases),
      total_units: numberOrNull(row.total_units),
      area_min: numberOrNull(row.area_min),
      area_max: numberOrNull(row.area_max),
      description: stringOrNull(row.description),
      hero_image: stringOrNull(row.hero_image),
      facilities: Array.isArray(row.facilities) ? row.facilities.map(String) : [],
      seo_title: stringOrNull(row.seo_title),
      seo_description: stringOrNull(row.seo_description),
      updated_at: rowDate(row.updated_at),
    })),
    articles: articles.map((row) => ({
      id: stringOrEmpty(row.id),
      slug: stringOrEmpty(row.slug),
      title: stringOrEmpty(row.title),
      excerpt: stringOrNull(row.excerpt),
      content: stringOrNull(row.content),
      cover_image: stringOrNull(row.cover_image),
      category: stringOrNull(row.category),
      reading_minutes: numberOrNull(row.reading_minutes),
      published: row.published === true,
      published_at: dateOrNull(row.published_at),
      seo_title: stringOrNull(row.seo_title),
      seo_description: stringOrNull(row.seo_description),
      updated_at: rowDate(row.updated_at),
    })),
    faqGroups: faqGroups.map((row) => ({
      scope: stringOrEmpty(row.scope),
      total: numberOrNull(row.total) ?? 0,
    })),
    faqs: faqs.map((row) => ({
      id: stringOrEmpty(row.id),
      scope: stringOrEmpty(row.scope),
      question: stringOrEmpty(row.question),
      answer: stringOrEmpty(row.answer),
      sort_order: numberOrNull(row.sort_order) ?? 0,
      created_at: dateOrNull(row.created_at),
    })),
  };
}

export async function saveAdminEstate(input: AdminEstateInput, actor: StaffAccess) {
  const rows = input.id
    ? await queryRows(
        `UPDATE estates SET slug=$1, name_zh=$2, name_en=$3, district_slug=$4, developer=$5,
          year_completed=$6, phases=$7, total_units=$8, area_min=$9, area_max=$10,
          description=$11, hero_image=$12, facilities=$13::text[], seo_title=$14,
          seo_description=$15, updated_at=now()
         WHERE id=$16 RETURNING id`,
        [
          input.slug,
          input.name_zh,
          input.name_en,
          input.district_slug,
          input.developer,
          input.year_completed,
          input.phases,
          input.total_units,
          input.area_min,
          input.area_max,
          input.description,
          input.hero_image,
          input.facilities,
          input.seo_title,
          input.seo_description,
          input.id,
        ],
      )
    : await queryRows(
        `INSERT INTO estates (slug, name_zh, name_en, district_slug, developer, year_completed,
          phases, total_units, area_min, area_max, description, hero_image, facilities,
          seo_title, seo_description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text[],$14,$15)
         RETURNING id`,
        [
          input.slug,
          input.name_zh,
          input.name_en,
          input.district_slug,
          input.developer,
          input.year_completed,
          input.phases,
          input.total_units,
          input.area_min,
          input.area_max,
          input.description,
          input.hero_image,
          input.facilities,
          input.seo_title,
          input.seo_description,
        ],
      );
  if (input.id && !rows[0]) return { id: "", error: "Not found" };
  const id = stringOrEmpty(rows[0]?.id);
  await writeAudit(actor.staffId, input.id ? "estate.update" : "estate.create", "estate", id);
  return { id };
}

export async function saveAdminArticle(input: AdminArticleInput, actor: StaffAccess) {
  requireNonEmpty(input.slug, "slug");
  requireNonEmpty(input.title, "title");

  const publishedAt = input.published_at ?? new Date().toISOString();
  const params = [
    input.slug,
    input.title,
    input.excerpt,
    input.content,
    input.cover_image,
    input.category,
    input.reading_minutes,
    input.published,
    publishedAt,
    input.seo_title,
    input.seo_description,
    actor.staffId,
  ];

  const rows = input.id
    ? await queryRows(
        `UPDATE articles SET slug=$1, title=$2, excerpt=$3, content=$4, cover_image=$5,
          category=$6, reading_minutes=$7, published=$8, published_at=$9,
          seo_title=$10, seo_description=$11, author_id=$12, updated_at=now()
         WHERE id=$13 RETURNING id`,
        [...params, input.id],
      )
    : await queryRows(
        `INSERT INTO articles (slug, title, excerpt, content, cover_image, category,
          reading_minutes, published, published_at, seo_title, seo_description, author_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        params,
      );

  if (input.id && !rows[0]) return { id: "", error: "Not found" };
  const id = stringOrEmpty(rows[0]?.id);
  await writeAudit(actor.staffId, input.id ? "article.update" : "article.create", "article", id);
  return { id };
}

export async function saveAdminFaq(input: AdminFaqInput, actor: StaffAccess) {
  requireNonEmpty(input.scope, "scope");
  requireNonEmpty(input.question, "question");
  requireNonEmpty(input.answer, "answer");

  const rows = input.id
    ? await queryRows(
        `UPDATE faqs SET scope=$1, question=$2, answer=$3, sort_order=$4
         WHERE id=$5 RETURNING id`,
        [input.scope, input.question, input.answer, input.sort_order, input.id],
      )
    : await queryRows(
        `INSERT INTO faqs (scope, question, answer, sort_order)
         VALUES ($1,$2,$3,$4)
         RETURNING id`,
        [input.scope, input.question, input.answer, input.sort_order],
      );

  if (input.id && !rows[0]) return { id: "", error: "Not found" };
  const id = stringOrEmpty(rows[0]?.id);
  await writeAudit(actor.staffId, input.id ? "faq.update" : "faq.create", "faq", id);
  return { id };
}

export async function deleteAdminFaq(id: string, actor: StaffAccess) {
  const rows = await queryRows("DELETE FROM faqs WHERE id = $1 RETURNING id", [id]);
  if (!rows[0]) return { ok: false, error: "Not found" };
  await writeAudit(actor.staffId, "faq.delete", "faq", id);
  return { ok: true };
}

export async function reorderAdminFaqs(orderedIds: string[], actor: StaffAccess) {
  for (const [index, id] of orderedIds.entries()) {
    await queryRows("UPDATE faqs SET sort_order = $1 WHERE id = $2", [index + 1, id]);
  }
  await writeAudit(actor.staffId, "faq.reorder", "faq", undefined, { orderedIds });
  return { ok: true };
}

export async function fetchAdminMediaAssets() {
  const rows = await queryRows(
    `SELECT id, url, pathname, content_type, size_bytes, alt_text, owner_type, owner_id, created_at
     FROM media_assets
     ORDER BY created_at DESC`,
  );
  return rows.map((row) => ({
    id: stringOrEmpty(row.id),
    url: stringOrEmpty(row.url),
    pathname: stringOrEmpty(row.pathname),
    content_type: stringOrNull(row.content_type),
    size_bytes: numberOrNull(row.size_bytes),
    alt_text: stringOrNull(row.alt_text),
    owner_type: stringOrEmpty(row.owner_type),
    owner_id: stringOrNull(row.owner_id),
    created_at: rowDate(row.created_at),
  }));
}

export async function updateAdminMediaAsset(
  input: { id: string; alt_text: string | null; owner_type: string; owner_id: string | null },
  actor: StaffAccess,
) {
  const rows = await queryRows(
    "UPDATE media_assets SET alt_text = $1, owner_type = $2, owner_id = $3 WHERE id = $4 RETURNING id",
    [input.alt_text, input.owner_type, input.owner_id, input.id],
  );
  if (!rows[0]) return { ok: false, error: "Not found" };
  await writeAudit(actor.staffId, "media.update", "media", input.id);
  return { ok: true };
}

export async function listAdminLeads() {
  const rows = await queryRows(
    `
    SELECT
      l.id,
      l.stage,
      l.intent,
      l.budget_min,
      l.budget_max,
      l.source,
      l.note,
      l.created_at,
      l.assigned_agent_id,
      c.name,
      c.phone,
      c.email,
      c.opt_in_whatsapp,
      p.listing_no,
      p.title_zh AS property_title
    FROM crm_leads l
    LEFT JOIN crm_contacts c ON c.id = l.contact_id
    LEFT JOIN properties p ON p.id = l.property_id
    ORDER BY l.updated_at DESC, l.created_at DESC
    LIMIT 100
    `,
  );
  return rows;
}

export async function fetchAdminLead(id: string) {
  const rows = await queryRows(
    `
    SELECT
      l.id,
      l.stage,
      l.intent,
      l.budget_min,
      l.budget_max,
      l.source,
      l.note,
      l.created_at,
      l.contact_id,
      l.assigned_agent_id,
      l.preferred_estates,
      c.name,
      c.phone,
      c.email,
      c.opt_in_whatsapp,
      p.listing_no,
      p.title_zh AS property_title
    FROM crm_leads l
    LEFT JOIN crm_contacts c ON c.id = l.contact_id
    LEFT JOIN properties p ON p.id = l.property_id
    WHERE l.id = $1
    LIMIT 1
    `,
    [id],
  );
  const lead = rows[0];
  if (!lead) return null;

  const activities = await queryRows(
    `
    SELECT
      a.id,
      a.activity_type,
      a.body,
      a.due_at,
      a.completed_at,
      a.created_at,
      COALESCE(s.name_zh, s.name_en) AS staff_name
    FROM crm_activities a
    LEFT JOIN staff_users s ON s.id = a.staff_user_id
    WHERE a.lead_id = $1
    ORDER BY a.created_at DESC
    `,
    [id],
  );

  return {
    id: stringOrEmpty(lead.id),
    stage: stringOrEmpty(lead.stage),
    intent: stringOrEmpty(lead.intent),
    budget_min: numberOrNull(lead.budget_min),
    budget_max: numberOrNull(lead.budget_max),
    source: stringOrEmpty(lead.source),
    note: stringOrNull(lead.note),
    created_at: rowDate(lead.created_at),
    name: stringOrNull(lead.name),
    phone: stringOrNull(lead.phone),
    email: stringOrNull(lead.email),
    opt_in_whatsapp: lead.opt_in_whatsapp === true,
    assigned_agent_id: stringOrNull(lead.assigned_agent_id),
    listing_no: stringOrNull(lead.listing_no),
    property_title: stringOrNull(lead.property_title),
    contact_id: stringOrNull(lead.contact_id),
    preferred_estates: Array.isArray(lead.preferred_estates)
      ? lead.preferred_estates.map(String)
      : [],
    activities: activities.map((activity) => ({
      id: stringOrEmpty(activity.id),
      activity_type: stringOrEmpty(activity.activity_type),
      body: stringOrNull(activity.body),
      due_at: dateOrNull(activity.due_at),
      completed_at: dateOrNull(activity.completed_at),
      created_at: rowDate(activity.created_at),
      staff_name: stringOrNull(activity.staff_name),
    })),
  };
}

export async function fetchAdminLeadAiProfile(
  input: { leadId: string },
  actor: StaffAccess,
): Promise<AdminLeadAiProfile> {
  void actor;
  return fetchCrmAiProfile({ leadId: input.leadId });
}

export async function analyzeAdminLeadAiProfile(
  input: { leadId: string },
  actor: StaffAccess,
): Promise<AdminLeadAiProfile> {
  const result = await analyzeCrmLead(input.leadId);
  await writeAudit(actor.staffId, "ai.lead.analyze", "lead", input.leadId);
  return result;
}

export async function approveAdminAiTag(input: { tagId: string }, actor: StaffAccess) {
  const result = await approveCrmAiTag({
    tagId: input.tagId,
    staffId: actor.staffId,
    approve: true,
  });
  await writeAudit(actor.staffId, "ai.tag.approve", "ai_tag", input.tagId);
  return result;
}

export async function rejectAdminAiTag(input: { tagId: string }, actor: StaffAccess) {
  const result = await approveCrmAiTag({
    tagId: input.tagId,
    staffId: actor.staffId,
    approve: false,
  });
  await writeAudit(actor.staffId, "ai.tag.reject", "ai_tag", input.tagId);
  return result;
}

export async function updateAdminLead(input: AdminLeadUpdateInput, actor: StaffAccess) {
  const rows = await queryRows(
    `UPDATE crm_leads SET
      stage = $1::crm_lead_stage,
      intent = $2,
      budget_min = $3,
      budget_max = $4,
      preferred_estates = $5::text[],
      assigned_agent_id = $6,
      note = $7,
      updated_at = now()
     WHERE id = $8
     RETURNING id`,
    [
      input.stage,
      input.intent,
      input.budget_min,
      input.budget_max,
      input.preferred_estates,
      input.assigned_agent_id,
      input.note,
      input.id,
    ],
  );
  if (!rows[0]) return { ok: false, error: "Not found" };
  await writeAudit(actor.staffId, "lead.update", "lead", input.id, {
    stage: input.stage,
    intent: input.intent,
  });
  return { ok: true };
}

export async function createAdminLeadActivity(input: AdminLeadActivityInput, actor: StaffAccess) {
  const rows = await queryRows(
    `INSERT INTO crm_activities (
      lead_id, contact_id, staff_user_id, activity_type, body, due_at, completed_at
    )
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [
      input.lead_id,
      input.contact_id,
      actor.staffId,
      input.activity_type,
      input.body,
      input.due_at,
      input.completed_at,
    ],
  );
  const id = stringOrEmpty(rows[0]?.id);
  await writeAudit(actor.staffId, "lead.activity", "lead", input.lead_id, {
    activityId: id,
    activity_type: input.activity_type,
  });
  return { id };
}

export async function listAdminConversations() {
  const rows = await queryRows(
    `
    SELECT
      wc.id,
      wc.status,
      wc.last_message_at,
      wc.last_inbound_at,
      c.name,
      c.phone,
      c.opted_out_whatsapp,
      m.text AS last_text,
      m.direction AS last_direction
    FROM whatsapp_conversations wc
    LEFT JOIN crm_contacts c ON c.id = wc.contact_id
    LEFT JOIN LATERAL (
      SELECT text, direction
      FROM whatsapp_messages
      WHERE conversation_id = wc.id
      ORDER BY created_at DESC
      LIMIT 1
    ) m ON true
    ORDER BY wc.last_message_at DESC NULLS LAST, wc.updated_at DESC
    LIMIT 100
    `,
  );
  return rows;
}

export async function fetchAdminConversation(id: string) {
  const rows = await queryRows(
    `
    SELECT
      wc.id,
      wc.contact_id,
      wc.woztell_member_id,
      wc.status,
      wc.last_message_at,
      wc.last_inbound_at,
      wc.assigned_agent_id,
      c.name,
      c.phone,
      c.opted_out_whatsapp,
      m.text AS last_text,
      m.direction AS last_direction
    FROM whatsapp_conversations wc
    LEFT JOIN crm_contacts c ON c.id = wc.contact_id
    LEFT JOIN LATERAL (
      SELECT text, direction
      FROM whatsapp_messages
      WHERE conversation_id = wc.id
      ORDER BY created_at DESC
      LIMIT 1
    ) m ON true
    WHERE wc.id = $1
    LIMIT 1
    `,
    [id],
  );
  const conversation = rows[0];
  if (!conversation) return null;

  const messages = await queryRows(
    `
    SELECT id, direction, message_type, text, status, error, created_at
    FROM (
      SELECT id, direction, message_type, text, status, error, created_at
      FROM whatsapp_messages
      WHERE conversation_id = $1
      ORDER BY created_at DESC
      LIMIT 100
    ) latest
    ORDER BY created_at ASC
    `,
    [id],
  );

  return {
    id: stringOrEmpty(conversation.id),
    status: stringOrEmpty(conversation.status),
    last_message_at: dateOrNull(conversation.last_message_at),
    last_inbound_at: dateOrNull(conversation.last_inbound_at),
    name: stringOrNull(conversation.name),
    phone: stringOrNull(conversation.phone),
    opted_out_whatsapp: conversation.opted_out_whatsapp === true,
    last_text: stringOrNull(conversation.last_text),
    last_direction: stringOrNull(conversation.last_direction),
    contact_id: stringOrNull(conversation.contact_id),
    assigned_agent_id: stringOrNull(conversation.assigned_agent_id),
    woztell_member_id: stringOrNull(conversation.woztell_member_id),
    messages: messages.map((message) => ({
      id: stringOrEmpty(message.id),
      direction: stringOrEmpty(message.direction) as "inbound" | "outbound",
      message_type: stringOrEmpty(message.message_type),
      text: stringOrNull(message.text),
      status: stringOrEmpty(message.status),
      error: stringOrNull(message.error),
      created_at: rowDate(message.created_at),
    })),
  };
}

export async function updateAdminConversation(
  input: AdminConversationUpdateInput,
  actor: StaffAccess,
) {
  const rows = await queryRows(
    "UPDATE whatsapp_conversations SET status = $1, assigned_agent_id = $2, updated_at = now() WHERE id = $3 RETURNING id",
    [input.status, input.assigned_agent_id, input.id],
  );
  if (!rows[0]) return { ok: false, error: "Not found" };
  await writeAudit(actor.staffId, "conversation.update", "conversation", input.id, {
    status: input.status,
    assigned_agent_id: input.assigned_agent_id,
  });
  return { ok: true };
}

export async function listAdminCampaigns() {
  const rows = await queryRows(
    `
    SELECT
      c.id,
      c.name,
      c.status,
      c.scheduled_at,
      c.created_at,
      c.template_id,
      c.audience_id,
      t.element_name,
      t.language_code,
      t.status AS template_status,
      a.name AS audience_name,
      count(r.id)::int AS recipients
    FROM whatsapp_campaigns c
    LEFT JOIN whatsapp_templates t ON t.id = c.template_id
    LEFT JOIN whatsapp_audiences a ON a.id = c.audience_id
    LEFT JOIN whatsapp_campaign_recipients r ON r.campaign_id = c.id
    GROUP BY c.id, t.element_name, t.language_code, t.status, a.name
    ORDER BY c.updated_at DESC, c.created_at DESC
    LIMIT 100
    `,
  );
  return rows;
}

export async function fetchAdminBlastOptions() {
  const [templates, audiences] = await Promise.all([
    queryRows(
      "SELECT id, element_name, language_code, status FROM whatsapp_templates ORDER BY element_name ASC",
    ),
    queryRows(
      "SELECT id, name, description FROM whatsapp_audiences ORDER BY name ASC, created_at DESC",
    ),
  ]);
  return {
    templates: templates.map((row) => ({
      id: stringOrEmpty(row.id),
      element_name: stringOrEmpty(row.element_name),
      language_code: stringOrEmpty(row.language_code),
      status: stringOrEmpty(row.status),
    })),
    audiences: audiences.map((row) => ({
      id: stringOrEmpty(row.id),
      name: stringOrEmpty(row.name),
      description: stringOrNull(row.description),
    })),
  };
}

export async function saveAdminAudience(input: AdminAudienceInput, actor: StaffAccess) {
  requireNonEmpty(input.name, "name");
  const filters = normalizeAudienceFilters(input.filters);
  const params = [input.name, input.description, JSON.stringify(filters)];

  const rows = input.id
    ? await queryRows(
        `UPDATE whatsapp_audiences SET name=$1, description=$2, filters=$3::jsonb, updated_at=now()
         WHERE id=$4 RETURNING id`,
        [...params, input.id],
      )
    : await queryRows(
        `INSERT INTO whatsapp_audiences (name, description, filters, created_by)
         VALUES ($1,$2,$3::jsonb,$4)
         RETURNING id`,
        [...params, actor.staffId],
      );

  if (input.id && !rows[0]) return { id: "", error: "Not found" };
  const id = stringOrEmpty(rows[0]?.id);
  await writeAudit(actor.staffId, input.id ? "audience.update" : "audience.create", "audience", id);
  return { id };
}

export async function previewAdminAudience(input: {
  audience_id?: string;
  filters?: AudienceFilters;
}): Promise<AdminAudiencePreview> {
  const filters = await resolveAudienceFilters(input);
  const rows = await fetchAudienceRecipientRows(filters);
  return summarizeAudienceRows(rows);
}

export async function saveAdminCampaign(input: AdminCampaignInput, actor: StaffAccess) {
  requireNonEmpty(input.name, "name");
  const params = [
    input.name,
    input.template_id,
    input.audience_id,
    input.status,
    input.scheduled_at,
  ];

  const rows = input.id
    ? await queryRows(
        `UPDATE whatsapp_campaigns SET name=$1, template_id=$2, audience_id=$3,
          status=$4::whatsapp_campaign_status, scheduled_at=$5, updated_at=now()
         WHERE id=$6 RETURNING id`,
        [...params, input.id],
      )
    : await queryRows(
        `INSERT INTO whatsapp_campaigns (name, template_id, audience_id, status, scheduled_at, created_by)
         VALUES ($1,$2,$3,$4::whatsapp_campaign_status,$5,$6)
         RETURNING id`,
        [...params, actor.staffId],
      );

  if (input.id && !rows[0]) return { id: "", error: "Not found" };
  const id = stringOrEmpty(rows[0]?.id);
  await writeAudit(actor.staffId, input.id ? "campaign.update" : "campaign.create", "campaign", id);
  return { id };
}

export async function materializeCampaignRecipients(campaignId: string, actor: StaffAccess) {
  const validation = await validateAdminCampaignQueueability(campaignId);
  if (!validation.ok) return validation;

  const campaigns = await queryRows(
    `
    SELECT c.id, a.filters
    FROM whatsapp_campaigns c
    LEFT JOIN whatsapp_audiences a ON a.id = c.audience_id
    WHERE c.id = $1
    LIMIT 1
    `,
    [campaignId],
  );
  const campaign = campaigns[0];
  if (!campaign) return { ok: false, error: "Campaign not found" };

  const filters = parseAudienceFilters(campaign.filters);
  const rows = await fetchAudienceRecipientRows(filters);
  const eligibleContactIds = rows
    .filter(isEligibleAudienceRow)
    .map((row) => stringOrEmpty(row.id))
    .filter(Boolean);
  const uniqueEligibleContactIds = Array.from(new Set(eligibleContactIds));

  if (uniqueEligibleContactIds.length > 0) {
    await queryRows(
      `
      INSERT INTO whatsapp_campaign_recipients (campaign_id, contact_id, status)
      SELECT $1::uuid, contact_id, 'queued'
      FROM unnest($2::uuid[]) AS contact_ids(contact_id)
      ON CONFLICT (campaign_id, contact_id) DO UPDATE SET
        status = CASE
          WHEN whatsapp_campaign_recipients.status IN ('sent', 'sending') THEN whatsapp_campaign_recipients.status
          ELSE EXCLUDED.status
        END,
        error = CASE
          WHEN whatsapp_campaign_recipients.status IN ('sent', 'sending') THEN whatsapp_campaign_recipients.error
          ELSE NULL
        END
      `,
      [campaignId, uniqueEligibleContactIds],
    );
  }
  await queryRows(
    `
    UPDATE whatsapp_campaign_recipients r
    SET status = 'blocked', error = 'No longer eligible for audience'
    WHERE r.campaign_id = $1
      AND r.status = 'queued'
      AND r.contact_id <> ALL($2::uuid[])
    `,
    [campaignId, uniqueEligibleContactIds],
  );

  const summary = summarizeAudienceRows(rows);
  await writeAudit(actor.staffId, "campaign.recipients", "campaign", campaignId, summary);
  return { ok: true, ...summary };
}

export async function validateAdminCampaignQueueability(id: string) {
  const rows = await queryRows(
    `
    SELECT
      c.id,
      c.status,
      t.status AS template_status
    FROM whatsapp_campaigns c
    LEFT JOIN whatsapp_templates t ON t.id = c.template_id
    WHERE c.id = $1
    LIMIT 1
    `,
    [id],
  );
  const row = rows[0];
  if (!row) return { ok: false, error: "Campaign not found" };

  const check = canPrepareAdminCampaignQueue({
    campaignStatus: stringOrEmpty(row.status),
    templateStatus: stringOrNull(row.template_status),
  });
  if (!check.ok) return { ok: false, error: check.reason };
  return { ok: true };
}

export async function sendAdminCampaignQueue(id: string, actor: StaffAccess) {
  const validation = await validateAdminCampaignQueueability(id);
  if (!validation.ok) return validation;

  const materialization = await materializeCampaignRecipients(id, actor);
  if (!materialization.ok) return { ok: false, error: materialization.error, materialization };

  const result = await queueAdminCampaign(id, actor);
  return { ...result, materialization };
}

export async function queueAdminCampaign(id: string, actor: StaffAccess) {
  const rows = await queryRows(
    `
    SELECT
      c.id,
      c.status,
      t.status AS template_status,
      count(r.id) FILTER (
        WHERE NULLIF(contact.normalized_phone, '') IS NOT NULL
          AND contact.opt_in_whatsapp = true
          AND contact.opted_out_whatsapp = false
      )::int AS eligible_recipients
    FROM whatsapp_campaigns c
    LEFT JOIN whatsapp_templates t ON t.id = c.template_id
    LEFT JOIN whatsapp_campaign_recipients r ON r.campaign_id = c.id AND r.status = 'queued'
    LEFT JOIN crm_contacts contact ON contact.id = r.contact_id
    WHERE c.id = $1
    GROUP BY c.id, t.status
    LIMIT 1
    `,
    [id],
  );
  const row = rows[0];
  if (!row) return { ok: false, error: "Campaign not found" };

  const check = canQueueAdminCampaign({
    campaignStatus: stringOrEmpty(row.status),
    templateStatus: stringOrNull(row.template_status),
    eligibleRecipients: Number(row.eligible_recipients ?? 0),
  });
  if (!check.ok) return { ok: false, error: check.reason };

  await queryRows(
    "UPDATE whatsapp_campaigns SET status = 'queued', reviewed_by = $1, reviewed_at = now(), updated_at = now() WHERE id = $2",
    [actor.staffId, id],
  );
  await queryRows(
    "UPDATE whatsapp_campaign_recipients SET queued_at = COALESCE(queued_at, now()) WHERE campaign_id = $1 AND status = 'queued'",
    [id],
  );
  await writeAudit(actor.staffId, "campaign.queue", "campaign", id, {
    eligibleRecipients: Number(row.eligible_recipients ?? 0),
  });
  return { ok: true };
}

export async function cancelAdminCampaign(id: string, actor: StaffAccess) {
  const rows = await queryRows(
    "UPDATE whatsapp_campaigns SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING id",
    [id],
  );
  if (!rows[0]) return { ok: false, error: "Not found" };
  await queryRows(
    "UPDATE whatsapp_campaign_recipients SET status = 'cancelled' WHERE campaign_id = $1 AND status = 'queued'",
    [id],
  );
  await writeAudit(actor.staffId, "campaign.cancel", "campaign", id);
  return { ok: true };
}

export async function createWebsiteInquiry(input: {
  property_id: string;
  assigned_agent_id: string | null;
  name: string;
  phone: string;
  email: string | null;
  message: string | null;
}) {
  const normalizedPhone = normalizeAdminPhone(input.phone);
  const contacts = await queryRows(
    `
    INSERT INTO crm_contacts (name, phone, normalized_phone, email, source, opt_in_whatsapp)
    VALUES ($1, $2, $3, $4, 'website', true)
    ON CONFLICT (normalized_phone) DO UPDATE SET
      name = COALESCE(EXCLUDED.name, crm_contacts.name),
      email = COALESCE(EXCLUDED.email, crm_contacts.email),
      updated_at = now()
    RETURNING id
    `,
    [input.name, input.phone, normalizedPhone, input.email],
  );
  const contactId = stringOrEmpty(contacts[0]?.id);
  const inquiries = await queryRows(
    `
    INSERT INTO inquiries (source, property_id, name, phone, email, message, assigned_agent_id, crm_contact_id)
    VALUES ('website', $1, $2, $3, $4, $5, $6, $7)
    RETURNING id
    `,
    [
      input.property_id,
      input.name,
      input.phone,
      input.email,
      input.message,
      input.assigned_agent_id,
      contactId,
    ],
  );
  await queryRows(
    `
    INSERT INTO crm_leads (contact_id, property_id, assigned_agent_id, stage, intent, source, note)
    VALUES ($1, $2, $3, 'new', 'buyer', 'website', $4)
    `,
    [contactId, input.property_id, input.assigned_agent_id, input.message],
  );
  return { id: stringOrEmpty(inquiries[0]?.id) };
}

export async function updateInquiryStatus(id: string, status: string, actor: StaffAccess) {
  await queryRows("UPDATE inquiries SET status = $1, updated_at = now() WHERE id = $2", [
    status,
    id,
  ]);
  await writeAudit(actor.staffId, "inquiry.status", "inquiry", id, { status });
  return { ok: true };
}

export async function queueCampaign(id: string, actor: StaffAccess) {
  return queueAdminCampaign(id, actor);
}

export async function writeAudit(
  actorId: string | null,
  action: string,
  subjectType?: string,
  subjectId?: string,
  metadata: Record<string, unknown> = {},
) {
  const params: unknown[] = [
    actorId,
    action,
    subjectType ?? null,
    subjectId ?? null,
    JSON.stringify(metadata),
  ];
  await queryRows(
    `
    INSERT INTO audit_logs (actor_id, action, subject_type, subject_id, metadata)
    VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    params,
  );
}
