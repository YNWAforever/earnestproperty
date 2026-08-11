import "@tanstack/react-start/server-only";

import {
  addParam,
  booleanOrFalse,
  dateOrNull,
  getSql,
  numberOrNull,
  queryRows,
  stringOrEmpty,
  stringOrNull,
} from "./db.server";
import { isMissingCmsVideosTableError } from "./cms-videos-schema";
import type { StaffAccess } from "./auth.server";
import {
  decideAgentProfileMutation,
  type AgentProfileIdentityInput,
  type AgentProfileMutationDecision,
  type AgentProfileSecurityTarget,
} from "./staff-security-policy";
import type {
  AdminAgentProfileInput,
  AdminAgentProfileMutationInput,
  AdminAgentProfileRow,
  AdminLeadAiProfile,
  AdminArticleInput,
  AdminCmsVideoInput,
  AdminAudienceInput,
  AdminCampaignInput,
  AdminCampaignRow,
  AdminConversationAiAssist,
  AdminConversationRow,
  AdminConversationUpdateInput,
  AdminEstateInput,
  AdminFaqInput,
  AdminLeadActivityInput,
  AdminLeadRow,
  AdminLeadUpdateInput,
  AdminListingFiltersInput,
  AdminAudiencePreview,
  AdminAiKnowledgeRebuildResult,
  AdminAiKnowledgeStatus,
  AdminCrmSegmentPreview,
  AdminCrmSegmentRow,
  CommandCenterData,
  CommandCenterKpis,
  CommandCenterRow,
  StaffAccessRole,
  StaffAccessSummary,
  StaffOwnedCounts,
} from "./admin-data.types";
import { getAiServerConfig } from "../ai/config.server.ts";
import { analyzeCrmLead, approveCrmAiTag, fetchCrmAiProfile } from "../ai/crm-enrichment.server.ts";
import { rebuildAiKnowledgeIndex } from "../ai/knowledge.server.ts";
import type { CrmSegmentFilters } from "../ai/ai-types";
import { isYouTubeVideoUrl } from "../youtube-video-url.js";
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
import {
  COMMAND_CENTER_ROW_LIMIT,
  HANDOFF_RECENT_HOURS,
  WHATSAPP_ACTIVE_HOURS,
  compareCommandCenterRows,
  computeLeadPriority,
  resolveWhatsappStatus,
} from "./command-center";
import { persistWebsiteInquiry } from "./website-inquiry.js";
import { woztellEnabled } from "../woztell/woztell.server";

/**
 * Row-ownership scope for the acting staff member.
 *
 * The Supabase -> Neon migration dropped the RLS policies that scoped agents to
 * their own rows (auth.uid() = agent_id / assigned_agent_id). This helper
 * restores that boundary in application code: admins and managers get
 * unrestricted access (null), while a plain agent is restricted to rows they
 * own. `properties.agent_id` and `crm_leads.assigned_agent_id` both reference
 * `staff_users.id`, which is `actor.staffId`.
 */
/** Upper bound on one bulk lead mutation. Keeps a mis-click or a runaway client
 * from rewriting the entire CRM in a single statement. */
export const BULK_LEAD_UPDATE_LIMIT = 200;

/**
 * The row-visibility scope for an actor: null means "all rows" (admin/manager),
 * otherwise the agent's own staff id. Exported because API routes outside this
 * module enforce the same scoping -- see api.admin.woztell.send.ts, which sends
 * real WhatsApp messages and must not let an agent act on another agent's
 * conversation. Keep one definition; a second copy is how they drift apart.
 */
export function agentScope(actor: StaffAccess): string | null {
  if (actor.roles.includes("admin") || actor.roles.includes("manager")) return null;
  return actor.roles.includes("agent") ? actor.staffId : null;
}

/**
 * Roles, active flag and per-table owned counts for one staff member.
 *
 * `isLastAdmin` is computed here rather than on the client: it decides whether
 * a privilege change is allowed, so it must come from the database at decision
 * time.
 */
export async function fetchStaffAccessSummary(
  input: { staffId: string },
  actor: StaffAccess,
): Promise<StaffAccessSummary> {
  const { STAFF_OWNERSHIP_COLUMNS, staffOwnershipCountSql } = await import("./staff-ownership");

  const { isProtectedStaffEmail } = await import("./auth.server");

  const roleRows = await queryRows(
    `SELECT s.active,
            s.email,
            COALESCE(
              array_to_json(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL)),
              '[]'::json
            ) AS roles,
            (
              SELECT count(*)::int
              FROM staff_roles other
              JOIN staff_users os ON os.id = other.staff_user_id
              WHERE other.role = 'admin'
                AND other.staff_user_id <> $1::uuid
                AND os.active = true
            ) AS other_admin_count
       FROM staff_users s
       LEFT JOIN staff_roles r ON r.staff_user_id = s.id
      WHERE s.id = $1::uuid
      GROUP BY s.id`,
    [input.staffId],
  );
  const row = roleRows[0];
  if (!row) throw new Response("Staff member not found.", { status: 404 });

  const roles = (Array.isArray(row.roles) ? row.roles : []).map(String) as StaffAccessRole[];
  const otherAdminCount = Number(row.other_admin_count ?? 0);

  const count = staffOwnershipCountSql(input.staffId);
  const countRows = await queryRows(count.statement, count.params);
  const countRow = countRows[0] ?? {};
  const owned = Object.fromEntries(
    STAFF_OWNERSHIP_COLUMNS.map(({ table }) => [table, Number(countRow[table] ?? 0)]),
  ) as StaffOwnedCounts;

  return {
    staffId: input.staffId,
    roles,
    active: row.active === true,
    isSelf: actor.staffId === input.staffId,
    isLastAdmin: roles.includes("admin") && otherAdminCount < 1,
    isProtected: isProtectedStaffEmail(stringOrNull(row.email)),
    owned,
    ownedTotal: Object.values(owned).reduce((total, value) => total + value, 0),
  };
}

function normalizeAgentPublicSlug(value: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("Public slug must contain letters or numbers.");
  return slug;
}

function agentProfileSlugConflictError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const dbError = error as { code?: unknown; constraint?: unknown };
  return (
    String(dbError.code ?? "") === "23505" &&
    String(dbError.constraint ?? "") === "staff_users_public_slug_unique"
  );
}

function assertAgentProfileEditor(actor: StaffAccess) {
  if (actor.roles.includes("admin") || actor.roles.includes("manager")) return;
  throw new Response("Forbidden", { status: 403 });
}

async function fetchAgentProfileSecurityTarget(
  id: string,
): Promise<AgentProfileSecurityTarget | null> {
  const rows = await queryRows(
    `
    SELECT
      s.auth_user_id,
      s.email,
      s.active,
      COALESCE(array_to_json(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL)), '[]'::json) AS roles
    FROM staff_users s
    LEFT JOIN staff_roles r ON r.staff_user_id = s.id
    WHERE s.id = $1
    GROUP BY s.id
    LIMIT 1
    `,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    authUserId: stringOrNull(row.auth_user_id),
    email: stringOrNull(row.email),
    active: row.active === true,
    roles: Array.isArray(row.roles) ? row.roles.map(String) : [],
  };
}

