import "@tanstack/react-start/server-only";

import {
  dateOrNull,
  numberOrNull,
  queryRows,
  stringOrEmpty,
  stringOrNull,
} from "@/lib/neon/db.server";

import type { CrmAiProfile, CrmAiTag } from "./ai-types";
import {
  canAutoApplyAiTag,
  classifyAiTagSafety,
  scoreLeadProfile,
  suggestFactualTags,
} from "./crm-rules";
import { generateAiJson } from "./provider.server.ts";

type LeadInput = {
  id: string;
  contact_id: string | null;
  intent: string | null;
  budget_min: number | null;
  budget_max: number | null;
  preferred_estates: string[];
  source: string | null;
  note: string | null;
  opt_in_whatsapp: boolean | null;
  last_activity_days: number | null;
};

type AiLeadProfileSuggestion = {
  tag: string;
  confidence: number;
  reason: string;
};

type AiLeadProfileResponse = {
  summary: string;
  urgency: string | null;
  timeline: string | null;
  next_best_action: string;
  suggested_tags: AiLeadProfileSuggestion[];
};

type ProfileValues = {
  summary: string;
  urgency: string | null;
  timeline: string | null;
  next_best_action: string;
  lead_score: number;
};

type TagValues = {
  lead_id: string | null;
  contact_id: string | null;
  tag: string;
  confidence: number;
  reason: string;
  status: "suggested" | "auto_applied";
};

export async function analyzeCrmLead(leadId: string) {
  const lead = await fetchLeadInput(leadId);
  if (!lead) throw new Error("Lead not found");

  const factualTags = suggestFactualTags({
    intent: lead.intent,
    budget_min: lead.budget_min,
    budget_max: lead.budget_max,
    preferred_estates: lead.preferred_estates,
    source: lead.source,
    language: "zh-HK",
  });

  const fallback: AiLeadProfileResponse = {
    summary: lead.note || "未有足夠資料，建議先 WhatsApp 或電話了解需求。",
    urgency: lead.last_activity_days !== null && lead.last_activity_days <= 7 ? "recent" : "normal",
    timeline: null,
    next_best_action: "WhatsApp 跟進客戶預算、心水屋苑及睇樓時間。",
    suggested_tags: [],
  };

  const ai = await generateAiJson<AiLeadProfileResponse>({
    system:
      "You analyze Hong Kong property CRM leads for staff only. Do not invent facts. Return Traditional Chinese summary and safe next action.",
    prompt: JSON.stringify(lead),
    fallback,
  });
  const value = normalizeAiResponse(ai.value ?? fallback, fallback);

  const leadScore = scoreLeadProfile({
    intent: lead.intent,
    budget_min: lead.budget_min,
    budget_max: lead.budget_max,
    preferred_estates: lead.preferred_estates,
    timeline: value.timeline,
    opt_in_whatsapp: lead.opt_in_whatsapp,
    last_activity_days: lead.last_activity_days,
  });

  await upsertProfile(lead, {
    summary: value.summary,
    urgency: value.urgency,
    timeline: value.timeline,
    next_best_action: value.next_best_action,
    lead_score: leadScore,
  });

  for (const tag of factualTags) {
    await upsertTag({
      lead_id: lead.id,
      contact_id: lead.contact_id,
      tag,
      confidence: 1,
      reason: "Derived from explicit CRM fields.",
      status: canAutoApplyAiTag(tag) ? "auto_applied" : "suggested",
    });
  }

  for (const suggestion of value.suggested_tags) {
    await upsertTag({
      lead_id: lead.id,
      contact_id: lead.contact_id,
      tag: suggestion.tag,
      confidence: suggestion.confidence,
      reason: suggestion.reason,
      status: canAutoApplyAiTag(suggestion.tag) ? "auto_applied" : "suggested",
    });
  }

  return fetchCrmAiProfile({ leadId });
}

