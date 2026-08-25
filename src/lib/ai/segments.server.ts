import "@tanstack/react-start/server-only";

import {
  dateOrNull,
  getSql,
  numberOrNull,
  queryRows,
  stringOrEmpty,
  stringOrNull,
} from "@/lib/neon/db.server";

import type {
  CrmSegment,
  CrmSegmentEligibility,
  CrmSegmentFilters,
  CrmSegmentStatus,
} from "./ai-types";
import { classifySegmentEligibility, parseSegmentPromptToFilters } from "./segments";

export type CrmSegmentPreview = {
  filters: CrmSegmentFilters;
  total: number;
  eligible: number;
  contacts: CrmSegmentPreviewContact[];
};

export type CrmSegmentPreviewContact = {
  contact_id: string;
  lead_id: string | null;
  name: string | null;
  phone: string | null;
  eligibility_status: CrmSegmentEligibility;
  confidence: number;
  reason: string;
};

export type CrmSegmentRow = CrmSegment & {
  members: number;
  eligible_members: number;
};

// Preview is for UI display only, so it is capped. Materialize must enroll the full
// matching set; a much higher bound (effectively "all" for any realistic segment)
// avoids the bug where segments matching >200 contacts only enrolled the first 200.
const SEGMENT_PREVIEW_LIMIT = 200;
const SEGMENT_MATERIALIZE_LIMIT = 50000;

async function fetchSegmentContacts(
  prompt: string,
  filters: CrmSegmentFilters,
  limit: number,
): Promise<CrmSegmentPreviewContact[]> {
  const rows = await queryRows(
    `SELECT DISTINCT ON (c.id, l.id)
       c.id AS contact_id,
       l.id AS lead_id,
       c.name,
       c.phone,
       c.normalized_phone,
       c.opt_in_whatsapp,
       c.opted_out_whatsapp,
       l.intent,
       l.budget_min::float AS budget_min,
       l.budget_max::float AS budget_max,
       l.preferred_estates,
       l.source,
       EXTRACT(DAY FROM now() - l.updated_at)::int AS last_activity_days
     FROM crm_leads l
     JOIN crm_contacts c ON c.id = l.contact_id
     LEFT JOIN properties p ON p.id = l.property_id
     LEFT JOIN estates estate ON estate.id = p.estate_id
     WHERE ($1::text IS NULL OR l.intent = $1)
       AND ($2::numeric IS NULL OR l.budget_max IS NULL OR l.budget_max >= $2)
       AND ($3::numeric IS NULL OR l.budget_min IS NULL OR l.budget_min <= $3)
       AND ($4::text[] IS NULL OR l.preferred_estates && $4::text[])
       AND ($5::boolean = false OR c.opt_in_whatsapp = true)
       AND ($6::int IS NULL OR l.updated_at >= now() - ($6::text || ' days')::interval)
       AND ($7::text IS NULL OR l.source = $7)
       AND ($8::uuid IS NULL OR c.assigned_agent_id = $8::uuid OR l.assigned_agent_id = $8::uuid)
       AND (
         $9::text IS NULL
         OR p.district_slug = $9
         OR estate.district_slug = $9
       )
     ORDER BY c.id, l.id, l.updated_at DESC
     LIMIT $10`,
    [
      filters.intent ?? null,
      filters.budget?.min ?? null,
      filters.budget?.max ?? null,
      filters.preferred_estates?.length ? filters.preferred_estates : null,
      filters.require_whatsapp_opt_in === true,
      filters.last_activity_days ?? null,
      filters.source ?? null,
      filters.assigned_agent_id ?? null,
      filters.district_slug ?? null,
      limit,
    ],
  );

  return rows.map((row) => {
    const eligibility = classifySegmentEligibility({
      normalized_phone: stringOrNull(row.normalized_phone),
      opt_in_whatsapp: row.opt_in_whatsapp === true,
      opted_out_whatsapp: row.opted_out_whatsapp === true,
    });
    return {
      contact_id: stringOrEmpty(row.contact_id),
      lead_id: stringOrNull(row.lead_id),
      name: stringOrNull(row.name),
      phone: stringOrNull(row.phone),
      eligibility_status: eligibility,
      confidence: segmentConfidence(filters, eligibility),
      reason: segmentReason(prompt, filters),
    };
  });
}