async function agentProfileMutationDecision(
  input: AdminAgentProfileMutationInput,
  actor: StaffAccess,
): Promise<{
  decision: Extract<AgentProfileMutationDecision, { allowed: true }>;
  identity: AgentProfileIdentityInput;
} | null> {
  assertAgentProfileEditor(actor);
  const target = input.id ? await fetchAgentProfileSecurityTarget(input.id) : null;
  if (input.id && !target) return null;
  const hasOwn = (key: "auth_user_id" | "email" | "active") =>
    Object.prototype.hasOwnProperty.call(input, key);
  const identity: AgentProfileIdentityInput = {
    auth_user_id: hasOwn("auth_user_id")
      ? (input.auth_user_id ?? null)
      : (target?.authUserId ?? null),
    email: hasOwn("email") ? (input.email ?? null) : (target?.email ?? null),
    active: hasOwn("active") ? input.active === true : (target?.active ?? true),
  };
  const decision = decideAgentProfileMutation(actor.roles, identity, target);
  if (!decision.allowed) throw new Response("Forbidden", { status: 403 });
  return { decision, identity };
}

function nullableTrim(value: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function mapAdminAgentProfile(row: Record<string, unknown>): AdminAgentProfileRow {
  return {
    id: stringOrEmpty(row.id),
    auth_user_id: stringOrNull(row.auth_user_id),
    email: stringOrNull(row.email),
    name_zh: stringOrNull(row.name_zh),
    name_en: stringOrNull(row.name_en),
    job_title: stringOrNull(row.job_title),
    phone: stringOrNull(row.phone),
    whatsapp: stringOrNull(row.whatsapp),
    licence_no: stringOrNull(row.licence_no),
    avatar_url: stringOrNull(row.avatar_url),
    branch: stringOrNull(row.branch),
    bio: stringOrNull(row.bio),
    specialties: Array.isArray(row.specialties) ? row.specialties.map(String) : [],
    served_estate_slugs: Array.isArray(row.served_estate_slugs)
      ? row.served_estate_slugs.map(String)
      : [],
    public_slug: stringOrNull(row.public_slug),
    show_on_website: row.show_on_website === true,
    display_order: numberOrNull(row.display_order) ?? 0,
    active: row.active === true,
    created_at: dateOrNull(row.created_at),
    updated_at: dateOrNull(row.updated_at),
  };
}

export type AdminPropertyInput = {
  id?: string;
  listing_no: string;
  title_zh: string;
  title_en: string | null;
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
  features: string[];
  status: "draft" | "active" | "sold" | "rented" | "offline";
  featured: boolean;
  images: string[];
  agent_id: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  video_url?: string | null;
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

export async function listAdminListings(input: AdminListingInput = {}, actor?: StaffAccess) {
  const params: unknown[] = [];
  const where: string[] = [];

  const scope = actor ? agentScope(actor) : null;
  if (scope !== null) {
    where.push(`p.agent_id = ${addParam(params, scope)}::uuid`);
  }

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

/** `SELECT *` on `properties`, as the edit form consumes it. */
export type AdminPropertyRecord = Partial<AdminPropertyInput> & { id: string };

// The four list/get helpers below declare their row types rather than leaking
// `DbRow` (= Record<string, unknown>). TanStack Start rejects `unknown` values
// in a server function's return type -- it cannot prove them serializable -- and
// every call site was casting to these exact types anyway, so the cast was
// hiding the contract instead of expressing it.
export async function getAdminProperty(
  id: string,
  actor?: StaffAccess,
): Promise<AdminPropertyRecord | null> {
  // listAdminListings, saveAdminProperty and updateAdminPropertyStatus all
  // restrict agents to p.agent_id = actor.staffId, and saveAdminProperty throws
  // 403 for an out-of-scope edit. This single-row read took no actor at all, so
  // an agent could SELECT * any listing -- including drafts and internal columns
  // the scoped list view withholds -- by supplying its UUID.
  const scope = actor ? agentScope(actor) : null;
  const rows = await queryRows<AdminPropertyRecord>(
    `SELECT * FROM properties WHERE id = $1${scope !== null ? " AND agent_id = $2" : ""} LIMIT 1`,
    scope !== null ? [id, scope] : [id],
  );
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
  const scope = agentScope(actor);
  // Scoped agents may only ever own their own rows: ignore any caller-supplied
  // agent_id on insert and force themselves as the owner.
  const agentId = scope !== null ? actor.staffId : (input.agent_id ?? null);
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
    input.video_url ?? null,
    agentId,
    input.title_en ?? null,
    input.features ?? [],
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
          video_url = $19,
          agent_id = $20,
          title_en = $21,
          features = $22::text[],
          updated_at = now()
        WHERE id = $23${scope !== null ? " AND agent_id = $24" : ""}
        RETURNING id
        `,
        scope !== null ? [...params, input.id, scope] : [...params, input.id],
      )
    : await queryRows(
        `
        INSERT INTO properties (
          listing_no, title_zh, deal_type, estate_id, district_slug, address, price, rent,
          saleable_area, bedrooms, bathrooms, floor, description, status, featured, images,
          seo_title, seo_description, video_url, agent_id, title_en, features
        )
        VALUES ($1, $2, $3::deal_type, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::property_status, $15, $16::text[], $17, $18, $19, $20, $21, $22::text[])
        RETURNING id
        `,
        params,
      );

  if (input.id && !rows[0]) {
    if (scope !== null) throw new Response("Forbidden", { status: 403 });
    return { id: "", error: "Not found" };
  }
  const id = stringOrEmpty(rows[0]?.id);
  await writeAudit(actor.staffId, input.id ? "property.update" : "property.create", "property", id);
  return { id };
}

export async function updateAdminPropertyStatus(
  id: string,
  status: AdminPropertyInput["status"],
  actor: StaffAccess,
) {
  const scope = agentScope(actor);
  const rows = await queryRows(
    `UPDATE properties SET status = $1::property_status, updated_at = now() WHERE id = $2${
      scope !== null ? " AND agent_id = $3" : ""
    } RETURNING id`,
    scope !== null ? [status, id, scope] : [status, id],
  );
  if (!rows[0]) {
    if (scope !== null) throw new Response("Forbidden", { status: 403 });
    return { ok: false, error: "Not found" };
  }
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

export async function fetchAdminAgentProfiles(): Promise<AdminAgentProfileRow[]> {
  const rows = await queryRows(`
    SELECT
      s.id,
      s.auth_user_id,
      s.email,
      s.name_zh,
      s.name_en,
      s.job_title,
      s.phone,
      s.whatsapp,
      s.licence_no,
      s.avatar_url,
      s.branch,
      s.bio,
      s.specialties,
      s.served_estate_slugs,
      s.public_slug,
      s.show_on_website,
      s.display_order,
      s.active,
      s.created_at,
      s.updated_at
    FROM staff_users s
    ORDER BY s.display_order ASC, COALESCE(s.name_zh, s.name_en) ASC NULLS LAST, s.id ASC
  `);
  return rows.map(mapAdminAgentProfile);
}

export async function fetchAdminAgentProfile(id: string): Promise<AdminAgentProfileRow | null> {
  const rows = await queryRows(
    `
    SELECT
      s.id,
      s.auth_user_id,
      s.email,
      s.name_zh,
      s.name_en,
      s.job_title,
      s.phone,
      s.whatsapp,
      s.licence_no,
      s.avatar_url,
      s.branch,
      s.bio,
      s.specialties,
      s.served_estate_slugs,
      s.public_slug,
      s.show_on_website,
      s.display_order,
      s.active,
      s.created_at,
      s.updated_at
    FROM staff_users s
    WHERE s.id = $1
    LIMIT 1
    `,
    [id],
  );
  return rows[0] ? mapAdminAgentProfile(rows[0]) : null;
}

export async function saveAdminAgentProfile(
  input: AdminAgentProfileMutationInput,
  actor: StaffAccess,
) {
  const authorization = await agentProfileMutationDecision(input, actor);
  if (!authorization) return { id: "", error: "Not found" };
  const { decision, identity } = authorization;

  let publicSlug: string | null;
  try {
    publicSlug = normalizeAgentPublicSlug(input.public_slug);
  } catch (error) {
    return { id: "", error: error instanceof Error ? error.message : "Invalid public slug." };
  }

  // Resolved here rather than in SQL: the two branches below use different
  // positional-parameter offsets, so a subquery inline in the statements would be
  // one off-by-one away from writing a value into the wrong column.
  let displayOrder: number;
  if (Number.isInteger(input.display_order)) {
    displayOrder = input.display_order as number;
  } else if (input.id) {
    // Blank on an existing profile means "leave it alone".
    const [current] = await queryRows("SELECT display_order FROM staff_users WHERE id = $1", [
      input.id,
    ]);
    displayOrder = Number(current?.display_order ?? 0);
  } else {
    // Blank on a new profile means "append", so a new hire never displaces one of
    // the client-approved 23. The column is NOT NULL DEFAULT 0, so without this a
    // new agent ties with Kenneth Chang at the top of the roster.
    const [max] = await queryRows(
      "SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM staff_users",
    );
    displayOrder = Number(max?.next ?? 0);
  }
  const specialties = Array.isArray(input.specialties) ? input.specialties : [];
  const servedEstateSlugs = Array.isArray(input.served_estate_slugs)
    ? input.served_estate_slugs
    : [];
  const identityAndProfileParams = [
    nullableTrim(identity.auth_user_id),
    nullableTrim(identity.email),
    nullableTrim(input.name_zh),
    nullableTrim(input.name_en),
    nullableTrim(input.job_title),
    nullableTrim(input.phone),
    nullableTrim(input.whatsapp),
    nullableTrim(input.licence_no),
    nullableTrim(input.avatar_url),
    nullableTrim(input.branch),
    nullableTrim(input.bio),
    publicSlug,
    input.show_on_website === true,
    displayOrder,
    identity.active,
    specialties,
    servedEstateSlugs,
  ];
  // Appended after identity.active rather than inserted mid-array so the
  // existing .slice(2, 14) below (name_zh..display_order, excluding the
  // identity-only auth_user_id/email/active fields) keeps working unchanged;
  // both new fields are profile-level like job_title/bio, so they belong in
  // publicProfileParams too.
  const publicProfileParams = [
    ...identityAndProfileParams.slice(2, 14),
    specialties,
    servedEstateSlugs,
  ];

  try {
    let rows;
    if (decision.mode === "identity-and-profile") {
      rows = input.id
        ? await queryRows(
            `
          UPDATE staff_users SET
            auth_user_id = $1,
            email = $2,
            name_zh = $3,
            name_en = $4,
            job_title = $5,
            phone = $6,
            whatsapp = $7,
            licence_no = $8,
            avatar_url = $9,
            branch = $10,
            bio = $11,
            public_slug = $12,
            show_on_website = $13,
            display_order = $14,
            active = $15,
            specialties = $16::text[],
            served_estate_slugs = $17::text[],
            updated_at = now()
          WHERE id = $18
          RETURNING id
          `,
            [...identityAndProfileParams, input.id],
          )
        : await queryRows(
            `
          INSERT INTO staff_users (
            auth_user_id, email, name_zh, name_en, job_title, phone, whatsapp, licence_no,
            avatar_url, branch, bio, public_slug, show_on_website, display_order, active,
            specialties, served_estate_slugs
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
            $16::text[], $17::text[]
          )
          RETURNING id
          `,
            identityAndProfileParams,
          );
    } else {
      rows = input.id
        ? await queryRows(
            `
            UPDATE staff_users AS target SET
              name_zh = $1,
              name_en = $2,
              job_title = $3,
              phone = $4,
              whatsapp = $5,
              licence_no = $6,
              avatar_url = $7,
              branch = $8,
              bio = $9,
              public_slug = $10,
              show_on_website = $11,
              display_order = $12,
              specialties = $13::text[],
              served_estate_slugs = $14::text[],
              updated_at = now()
            WHERE target.id = $15
              AND NOT EXISTS (
                SELECT 1
                FROM staff_roles privileged_role
                WHERE privileged_role.staff_user_id = target.id
                  AND privileged_role.role = 'admin'
              )
            RETURNING target.id
            `,
            [...publicProfileParams, input.id],
          )
        : await queryRows(
            `
            INSERT INTO staff_users (
              name_zh, name_en, job_title, phone, whatsapp, licence_no,
              avatar_url, branch, bio, public_slug, show_on_website, display_order,
              specialties, served_estate_slugs
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text[], $14::text[])
            RETURNING id
            `,
            publicProfileParams,
          );
    }

    if (input.id && !rows[0]) return { id: "", error: "Not found" };
    const id = stringOrEmpty(rows[0]?.id);
    await writeAudit(
      actor.staffId,
      input.id ? "agent-profile.update" : "agent-profile.create",
      "staff_user",
      id,
    );
    return { id };
  } catch (error) {
    if (agentProfileSlugConflictError(error)) {
      return { id: "", error: "An agent already uses this public slug." };
    }
    throw error;
  }
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

export async function fetchAdminCmsVideos() {
  let rows;
  try {
    rows = await queryRows(
      `
    SELECT id, title, video_url, description, sort_order, published, created_at, updated_at
    FROM cms_videos
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
    published: booleanOrFalse(row.published),
    created_at: dateOrNull(row.created_at),
    updated_at: dateOrNull(row.updated_at),
  }));
}

