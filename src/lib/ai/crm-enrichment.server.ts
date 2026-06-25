import "@tanstack/react-start/server-only";

import {
  dateOrNull,
  getSql,
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
  generated_by: "ai" | "fallback";
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
  // When the model call fails we still persist the canned fallback profile so staff
  // have something to act on, but it must be marked as 'fallback' (not silently
  // recorded as a real AI analysis) and the failure surfaced to the caller.
  const generatedBy: "ai" | "fallback" = ai.ok ? "ai" : "fallback";
  if (!ai.ok) {
    console.error(
      `[crm-enrichment] AI lead analysis failed for lead ${leadId}; persisting fallback profile (error=${ai.error ?? "unknown"})`,
    );
  }
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

  const factualTagSet = new Set(factualTags);
  const tags: TagValues[] = [];

  for (const tag of factualTags) {
    tags.push({
      lead_id: lead.id,
      contact_id: lead.contact_id,
      tag,
      confidence: 1,
      reason: "Derived from explicit CRM fields.",
      status: canAutoApplyAiTag(tag) ? "auto_applied" : "suggested",
    });
  }

  for (const suggestion of value.suggested_tags) {
    if (factualTagSet.has(suggestion.tag)) continue;
    tags.push({
      lead_id: lead.id,
      contact_id: lead.contact_id,
      tag: suggestion.tag,
      confidence: suggestion.confidence,
      reason: suggestion.reason,
      status: "suggested",
    });
  }

  await writeLeadAnalysis(
    lead,
    {
      summary: value.summary,
      urgency: value.urgency,
      timeline: value.timeline,
      next_best_action: value.next_best_action,
      lead_score: leadScore,
      generated_by: generatedBy,
    },
    mergeTagInputs(tags),
  );

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
    `WITH ranked AS (
       SELECT
         *,
         row_number() OVER (
           PARTITION BY tag
           ORDER BY ${tagRankSql()}, confidence DESC, created_at DESC, id
         ) AS tag_rank
       FROM crm_ai_tags
       WHERE ($1::uuid IS NULL OR lead_id = $1::uuid)
         AND ($2::uuid IS NULL OR contact_id = $2::uuid)
     )
     SELECT *
     FROM ranked
     WHERE tag_rank = 1
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

async function writeLeadAnalysis(lead: LeadInput, values: ProfileValues, tags: TagValues[]) {
  const sql = getSql();
  await sql.transaction((tx) => [
    tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`crm-ai-lead:${lead.id}`]),
    tx.query(
      `DELETE FROM crm_ai_profiles profile
       USING (
         SELECT
           id,
           row_number() OVER (
             ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id
           ) AS row_rank
         FROM crm_ai_profiles
         WHERE lead_id = $1::uuid
       ) ranked
       WHERE profile.id = ranked.id
         AND ranked.row_rank > 1`,
      [lead.id],
    ),
    tx.query(
      `DELETE FROM crm_ai_tags tag
       USING (
         SELECT
           id,
           row_number() OVER (
             PARTITION BY lead_id, tag
             ORDER BY ${tagRankSql()}, confidence DESC, created_at DESC, id
           ) AS row_rank
         FROM crm_ai_tags
         WHERE lead_id = $1::uuid
       ) ranked
       WHERE tag.id = ranked.id
         AND ranked.row_rank > 1`,
      [lead.id],
    ),
    tx.query(
      `UPDATE crm_ai_profiles
       SET contact_id = (SELECT contact_id FROM crm_leads WHERE id = $1::uuid)
       WHERE lead_id = $1::uuid`,
      [lead.id],
    ),
    tx.query(
      `UPDATE crm_ai_tags
       SET contact_id = (SELECT contact_id FROM crm_leads WHERE id = $1::uuid)
       WHERE lead_id = $1::uuid`,
      [lead.id],
    ),
    tx.query(profileUpsertSql(), profileParams(lead, values)),
    tx.query(tagUpsertSql(), [lead.id, JSON.stringify(tags.map(tagRecord))]),
  ]);
}

function profileParams(lead: LeadInput, values: ProfileValues) {
  return [
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
    values.generated_by,
  ];
}

function profileUpsertSql() {
  return `WITH current_lead AS (
    SELECT contact_id
    FROM crm_leads
    WHERE id = $1::uuid
  ),
  updated AS (
    UPDATE crm_ai_profiles
    SET contact_id = (SELECT contact_id FROM current_lead),
        intent = $2,
        intent_confidence = $3,
        budget_band = $4,
        preferred_estates = $5::text[],
        urgency = $6,
        timeline = $7,
        language = $8,
        lead_score = $9,
        next_best_action = $10,
        summary = $11,
        generated_by = $12,
        last_analyzed_at = now(),
        updated_at = now()
    WHERE lead_id = $1::uuid
    RETURNING *
  ),
  inserted AS (
    INSERT INTO crm_ai_profiles (
      contact_id, lead_id, intent, intent_confidence, budget_band, preferred_estates, urgency,
      timeline, language, lead_score, next_best_action, summary, generated_by, last_analyzed_at,
      updated_at
    )
    SELECT
      current_lead.contact_id,
      $1::uuid,
      $2,
      $3,
      $4,
      $5::text[],
      $6,
      $7,
      $8,
      $9,
      $10,
      $11,
      $12,
      now(),
      now()
    FROM current_lead
    WHERE NOT EXISTS (SELECT 1 FROM updated)
    RETURNING *
  )
  SELECT * FROM updated
  UNION ALL
  SELECT * FROM inserted
  LIMIT 1`;
}

function tagUpsertSql() {
  return `WITH current_lead AS (
    SELECT contact_id
    FROM crm_leads
    WHERE id = $1::uuid
  ),
  input AS (
    SELECT
      current_lead.contact_id,
      $1::uuid AS lead_id,
      input_tag.tag,
      input_tag.category,
      input_tag.safety_level,
      input_tag.status,
      input_tag.confidence,
      input_tag.reason
    FROM current_lead
    CROSS JOIN jsonb_to_recordset($2::jsonb) AS input_tag(
      tag text,
      category text,
      safety_level text,
      status text,
      confidence numeric,
      reason text
    )
  ),
  updated AS (
    UPDATE crm_ai_tags existing
    SET contact_id = input.contact_id,
        category = input.category,
        safety_level = input.safety_level::crm_ai_tag_safety,
        status = CASE
          WHEN existing.status IN ('approved', 'rejected') THEN existing.status
          ELSE input.status::crm_ai_tag_status
        END,
        confidence = GREATEST(existing.confidence, input.confidence),
        reason = input.reason
    FROM input
    WHERE existing.lead_id = input.lead_id
      AND existing.tag = input.tag
    RETURNING existing.*
  ),
  inserted AS (
    INSERT INTO crm_ai_tags (
      contact_id, lead_id, tag, category, safety_level, status, confidence, reason, created_by_ai
    )
    SELECT
      input.contact_id,
      input.lead_id,
      input.tag,
      input.category,
      input.safety_level::crm_ai_tag_safety,
      input.status::crm_ai_tag_status,
      input.confidence,
      input.reason,
      true
    FROM input
    WHERE NOT EXISTS (
      SELECT 1
      FROM updated
      WHERE updated.lead_id = input.lead_id
        AND updated.tag = input.tag
    )
    RETURNING *
  )
  SELECT * FROM updated
  UNION ALL
  SELECT * FROM inserted`;
}

function mergeTagInputs(tags: TagValues[]) {
  const byTag = new Map<string, TagValues>();
  for (const tag of tags) {
    const normalizedTag = tag.tag.trim();
    if (!normalizedTag) continue;

    const existing = byTag.get(normalizedTag);
    if (!existing) {
      byTag.set(normalizedTag, { ...tag, tag: normalizedTag });
      continue;
    }

    existing.confidence = Math.max(existing.confidence, tag.confidence);
    if (tag.status === "auto_applied") existing.status = "auto_applied";
    if (tag.reason && tag.confidence >= existing.confidence) existing.reason = tag.reason;
  }
  return Array.from(byTag.values());
}

function tagRecord(input: TagValues) {
  return {
    tag: input.tag,
    category: tagCategory(input.tag),
    safety_level: classifyAiTagSafety(input.tag),
    status: input.status,
    confidence: clampConfidence(input.confidence),
    reason: input.reason,
  };
}

function tagRankSql() {
  return `CASE status
    WHEN 'approved' THEN 0
    WHEN 'rejected' THEN 1
    WHEN 'auto_applied' THEN 2
    ELSE 3
  END`;
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