export async function previewCrmSegment(input: {
  prompt: string;
  filters?: CrmSegmentFilters;
}): Promise<CrmSegmentPreview> {
  const filters = normalizeSegmentFilters(
    input.filters ?? parseSegmentPromptToFilters(input.prompt),
  );
  const contacts = await fetchSegmentContacts(input.prompt, filters, SEGMENT_PREVIEW_LIMIT);

  return {
    filters,
    total: contacts.length,
    eligible: contacts.filter((contact) => contact.eligibility_status === "eligible").length,
    contacts,
  };
}

/** Resolves a saved segment's stored/parsed filters, for callers outside the
 * segments feature that need to translate them (e.g. building a WhatsApp
 * audience from a segment). */
export async function getSegmentForAudience(
  segmentId: string,
): Promise<{ name: string; filters: CrmSegmentFilters } | null> {
  const segments = await queryRows(
    `SELECT name, natural_language_prompt, structured_filters
     FROM crm_segments
     WHERE id = $1
     LIMIT 1`,
    [segmentId],
  );
  const segment = segments[0];
  if (!segment) return null;

  const prompt = stringOrEmpty(segment.natural_language_prompt);
  const filters = normalizeSegmentFilters(
    parseStoredSegmentFilters(segment.structured_filters) ?? parseSegmentPromptToFilters(prompt),
  );
  return { name: stringOrEmpty(segment.name), filters };
}

export async function saveCrmSegment(input: {
  id?: string;
  name: string;
  description: string | null;
  natural_language_prompt: string;
  structured_filters: CrmSegmentFilters;
  status: CrmSegmentStatus;
  staffId: string;
}) {
  const name = input.name.trim();
  const prompt = input.natural_language_prompt.trim();
  if (!name) throw new Error("Segment name is required");
  if (!prompt) throw new Error("Segment prompt is required");

  const rows = input.id
    ? await queryRows(
        `UPDATE crm_segments
         SET name = $1,
             description = $2,
             natural_language_prompt = $3,
             structured_filters = $4::jsonb,
             status = $5::crm_segment_status,
             updated_at = now()
         WHERE id = $6
         RETURNING id`,
        [
          name,
          input.description,
          prompt,
          JSON.stringify(normalizeSegmentFilters(input.structured_filters)),
          input.status,
          input.id,
        ],
      )
    : await queryRows(
        `INSERT INTO crm_segments (
          name, description, natural_language_prompt, structured_filters, status, created_by
        )
         VALUES ($1, $2, $3, $4::jsonb, $5::crm_segment_status, $6)
         RETURNING id`,
        [
          name,
          input.description,
          prompt,
          JSON.stringify(normalizeSegmentFilters(input.structured_filters)),
          input.status,
          input.staffId,
        ],
      );

  const id = stringOrEmpty(rows[0]?.id);
  if (!id) throw new Error(input.id ? "Segment not found" : "Segment was not saved");
  return id;
}

export async function materializeCrmSegment(input: { segmentId: string }) {
  const segments = await queryRows(
    `SELECT natural_language_prompt, structured_filters
     FROM crm_segments
     WHERE id = $1
     LIMIT 1`,
    [input.segmentId],
  );
  const segment = segments[0];
  if (!segment) throw new Error("Segment not found");

  const prompt = stringOrEmpty(segment.natural_language_prompt);
  const filters = normalizeSegmentFilters(
    parseStoredSegmentFilters(segment.structured_filters) ?? parseSegmentPromptToFilters(prompt),
  );
  // Enroll the FULL matching set, not the 200-row preview, so segments with more than
  // the preview cap still materialize every matching contact.
  const contacts = await fetchSegmentContacts(prompt, filters, SEGMENT_MATERIALIZE_LIMIT);
  const memberships = contacts.map((contact) => ({
    contact_id: contact.contact_id,
    lead_id: contact.lead_id,
    confidence: contact.confidence,
    reason: contact.reason,
    eligibility_status: contact.eligibility_status,
  }));

  const sql = getSql();
  await sql.transaction((tx) => [
    tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`crm-segment:${input.segmentId}`]),
    tx.query("DELETE FROM crm_segment_memberships WHERE segment_id = $1", [input.segmentId]),
    tx.query(
      `INSERT INTO crm_segment_memberships (
        segment_id, contact_id, lead_id, confidence, reason, eligibility_status, staff_approved, updated_at
      )
      SELECT
        $1::uuid,
        membership.contact_id::uuid,
        NULLIF(membership.lead_id, '')::uuid,
        membership.confidence,
        membership.reason,
        membership.eligibility_status::crm_segment_eligibility,
        true,
        now()
      FROM jsonb_to_recordset($2::jsonb) AS membership(
        contact_id text,
        lead_id text,
        confidence numeric,
        reason text,
        eligibility_status text
      )`,
      [input.segmentId, JSON.stringify(memberships)],
    ),
    tx.query("UPDATE crm_segments SET updated_at = now() WHERE id = $1", [input.segmentId]),
  ]);

  return {
    materialized: contacts.length,
    eligible: contacts.filter((contact) => contact.eligibility_status === "eligible").length,
  };
}