export async function saveAdminCmsVideo(input: AdminCmsVideoInput, actor: StaffAccess) {
  if (!isYouTubeVideoUrl(input.video_url)) {
    return { id: "", error: "請輸入有效 YouTube 連結" };
  }

  const params = [
    input.title,
    input.video_url,
    input.description,
    input.sort_order,
    input.published,
  ];

  let rows;
  try {
    rows = input.id
      ? await queryRows(
          `
        UPDATE cms_videos SET
          title = $1,
          video_url = $2,
          description = $3,
          sort_order = $4,
          published = $5,
          updated_at = now()
        WHERE id = $6
        RETURNING id
        `,
          [...params, input.id],
        )
      : await queryRows(
          `
        INSERT INTO cms_videos (title, video_url, description, sort_order, published)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        `,
          params,
        );
  } catch (error) {
    if (isMissingCmsVideosTableError(error)) {
      return { id: "", error: "影片資料表尚未建立，請先執行資料庫 migration" };
    }
    throw error;
  }

  if (input.id && !rows[0]) return { id: "", error: "Not found" };
  const id = stringOrEmpty(rows[0]?.id);
  await writeAudit(
    actor.staffId,
    input.id ? "cms_video.update" : "cms_video.create",
    "cms_video",
    id,
  );
  return { id };
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
    : input.upsert
      ? await queryRows(
          `INSERT INTO faqs (scope, question, answer, sort_order)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (scope, question) DO UPDATE
           SET answer = EXCLUDED.answer
         RETURNING id, (xmax = 0) AS inserted`,
          [input.scope, input.question, input.answer, input.sort_order],
        )
      : // The single-FAQ form must not silently replace a different row's answer
        // and report it as a create. DO NOTHING returns no row on conflict, which
        // becomes a refusal below.
        await queryRows(
          `INSERT INTO faqs (scope, question, answer, sort_order)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (scope, question) DO NOTHING
         RETURNING id, true AS inserted`,
          [input.scope, input.question, input.answer, input.sort_order],
        );

  if (input.id && !rows[0]) return { id: "", error: "Not found" };
  if (!input.id && !rows[0]) return { id: "", error: "此範圍已有相同問題，請改用編輯。" };
  const id = stringOrEmpty(rows[0]?.id);
  // An upsert that resolved to an update is a faq.update, not a faq.create --
  // the audit trail should say what actually happened to the row.
  const inserted = input.id ? false : rows[0]?.inserted !== false;
  await writeAudit(actor.staffId, inserted ? "faq.create" : "faq.update", "faq", id);
  return { id, inserted };
}