export async function fetchCrmAiProfile(input: { leadId?: string; contactId?: string }) {
  if (!input.leadId && !input.contactId) return { profile: null, tags: [] };

  const profiles = await queryRows(
    `SELECT *
     FROM crm_ai_profiles
     WHERE ($1::uuid IS NULL OR lead_id = $1::uuid)
       AND ($2::uuid IS NULL OR contact_id = $2::uuid)
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
    [input.leadId ?? null, input.contactId ?? null],
  );
  const tags = await queryRows(
    `SELECT *
     FROM crm_ai_tags
     WHERE ($1::uuid IS NULL OR lead_id = $1::uuid)
       AND ($2::uuid IS NULL OR contact_id = $2::uuid)
     ORDER BY status ASC, confidence DESC, created_at DESC`,
    [input.leadId ?? null, input.contactId ?? null],
  );

  return {
    profile: profiles[0] ? mapProfile(profiles[0]) : null,
    tags: tags.map(mapTag),
  };
}

export async function approveCrmAiTag(input: { tagId: string; staffId: string; approve: boolean }) {
  const status = input.approve ? "approved" : "rejected";
  const rows = await queryRows(
    `UPDATE crm_ai_tags
     SET status = $1::crm_ai_tag_status,
         approved_by = $2,
         approved_at = CASE WHEN $1 = 'approved' THEN now() ELSE NULL END
     WHERE id = $3
     RETURNING *`,
    [status, input.staffId, input.tagId],
  );
  return rows[0] ? mapTag(rows[0]) : null;
}

async function fetchLeadInput(leadId: string): Promise<LeadInput | null> {
  const rows = await queryRows(
    `SELECT
       l.id,
       l.contact_id,
       l.intent,
       l.budget_min::float AS budget_min,
       l.budget_max::float AS budget_max,
       l.preferred_estates,
       l.source,
       l.note,
       c.opt_in_whatsapp,
       EXTRACT(DAY FROM now() - COALESCE(MAX(a.created_at), l.updated_at, l.created_at))::int
         AS last_activity_days
     FROM crm_leads l
     LEFT JOIN crm_contacts c ON c.id = l.contact_id
     LEFT JOIN crm_activities a ON a.lead_id = l.id
     WHERE l.id = $1
     GROUP BY l.id, c.opt_in_whatsapp
     LIMIT 1`,
    [leadId],
  );
  const row = rows[0];
  if (!row) return null;

  return {
    id: stringOrEmpty(row.id),
    contact_id: stringOrNull(row.contact_id),
    intent: stringOrNull(row.intent),
    budget_min: numberOrNull(row.budget_min),
    budget_max: numberOrNull(row.budget_max),
    preferred_estates: Array.isArray(row.preferred_estates)
      ? row.preferred_estates.map(String)
      : [],
    source: stringOrNull(row.source),
    note: stringOrNull(row.note),
    opt_in_whatsapp: row.opt_in_whatsapp === true,
    last_activity_days: numberOrNull(row.last_activity_days),
  };
}

async function upsertProfile(lead: LeadInput, values: ProfileValues) {
  const params = profileParams(lead, values);
  const updated = await queryRows(
    `UPDATE crm_ai_profiles
     SET intent = $3,
         intent_confidence = $4,
         budget_band = $5,
         preferred_estates = $6::text[],
         urgency = $7,
         timeline = $8,
         language = $9,
         lead_score = $10,
         next_best_action = $11,
         summary = $12,
         last_analyzed_at = now(),
         updated_at = now()
     WHERE ${profileIdentitySql()}
     RETURNING *`,
    params,
  );
  if (updated[0]) return mapProfile(updated[0]);

  const inserted = await queryRows(
    `INSERT INTO crm_ai_profiles (
       contact_id, lead_id, intent, intent_confidence, budget_band, preferred_estates, urgency,
       timeline, language, lead_score, next_best_action, summary, last_analyzed_at, updated_at
     )
     VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8,$9,$10,$11,$12,now(),now())
     RETURNING *`,
    params,
  );
  return inserted[0] ? mapProfile(inserted[0]) : null;
}

async function upsertTag(input: TagValues) {
  const safety = classifyAiTagSafety(input.tag);
  const params = [
    input.contact_id,
    input.lead_id,
    input.tag,
    tagCategory(input.tag),
    safety,
    input.status,
    clampConfidence(input.confidence),
    input.reason,
  ];
  const updated = await queryRows(
    `UPDATE crm_ai_tags
     SET category = $4,
         safety_level = $5::crm_ai_tag_safety,
         status = CASE
           WHEN status IN ('approved', 'rejected') THEN status
           ELSE $6::crm_ai_tag_status
         END,
         confidence = GREATEST(confidence, $7),
         reason = $8
     WHERE ${tagIdentitySql()}
       AND tag = $3
     RETURNING *`,
    params,
  );
  if (updated[0]) return mapTag(updated[0]);

  const inserted = await queryRows(
    `INSERT INTO crm_ai_tags (
       contact_id, lead_id, tag, category, safety_level, status, confidence, reason, created_by_ai
     )
     VALUES ($1,$2,$3,$4,$5::crm_ai_tag_safety,$6::crm_ai_tag_status,$7,$8,true)
     RETURNING *`,
    params,
  );
  return inserted[0] ? mapTag(inserted[0]) : null;
}

function profileParams(lead: LeadInput, values: ProfileValues) {
  return [
    lead.contact_id,
    lead.id,
    lead.intent,
    lead.intent ? 0.8 : 0.2,
    budgetBand(lead.budget_min, lead.budget_max),
    lead.preferred_estates,
    values.urgency,
    values.timeline,
    "zh-HK",
    values.lead_score,
    values.next_best_action,
    values.summary,
  ];
}

function profileIdentitySql() {
  return `(
    ($1::uuid IS NOT NULL AND $2::uuid IS NOT NULL AND contact_id = $1::uuid AND lead_id = $2::uuid)
    OR ($1::uuid IS NULL AND $2::uuid IS NOT NULL AND contact_id IS NULL AND lead_id = $2::uuid)
    OR ($1::uuid IS NOT NULL AND $2::uuid IS NULL AND contact_id = $1::uuid AND lead_id IS NULL)
  )`;
}

function tagIdentitySql() {
  return `(
    ($1::uuid IS NOT NULL AND $2::uuid IS NOT NULL AND contact_id = $1::uuid AND lead_id = $2::uuid)
    OR ($1::uuid IS NULL AND $2::uuid IS NOT NULL AND contact_id IS NULL AND lead_id = $2::uuid)
    OR ($1::uuid IS NOT NULL AND $2::uuid IS NULL AND contact_id = $1::uuid AND lead_id IS NULL)
  )`;
}

function normalizeAiResponse(
  response: AiLeadProfileResponse,
  fallback: AiLeadProfileResponse,
): AiLeadProfileResponse {
  return {
    summary: safeText(response.summary, fallback.summary),
    urgency: safeNullableText(response.urgency, fallback.urgency),
    timeline: safeNullableText(response.timeline, fallback.timeline),
    next_best_action: safeText(response.next_best_action, fallback.next_best_action),
    suggested_tags: normalizeSuggestedTags(response.suggested_tags),
  };
}

function normalizeSuggestedTags(value: unknown): AiLeadProfileSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const tag = safeNullableText(record.tag, null);
      if (!tag) return null;
      return {
        tag,
        confidence: clampConfidence(record.confidence),
        reason: safeText(record.reason, "Suggested by AI profile analysis."),
      };
    })
    .filter((item): item is AiLeadProfileSuggestion => item !== null)
    .slice(0, 12);
}

function safeText(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  return text || fallback;
}

function safeNullableText(value: unknown, fallback: string | null) {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  return text || fallback;
}

function clampConfidence(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function tagCategory(tag: string) {
  return tag.split("_")[0]?.trim() || "general";
}

function mapProfile(row: Record<string, unknown>): CrmAiProfile {
  return {
    id: stringOrEmpty(row.id),
    contact_id: stringOrNull(row.contact_id),
    lead_id: stringOrNull(row.lead_id),
    intent: stringOrNull(row.intent),
    intent_confidence: numberOrNull(row.intent_confidence),
    budget_band: stringOrNull(row.budget_band),
    preferred_estates: Array.isArray(row.preferred_estates)
      ? row.preferred_estates.map(String)
      : [],
    urgency: stringOrNull(row.urgency),
    timeline: stringOrNull(row.timeline),
    language: stringOrNull(row.language),
    lead_score: numberOrNull(row.lead_score) ?? 0,
    next_best_action: stringOrNull(row.next_best_action),
    summary: stringOrNull(row.summary),
    last_analyzed_at: dateOrNull(row.last_analyzed_at),
    analysis_version: stringOrEmpty(row.analysis_version) || "v1",
  };
}

function mapTag(row: Record<string, unknown>): CrmAiTag {
  return {
    id: stringOrEmpty(row.id),
    contact_id: stringOrNull(row.contact_id),
    lead_id: stringOrNull(row.lead_id),
    tag: stringOrEmpty(row.tag),
    category: stringOrEmpty(row.category) || "general",
    safety_level: stringOrEmpty(row.safety_level) as CrmAiTag["safety_level"],
    status: stringOrEmpty(row.status) as CrmAiTag["status"],
    confidence: numberOrNull(row.confidence) ?? 0,
    reason: stringOrNull(row.reason),
    created_by_ai: row.created_by_ai === true,
    approved_by: stringOrNull(row.approved_by),
    approved_at: dateOrNull(row.approved_at),
    created_at: dateOrNull(row.created_at) ?? "",
  };
}

function budgetBand(min: number | null, max: number | null) {
  if (!min && !max) return null;
  return `${Math.floor((min ?? 0) / 1000000)}m-${Math.ceil((max ?? min ?? 0) / 1000000)}m`;
}