export async function listCrmSegments(): Promise<CrmSegmentRow[]> {
  const rows = await queryRows(
    `SELECT id, name, description, natural_language_prompt, structured_filters, status,
            created_at, updated_at
     FROM crm_segments
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 100`,
  );

  // members/eligible_members are computed live (same query preview uses), not
  // read from the materialize table below. That table is only ever refreshed
  // when someone explicitly re-materializes via 建立名單, so a segment sat at
  // "0 位客戶，其中 0 位合資格" indefinitely -- even once a real, eligible
  // customer started matching its filters -- until someone happened to
  // re-save it.
  return Promise.all(
    rows.map(async (row) => {
      const prompt = stringOrEmpty(row.natural_language_prompt);
      const filters = normalizeSegmentFilters(
        parseStoredSegmentFilters(row.structured_filters) ?? parseSegmentPromptToFilters(prompt),
      );
      const contacts = await fetchSegmentContacts(prompt, filters, SEGMENT_PREVIEW_LIMIT);
      return {
        id: stringOrEmpty(row.id),
        name: stringOrEmpty(row.name),
        description: stringOrNull(row.description),
        natural_language_prompt: prompt,
        structured_filters: filters,
        status: segmentStatus(row.status),
        created_at: dateOrNull(row.created_at) ?? new Date().toISOString(),
        updated_at: dateOrNull(row.updated_at) ?? new Date().toISOString(),
        members: contacts.length,
        eligible_members: contacts.filter((contact) => contact.eligibility_status === "eligible")
          .length,
      };
    }),
  );
}

function parseStoredSegmentFilters(value: unknown): CrmSegmentFilters | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return normalizeSegmentFilters(JSON.parse(value) as CrmSegmentFilters);
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return normalizeSegmentFilters(value as CrmSegmentFilters);
  return null;
}

function normalizeSegmentFilters(filters: CrmSegmentFilters): CrmSegmentFilters {
  return {
    intent: optionalText(filters.intent),
    district_slug: optionalText(filters.district_slug),
    preferred_estates: Array.isArray(filters.preferred_estates)
      ? filters.preferred_estates.map(String).filter(Boolean)
      : undefined,
    budget:
      filters.budget && (filters.budget.min !== undefined || filters.budget.max !== undefined)
        ? {
            min: numberOrNull(filters.budget.min),
            max: numberOrNull(filters.budget.max),
          }
        : undefined,
    source: optionalText(filters.source),
    assigned_agent_id: optionalText(filters.assigned_agent_id),
    last_activity_days: numberOrNull(filters.last_activity_days) ?? undefined,
    require_whatsapp_opt_in: filters.require_whatsapp_opt_in === true ? true : undefined,
  };
}

function optionalText(value: unknown) {
  const text = stringOrNull(value)?.trim();
  return text || undefined;
}

function segmentStatus(value: unknown): CrmSegmentStatus {
  if (value === "active" || value === "archived") return value;
  return "draft";
}

function segmentConfidence(filters: CrmSegmentFilters, eligibility: CrmSegmentEligibility) {
  const filterCount = [
    filters.intent,
    filters.district_slug,
    filters.preferred_estates?.length,
    filters.budget?.min ?? filters.budget?.max,
    filters.source,
    filters.assigned_agent_id,
    filters.last_activity_days,
    filters.require_whatsapp_opt_in,
  ].filter(Boolean).length;
  const base = Math.min(0.95, 0.55 + filterCount * 0.08);
  return eligibility === "eligible" ? base : Math.min(base, 0.75);
}

function segmentReason(prompt: string, filters: CrmSegmentFilters) {
  const labels = [
    filters.intent ? `intent:${filters.intent}` : null,
    filters.district_slug ? `district:${filters.district_slug}` : null,
    filters.preferred_estates?.length ? `estates:${filters.preferred_estates.join(",")}` : null,
    filters.last_activity_days ? `last ${filters.last_activity_days} days` : null,
    filters.require_whatsapp_opt_in ? "WhatsApp opt-in" : null,
  ].filter(Boolean);
  return labels.length ? `Matched ${labels.join("; ")} from "${prompt}"` : `Matched "${prompt}"`;
}