export async function deleteAdminFaq(id: string, actor: StaffAccess) {
  const rows = await queryRows("DELETE FROM faqs WHERE id = $1 RETURNING id", [id]);
  if (!rows[0]) return { ok: false, error: "Not found" };
  await writeAudit(actor.staffId, "faq.delete", "faq", id);
  return { ok: true };
}

/** Which of the supplied (scope, question) pairs already exist.
 *
 * The import preview used to diff against `listAdminCms()`'s FAQ page, which is
 * capped at 120 rows. On a site with more FAQs than that -- exactly the site
 * that needs bulk import -- every unloaded question showed as 新增 and the
 * confirm asserted 「全部為新增，不會覆寫現有 FAQ。」 while the write path's
 * ON CONFLICT DO UPDATE overwrote live answers in place. The diff has to be
 * resolved against the whole table, so it belongs here. */
export async function checkAdminFaqConflicts(
  keys: Array<{ scope: string; question: string }>,
  _actor: StaffAccess,
) {
  if (!keys.length) return { existing: [] as Array<{ scope: string; question: string }> };

  const scopes = keys.map((key) => key.scope);
  const questions = keys.map((key) => key.question);
  const rows = await queryRows(
    `SELECT scope, question
     FROM faqs
     WHERE (scope, question) IN (
       SELECT UNNEST($1::text[]), UNNEST($2::text[])
     )`,
    [scopes, questions],
  );

  return {
    existing: rows.map((row) => ({
      scope: stringOrEmpty(row.scope),
      question: stringOrEmpty(row.question),
    })),
  };
}

export async function reorderAdminFaqs(orderedIds: string[], actor: StaffAccess) {
  // NOTE: the faqs table has no updated_at column in this schema, so the
  // batched UPDATE only sets sort_order (matching the previous per-row loop).
  await queryRows(
    `
    UPDATE faqs SET sort_order = d.ord
    FROM (
      SELECT id, ordinality AS ord
      FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ordinality)
    ) AS d
    WHERE faqs.id = d.id
    `,
    [orderedIds],
  );
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

export async function listAdminLeads(actor?: StaffAccess): Promise<AdminLeadRow[]> {
  const scope = actor ? agentScope(actor) : null;
  const params: unknown[] = [];
  const where =
    scope !== null ? `WHERE l.assigned_agent_id = ${addParam(params, scope)}::uuid` : "";
  const rows = await queryRows<AdminLeadRow>(
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
    ${where}
    ORDER BY l.updated_at DESC, l.created_at DESC
    LIMIT 100
    `,
    params,
  );
  return rows;
}

export async function fetchAdminLead(id: string, actor?: StaffAccess) {
  const scope = actor ? agentScope(actor) : null;
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
    WHERE l.id = $1${scope !== null ? " AND l.assigned_agent_id = $2" : ""}
    LIMIT 1
    `,
    scope !== null ? [id, scope] : [id],
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

/**
 * Throw 403 unless the actor may act on this lead.
 *
 * fetchAdminLead and updateAdminLead have always scoped agents to their own
 * rows, but the AI surface around them did not: it took a lead id straight from
 * the client and never joined back to assigned_agent_id. An agent who kept a
 * UUID after reassignment (or read one off a crm_ai_tags id) could pull another
 * agent's enriched profile, overwrite it, and burn a paid LLM call doing it.
 *
 * Null scope means admin/manager, who legitimately see every lead.
 */
async function assertLeadInScope(leadId: string, actor: StaffAccess) {
  const scope = agentScope(actor);
  if (scope === null) return;
  const rows = await queryRows(
    `SELECT 1 FROM crm_leads WHERE id = $1::uuid AND assigned_agent_id = $2::uuid LIMIT 1`,
    [leadId, scope],
  );
  if (!rows[0]) throw new Response("Forbidden", { status: 403 });
}

/** Same, reached through the tag's owning lead. */
async function assertAiTagInScope(tagId: string, actor: StaffAccess) {
  const scope = agentScope(actor);
  if (scope === null) return;
  const rows = await queryRows(
    `SELECT 1
       FROM crm_ai_tags t
       JOIN crm_leads l ON l.id = t.lead_id
      WHERE t.id = $1::uuid AND l.assigned_agent_id = $2::uuid
      LIMIT 1`,
    [tagId, scope],
  );
  if (!rows[0]) throw new Response("Forbidden", { status: 403 });
}

export async function fetchAdminLeadAiProfile(
  input: { leadId: string },
  actor: StaffAccess,
): Promise<AdminLeadAiProfile> {
  await assertLeadInScope(input.leadId, actor);
  return fetchCrmAiProfile({ leadId: input.leadId });
}

export async function analyzeAdminLeadAiProfile(
  input: { leadId: string },
  actor: StaffAccess,
): Promise<AdminLeadAiProfile> {
  await assertLeadInScope(input.leadId, actor);
  const result = await analyzeCrmLead(input.leadId);
  await writeAudit(actor.staffId, "ai.lead.analyze", "lead", input.leadId);
  return result;
}

export async function approveAdminAiTag(input: { tagId: string }, actor: StaffAccess) {
  await assertAiTagInScope(input.tagId, actor);
  const result = await approveCrmAiTag({
    tagId: input.tagId,
    staffId: actor.staffId,
    approve: true,
  });
  await writeAudit(actor.staffId, "ai.tag.approve", "ai_tag", input.tagId);
  return result;
}

export async function rejectAdminAiTag(input: { tagId: string }, actor: StaffAccess) {
  await assertAiTagInScope(input.tagId, actor);
  const result = await approveCrmAiTag({
    tagId: input.tagId,
    staffId: actor.staffId,
    approve: false,
  });
  await writeAudit(actor.staffId, "ai.tag.reject", "ai_tag", input.tagId);
  return result;
}

export async function updateAdminLead(input: AdminLeadUpdateInput, actor: StaffAccess) {
  const scope = agentScope(actor);
  const params: unknown[] = [
    input.stage,
    input.intent,
    input.budget_min,
    input.budget_max,
    input.preferred_estates,
    input.assigned_agent_id,
    input.note,
    input.id,
  ];
  if (scope !== null) params.push(scope);
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
     WHERE id = $8${scope !== null ? " AND assigned_agent_id = $9" : ""}
     RETURNING id`,
    params,
  );
  if (!rows[0]) {
    if (scope !== null) throw new Response("Forbidden", { status: 403 });
    return { ok: false, error: "Not found" };
  }
  await writeAudit(actor.staffId, "lead.update", "lead", input.id, {
    stage: input.stage,
    intent: input.intent,
  });
  return { ok: true };
}

/** Re-stage or reassign many leads in one statement.
 *
 * The alternative the UI had was no bulk workflow at all: reassigning 30 leads
 * meant 30 open -> save -> refetch cycles, each re-fetching the whole list. A
 * client-side loop over updateAdminLead would not have fixed that -- it would
 * have moved the serial round-trips around and, because AdminLeadUpdateInput has
 * no partial-update path, each iteration would rewrite every field of a lead
 * from a draft the operator never opened.
 *
 * Only the fields explicitly supplied are written. `assigned_agent_id` is
 * nullable and null means "unassign", so presence is signalled by a separate
 * flag rather than by null-checking the value.
 *
 * Returns how many rows actually changed alongside how many were asked for, so
 * the caller can be honest when agent scoping silently excluded some.
 */
export async function bulkUpdateAdminLeads(
  input: {
    ids: string[];
    stage?: string;
    assigned_agent_id?: string | null;
    assignAgent?: boolean;
  },
  actor: StaffAccess,
) {
  const ids = Array.from(new Set(input.ids.filter((id) => typeof id === "string" && id.trim())));
  if (!ids.length) return { ok: false as const, error: "NO_LEADS_SELECTED" };
  if (ids.length > BULK_LEAD_UPDATE_LIMIT) {
    return { ok: false as const, error: "TOO_MANY_LEADS_SELECTED" };
  }

  const setStage = typeof input.stage === "string" && input.stage.length > 0;
  const setAgent = input.assignAgent === true;
  if (!setStage && !setAgent) return { ok: false as const, error: "NO_CHANGES_REQUESTED" };

  const scope = agentScope(actor);
  const params: unknown[] = [
    ids,
    setStage,
    setStage ? input.stage : null,
    setAgent,
    setAgent ? (input.assigned_agent_id ?? null) : null,
  ];
  if (scope !== null) params.push(scope);

  const rows = await queryRows<{ id: string }>(
    `UPDATE crm_leads SET
       stage = CASE WHEN $2::boolean THEN $3::crm_lead_stage ELSE stage END,
       assigned_agent_id = CASE WHEN $4::boolean THEN $5 ELSE assigned_agent_id END,
       updated_at = now()
     WHERE id = ANY($1::uuid[])${scope !== null ? " AND assigned_agent_id = $6" : ""}
     RETURNING id::text AS id`,
    params,
  );

  await writeAudit(actor.staffId, "lead.bulk_update", "lead", undefined, {
    requested: ids.length,
    updated: rows.length,
    ...(setStage ? { stage: input.stage } : {}),
    ...(setAgent ? { assigned_agent_id: input.assigned_agent_id ?? null } : {}),
  });

  return { ok: true as const, updated: rows.length, requested: ids.length };
}

export async function createAdminLeadActivity(input: AdminLeadActivityInput, actor: StaffAccess) {
  // Every sibling lead mutation scopes agents to their own rows; this one wrote
  // notes, calls and due-dated follow-ups against any lead_id the client sent.
  // The rows then surfaced in the real owner's timeline and in the Command
  // Center's overdue KPI.
  await assertLeadInScope(input.lead_id, actor);
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

export async function completeAdminLeadActivity(
  input: { activity_id: string; lead_id: string },
  actor: StaffAccess,
) {
  const rows = await queryRows(
    `UPDATE crm_activities SET completed_at = now()
     WHERE id = $1 AND completed_at IS NULL
     RETURNING id`,
    [input.activity_id],
  );
  if (!rows[0]) return { ok: false as const, error: "Not found or already complete" };
  await writeAudit(actor.staffId, "lead.activity.complete", "lead", input.lead_id, {
    activityId: input.activity_id,
  });
  return { ok: true as const };
}

export async function listCommandCenter(actor: StaffAccess): Promise<CommandCenterData> {
  void actor; // admin/manager only; agentScope(actor) is null, so no row scoping needed
  const enabled = woztellEnabled();
  const rows = await queryRows(
    `
    SELECT
      l.id AS lead_id,
      l.stage,
      l.intent,
      l.budget_min,
      l.budget_max,
      l.preferred_estates,
      l.assigned_agent_id,
      l.created_at,
      l.updated_at,
      c.id AS contact_id,
      c.name,
      c.phone,
      c.email,
      c.opt_in_whatsapp,
      c.opted_out_whatsapp,
      ap.lead_score,
      ap.urgency,
      ap.timeline,
      ap.budget_band,
      ap.summary,
      ap.next_best_action,
      ap.last_analyzed_at,
      COALESCE(sa.name_zh, sa.name_en) AS assigned_agent_name,
      fa.next_followup_due_at,
      la.last_activity_at,
      las.session_status AS handoff_status,
      las.session_created_at AS handoff_at,
      wc.id AS conversation_id,
      wc.status AS conversation_status,
      wc.last_inbound_at,
      wc.woztell_member_id,
      wc.channel_id,
      wm.direction AS last_direction
    FROM crm_leads l
    LEFT JOIN crm_contacts c ON c.id = l.contact_id
    LEFT JOIN staff_users sa ON sa.id = l.assigned_agent_id
    LEFT JOIN LATERAL (
      SELECT lead_score, urgency, timeline, budget_band, summary, next_best_action, last_analyzed_at
      FROM crm_ai_profiles
      WHERE lead_id = l.id
      ORDER BY updated_at DESC
      LIMIT 1
    ) ap ON true
    LEFT JOIN LATERAL (
      SELECT min(due_at) AS next_followup_due_at
      FROM crm_activities
      WHERE lead_id = l.id AND completed_at IS NULL AND due_at < now()
    ) fa ON true
    LEFT JOIN LATERAL (
      SELECT max(created_at) AS last_activity_at
      FROM crm_activities
      WHERE lead_id = l.id
    ) la ON true
    LEFT JOIN LATERAL (
      SELECT status AS session_status, created_at AS session_created_at
      FROM live_agent_sessions
      WHERE lead_id = l.id
      ORDER BY created_at DESC
      LIMIT 1
    ) las ON true
    LEFT JOIN LATERAL (
      SELECT id, status, last_inbound_at, woztell_member_id, channel_id
      FROM whatsapp_conversations
      WHERE contact_id = c.id
      ORDER BY last_message_at DESC NULLS LAST
      LIMIT 1
    ) wc ON true
    LEFT JOIN LATERAL (
      SELECT direction
      FROM whatsapp_messages
      WHERE conversation_id = wc.id
      ORDER BY created_at DESC
      LIMIT 1
    ) wm ON true
    ORDER BY l.updated_at DESC, l.created_at DESC
    LIMIT ${COMMAND_CENTER_ROW_LIMIT}
    `,
    [],
  );

  const now = new Date();
  const handoffWindowMs = HANDOFF_RECENT_HOURS * 60 * 60 * 1000;
  const whatsappWindowMs = WHATSAPP_ACTIVE_HOURS * 60 * 60 * 1000;

  const mapped = rows.map((row) => {
    const analyzed = row.last_analyzed_at != null;
    const leadScore = analyzed ? numberOrNull(row.lead_score) : null;
    const overdueDue = dateOrNull(row.next_followup_due_at);
    const lastActivity = dateOrNull(row.last_activity_at);
    const handoffAt = dateOrNull(row.handoff_at);
    const lastInbound = dateOrNull(row.last_inbound_at);

    const recentHandoff =
      (row.handoff_status === "handoff_requested" || row.handoff_status === "handoff_completed") &&
      handoffAt != null &&
      now.getTime() - new Date(handoffAt).getTime() <= handoffWindowMs;

    const activeWhatsapp =
      row.conversation_id != null &&
      lastInbound != null &&
      now.getTime() - new Date(lastInbound).getTime() <= whatsappWindowMs;

    const whatsapp = resolveWhatsappStatus({
      conversation: row.conversation_id
        ? {
            id: stringOrEmpty(row.conversation_id),
            status: stringOrEmpty(row.conversation_status),
            lastInboundAt: lastInbound,
            lastDirection:
              row.last_direction === "inbound" || row.last_direction === "outbound"
                ? row.last_direction
                : null,
            woztellMemberId: stringOrNull(row.woztell_member_id),
            channelId: stringOrNull(row.channel_id),
          }
        : null,
      phone: stringOrNull(row.phone),
      optInWhatsapp: row.opt_in_whatsapp === true,
      optedOutWhatsapp: row.opted_out_whatsapp === true,
      woztellEnabled: enabled,
      now,
    });

    const priority = computeLeadPriority({
      leadScore,
      analyzed,
      hasOverdueFollowup: overdueDue != null,
      recentHandoff,
      isUnassigned: row.assigned_agent_id == null,
      activeWhatsapp,
    });

    const mappedRow: CommandCenterRow = {
      lead_id: stringOrEmpty(row.lead_id),
      contact_id: stringOrNull(row.contact_id),
      name: stringOrNull(row.name),
      phone: stringOrNull(row.phone),
      email: stringOrNull(row.email),
      stage: stringOrEmpty(row.stage),
      intent: stringOrNull(row.intent),
      budget_min: numberOrNull(row.budget_min),
      budget_max: numberOrNull(row.budget_max),
      preferred_estates: Array.isArray(row.preferred_estates)
        ? row.preferred_estates.map(String)
        : [],
      assigned_agent_id: stringOrNull(row.assigned_agent_id),
      assigned_agent_name: stringOrNull(row.assigned_agent_name),
      lead_score: leadScore,
      urgency: stringOrNull(row.urgency),
      timeline: stringOrNull(row.timeline),
      budget_band: stringOrNull(row.budget_band),
      summary: stringOrNull(row.summary),
      next_best_action: stringOrNull(row.next_best_action),
      last_analyzed_at: dateOrNull(row.last_analyzed_at),
      has_overdue_followup: overdueDue != null,
      next_followup_due_at: overdueDue,
      last_activity_at: lastActivity,
      handoff_status: stringOrNull(row.handoff_status),
      handoff_at: handoffAt,
      whatsapp,
      priority,
    };

    const sortKey = {
      id: mappedRow.lead_id,
      bucket: priority.bucket,
      leadScore,
      overdueMs: overdueDue ? now.getTime() - new Date(overdueDue).getTime() : 0,
      lastActivityMs: lastActivity ? new Date(lastActivity).getTime() : 0,
    };

    return { row: mappedRow, sortKey, recentHandoff };
  });

  mapped.sort((a, b) => compareCommandCenterRows(a.sortKey, b.sortKey));

  const kpis: CommandCenterKpis = {
    hot: mapped.filter((m) => m.row.priority.bucket <= 2).length,
    overdue: mapped.filter((m) => m.row.has_overdue_followup).length,
    unassigned: mapped.filter((m) => m.row.assigned_agent_id == null).length,
    handoffs: mapped.filter((m) => m.recentHandoff).length,
    whatsapp_blocked: mapped.filter(
      (m) => m.row.whatsapp.linked === false || m.row.whatsapp.canReply === false,
    ).length,
  };

  return {
    rows: mapped.map((m) => m.row),
    kpis,
    generated_at: now.toISOString(),
    woztell_enabled: enabled,
  };
}

export async function listAdminConversations(actor?: StaffAccess): Promise<AdminConversationRow[]> {
  const params: unknown[] = [];
  const scope = actor ? agentScope(actor) : null;
  const where =
    scope !== null ? `WHERE wc.assigned_agent_id = ${addParam(params, scope)}::uuid` : "";
  const rows = await queryRows<AdminConversationRow>(
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
    ${where}
    ORDER BY wc.last_message_at DESC NULLS LAST, wc.updated_at DESC
    LIMIT 100
    `,
    params,
  );
  return rows;
}

export async function fetchAdminConversation(id: string, actor?: StaffAccess) {
  const params: unknown[] = [id];
  const scope = actor ? agentScope(actor) : null;
  const scopeClause =
    scope !== null ? ` AND wc.assigned_agent_id = ${addParam(params, scope)}::uuid` : "";
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
    WHERE wc.id = $1${scopeClause}
    LIMIT 1
    `,
    params,
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
    // Mirrors the requireStaff(["admin","manager"]) gate on
    // clearContactWhatsappOptOut -- this only decides whether the control is
    // rendered; the server fn enforces it for real. No actor means an internal
    // unscoped call with no UI behind it, so deny rather than assume.
    can_clear_opt_out: actor
      ? actor.roles.includes("admin") || actor.roles.includes("manager")
      : false,
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

export async function fetchAdminConversationAiAssist(
  input: { conversationId: string },
  actor: StaffAccess,
): Promise<AdminConversationAiAssist> {
  const params: unknown[] = [input.conversationId];
  const scope = agentScope(actor);
  const scopeClause =
    scope !== null ? ` AND wc.assigned_agent_id = ${addParam(params, scope)}::uuid` : "";
  const rows = await queryRows<{
    id: unknown;
    name: unknown;
    opted_out_whatsapp: unknown;
    messages: unknown;
  }>(
    `SELECT
       wc.id,
       c.name,
       c.opted_out_whatsapp,
       COALESCE(
         json_agg(
           json_build_object(
             'direction', m.direction,
             'text', m.text,
             'created_at', m.created_at
           )
           ORDER BY m.created_at DESC
         ) FILTER (WHERE m.id IS NOT NULL),
         '[]'::json
       ) AS messages
     FROM whatsapp_conversations wc
     LEFT JOIN crm_contacts c ON c.id = wc.contact_id
     LEFT JOIN whatsapp_messages m ON m.conversation_id = wc.id
     WHERE wc.id = $1${scopeClause}
     GROUP BY wc.id, c.name, c.opted_out_whatsapp
     LIMIT 1`,
    params,
  );
  const row = rows[0];
  if (!row) throw new Error("Conversation not found");

  const messages = parseConversationAiMessages(row.messages).slice(0, 10);
  const latestInbound = messages.find((message) => message.direction === "inbound");
  const latestInboundText = latestInbound?.text ?? "";
  const detectedIntent = /租|rent/i.test(latestInboundText)
    ? "renter"
    : /估價|放盤|sell|valuation/i.test(latestInboundText)
      ? "seller"
      : latestInboundText
        ? "buyer"
        : null;
  const optedOut = row.opted_out_whatsapp === true;

  return {
    summary: messages.length
      ? `最近 ${messages.length} 則 WhatsApp 訊息，客戶需要跟進。`
      : "未有足夠訊息。",
    detectedIntent,
    urgency: messages.length >= 3 ? "active" : "normal",
    suggestedReply: optedOut ? null : "你好，多謝查詢。請問你想了解買樓、租樓，還是放盤估價？",
    suggestedTemplate: optedOut ? null : "earnest_follow_up_zh_hk",
    handoffNote: stringOrNull(row.name)
      ? `${stringOrNull(row.name)} 由 WhatsApp 查詢，請查看最近訊息。`
      : "WhatsApp 查詢，請查看最近訊息。",
  };
}

export async function updateAdminConversation(
  input: AdminConversationUpdateInput,
  actor: StaffAccess,
) {
  const scope = agentScope(actor);
  const rows = await queryRows(
    `UPDATE whatsapp_conversations SET status = $1, assigned_agent_id = $2, updated_at = now() WHERE id = $3${
      scope !== null ? " AND assigned_agent_id = $4" : ""
    } RETURNING id`,
    scope !== null
      ? [input.status, input.assigned_agent_id, input.id, scope]
      : [input.status, input.assigned_agent_id, input.id],
  );
  if (!rows[0]) {
    if (scope !== null) throw new Response("Forbidden", { status: 403 });
    return { ok: false, error: "Not found" };
  }
  await writeAudit(actor.staffId, "conversation.update", "conversation", input.id, {
    status: input.status,
    assigned_agent_id: input.assigned_agent_id,
  });
  return { ok: true };
}

/**
 * Clear a contact's WhatsApp opt-out.
 *
 * opted_out_whatsapp is written monotonically by the inbound webhook
 * (`opted_out_whatsapp = opted_out_whatsapp OR $7`), and until this existed
 * there was no code path anywhere that could set it back to false. A customer
 * mis-classified as opting out -- which the old substring matcher did to anyone
 * who wrote 「我想取消今日睇樓約會」 -- was blocked from every staff reply and every
 * campaign permanently, with no way back short of a manual SQL statement.
 *
 * Restricted to admin/manager and always audited: this re-enables marketing
 * messages to a real person, so it needs to be attributable. Agents can see the
 * 已拒收 badge but cannot clear it.
 */
export async function clearContactWhatsappOptOut(
  input: { contactId: string; reason: string },
  actor: StaffAccess,
) {
  const reason = input.reason.trim();
  if (!reason) throw new Response("A reason is required to clear an opt-out.", { status: 400 });

  const rows = await queryRows<{ id: unknown; opted_out_whatsapp: unknown }>(
    `UPDATE crm_contacts
        SET opted_out_whatsapp = false, updated_at = now()
      WHERE id = $1::uuid
        AND opted_out_whatsapp = true
      RETURNING id, opted_out_whatsapp`,
    [input.contactId],
  );

  if (!rows[0]) {
    // Either no such contact, or it was not opted out to begin with. Both are
    // no-ops from the caller's point of view; nothing was changed, so nothing
    // is audited.
    return { ok: false as const, error: "NOT_OPTED_OUT" };
  }

  await writeAudit(actor.staffId, "contact.optout.clear", "contact", input.contactId, { reason });
  return { ok: true as const };
}

function parseConversationAiMessages(value: unknown) {
  const parsed =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return [];
          }
        })()
      : value;

  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    return [
      {
        direction: stringOrEmpty(row.direction),
        text: stringOrNull(row.text),
        created_at: dateOrNull(row.created_at),
      },
    ];
  });
}

export async function listAdminCampaigns(): Promise<AdminCampaignRow[]> {
  const rows = await queryRows<AdminCampaignRow>(
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
      count(r.id)::int AS recipients,
      count(r.id) FILTER (WHERE r.status = 'sent')::int AS sent,
      count(r.id) FILTER (WHERE r.status = 'failed')::int AS failed,
      count(r.id) FILTER (WHERE r.status = 'blocked')::int AS blocked,
      count(r.id) FILTER (WHERE r.status IN ('queued', 'sending'))::int AS pending
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
      // category/description/components are selected so the send confirmation can
      // show staff everything this system knows about the template. The approved
      // body text is held by Woztell and is deliberately not mirrored here.
      "SELECT id, element_name, language_code, status, category, description, components FROM whatsapp_templates ORDER BY element_name ASC",
    ),
    queryRows(
      "SELECT id, name, description, filters FROM whatsapp_audiences ORDER BY name ASC, created_at DESC",
    ),
  ]);
  return {
    templates: templates.map((row) => ({
      id: stringOrEmpty(row.id),
      element_name: stringOrEmpty(row.element_name),
      language_code: stringOrEmpty(row.language_code),
      status: stringOrEmpty(row.status),
      category: stringOrEmpty(row.category),
      description: stringOrNull(row.description),
      components: Array.isArray(row.components) ? row.components : [],
    })),
    audiences: audiences.map((row) => ({
      id: stringOrEmpty(row.id),
      name: stringOrEmpty(row.name),
      description: stringOrNull(row.description),
      // Needed to reopen an audience in the editor; without it "edit" could only
      // ever rename, silently blanking the filters on save.
      filters: normalizeAudienceFilters(parseAudienceFilters(row.filters)),
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

/** Deletes an audience, refusing while a live campaign still points at it.
 *
 * whatsapp_campaigns.audience_id is ON DELETE SET NULL, so an unguarded delete
 * would silently strip the audience off a draft/review/scheduled campaign and
 * leave it looking configured while having nobody to send to. Historical
 * campaigns (completed/cancelled/failed) are allowed to lose the reference, but
 * the count is returned so the caller can say so rather than deleting quietly.
 */
export async function deleteAdminAudience(id: string, actor: StaffAccess) {
  const blocking = await queryRows<{ count: number; names: string[] }>(
    `SELECT count(*)::int AS count, array_agg(name ORDER BY name) AS names
     FROM whatsapp_campaigns
     WHERE audience_id = $1::uuid
       AND status IN ('draft', 'review', 'scheduled', 'queued', 'sending')`,
    [id],
  );
  const blockingCount = blocking[0]?.count ?? 0;
  if (blockingCount > 0) {
    return {
      ok: false as const,
      error: "AUDIENCE_IN_USE",
      campaigns: (blocking[0]?.names ?? []).filter(Boolean).slice(0, 10),
    };
  }

  const historical = await queryRows<{ count: number }>(
    `SELECT count(*)::int AS count FROM whatsapp_campaigns WHERE audience_id = $1::uuid`,
    [id],
  );

  const rows = await queryRows("DELETE FROM whatsapp_audiences WHERE id = $1 RETURNING id", [id]);
  if (!rows[0]) return { ok: false as const, error: "NOT_FOUND" };

  await writeAudit(actor.staffId, "audience.delete", "audience", id, {
    detachedCampaigns: historical[0]?.count ?? 0,
  });
  return { ok: true as const, detachedCampaigns: historical[0]?.count ?? 0 };
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
  if (!campaign) return { ok: false as const, error: "Campaign not found" };

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
      -- 'sent'/'sending' are obviously not re-queueable. WOZTELL_DELIVERY_UNKNOWN
      -- is the subtle one: it means the provider took the message but never
      -- confirmed the outcome (a 5xx/timeout, or a 'sending' row reconciled
      -- after 15 minutes -- see campaign-delivery.server.ts). The customer may
      -- well have received it, so re-queueing that recipient risks a second,
      -- billable WhatsApp message to a real person. Treat it as terminal;
      -- genuine provider rejections (WOZTELL_PROVIDER_REJECTED) still re-queue.
      ON CONFLICT (campaign_id, contact_id) DO UPDATE SET
        status = CASE
          WHEN whatsapp_campaign_recipients.status IN ('sent', 'sending')
            OR whatsapp_campaign_recipients.error = 'WOZTELL_DELIVERY_UNKNOWN'
            THEN whatsapp_campaign_recipients.status
          ELSE EXCLUDED.status
        END,
        error = CASE
          WHEN whatsapp_campaign_recipients.status IN ('sent', 'sending')
            OR whatsapp_campaign_recipients.error = 'WOZTELL_DELIVERY_UNKNOWN'
            THEN whatsapp_campaign_recipients.error
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
  return { ok: true as const, ...summary };
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
  if (!row) return { ok: false as const, error: "Campaign not found" };

  const check = canPrepareAdminCampaignQueue({
    campaignStatus: stringOrEmpty(row.status),
    templateStatus: stringOrNull(row.template_status),
  });
  if (!check.ok) return { ok: false as const, error: check.reason };
  return { ok: true as const };
}

export async function sendAdminCampaignQueue(id: string, actor: StaffAccess) {
  const validation = await validateAdminCampaignQueueability(id);
  if (!validation.ok) return validation;

  const materialization = await materializeCampaignRecipients(id, actor);
  if (!materialization.ok)
    return { ok: false as const, error: materialization.error, materialization };

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
  if (!row) return { ok: false as const, error: "Campaign not found" };

  const check = canQueueAdminCampaign({
    campaignStatus: stringOrEmpty(row.status),
    templateStatus: stringOrNull(row.template_status),
    eligibleRecipients: Number(row.eligible_recipients ?? 0),
  });
  if (!check.ok) return { ok: false as const, error: check.reason };

  // TOCTOU hardening: the eligibility predicate above can go stale between the
  // SELECT and the writes (a concurrent cancel/materialize could change the
  // campaign status or recipients). Re-assert the entire predicate inside the
  // status flip's WHERE clause and run both writes in one atomic transaction so
  // they cannot half-apply. The recipient update is gated on the campaign
  // actually being 'queued' (set by the first statement in the same tx).
  const sql = getSql();
  const [flipped] = await sql.transaction((tx) => [
    tx.query(
      `
      UPDATE whatsapp_campaigns c
      SET status = 'queued', reviewed_by = $1, reviewed_at = now(), updated_at = now()
      FROM whatsapp_templates t
      WHERE c.id = $2
        -- Must match canQueueAdminCampaign's own gate. This previously also
        -- accepted 'draft', so a concurrent save-back-to-draft mid-queue still
        -- sent: the re-assert that exists to close the TOCTOU window was
        -- letting through the exact state the check above rejects.
        AND c.status IN ('review', 'scheduled')
        AND t.id = c.template_id
        AND t.status LIKE 'active%'
        AND EXISTS (
          SELECT 1
          FROM whatsapp_campaign_recipients r
          JOIN crm_contacts contact ON contact.id = r.contact_id
          WHERE r.campaign_id = c.id
            AND r.status = 'queued'
            AND NULLIF(contact.normalized_phone, '') IS NOT NULL
            AND contact.opt_in_whatsapp = true
            AND contact.opted_out_whatsapp = false
        )
      RETURNING c.id, c.reviewed_at
      `,
      [actor.staffId, id],
    ),
    tx.query(
      `
      UPDATE whatsapp_campaign_recipients
      SET queued_at = COALESCE(queued_at, now())
      WHERE campaign_id = $1
        AND status = 'queued'
        AND EXISTS (
          SELECT 1 FROM whatsapp_campaigns c WHERE c.id = $1 AND c.status = 'queued'
        )
      `,
      [id],
    ),
  ]);

  if (!Array.isArray(flipped) || !flipped[0]) {
    // Lost the race (campaign was cancelled/changed concurrently) or no longer
    // eligible. Nothing was committed.
    return { ok: false as const, error: "CAMPAIGN_NOT_ELIGIBLE" };
  }

  await writeAudit(actor.staffId, "campaign.queue", "campaign", id, {
    eligibleRecipients: Number(row.eligible_recipients ?? 0),
  });

  // reviewed_at is re-stamped on every queue flip, so it identifies THIS queue
  // run. Callers fold it into the job's idempotency key: two enqueues of the
  // same run collapse to one job (what idempotency is for), while a later
  // re-queue of the same campaign gets a fresh key and therefore a fresh job
  // row. Without it the key was campaign-stable, so once a job reached a
  // terminal state the ON CONFLICT no-op handed back the dead row forever and
  // the campaign could never be sent again.
  return { ok: true as const, queueRunAt: rowDate(flipped[0].reviewed_at) };
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
  name: string;
  phone: string;
  email?: string | null;
  message?: string | null;
  listingNo?: string | null;
  property_id?: string | null;
  consentWhatsapp?: boolean;
}) {
  // Public, untrusted path: agent assignment is never accepted from the client.
  const normalizedPhone = normalizeAdminPhone(input.phone);
  const email = input.email ? input.email : null;
  const message = input.message ? input.message : null;
  const optInWhatsapp = input.consentWhatsapp === true;
  const requestedPropertyId = input.property_id ?? null;
  const requestedListingNo = input.listingNo?.trim() || null;
  return persistWebsiteInquiry(queryRows, {
    name: input.name,
    phone: input.phone,
    normalizedPhone,
    email,
    message,
    listingNo: requestedListingNo,
    propertyId: requestedPropertyId,
    consentWhatsapp: optInWhatsapp,
  });
}

const INQUIRY_STATUSES = ["new", "contacted", "qualified", "closed", "spam"] as const;

export async function updateInquiryStatus(id: string, status: string, actor: StaffAccess) {
  // Status came straight from the client into the UPDATE with no allowlist.
  if (!INQUIRY_STATUSES.includes(status as (typeof INQUIRY_STATUSES)[number])) {
    throw new Response("Unsupported inquiry status.", { status: 400 });
  }

  // Same agent scoping every other lead/inquiry mutation applies. Without it an
  // agent could close or mark spam any inquiry in the agency, including ones
  // routed to a colleague.
  const scope = agentScope(actor);
  const rows = await queryRows(
    `UPDATE inquiries
        SET status = $1, updated_at = now()
      WHERE id = $2${scope !== null ? " AND assigned_agent_id = $3" : ""}
      RETURNING id`,
    scope !== null ? [status, id, scope] : [status, id],
  );
  if (!rows[0]) throw new Response("Forbidden", { status: 403 });

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
