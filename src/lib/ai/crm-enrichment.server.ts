import "@tanstack/react-start/server-only";
import type { StaffAccess } from "../neon/auth.server";
import {
  beginCrmAnalysisRun,
  crmAnalysisGuard,
  crmAnalysisError,
  mapCrmAnalysisRun,
  type CrmAnalysisRunRow,
} from "./crm-analysis-runs.server";

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
import {
  validateCrmAnalysis,
  type CrmAnalysis,
  type AiResultKind,
  type CrmActionType,
} from "./crm-analysis-contract";
import {
  allowedCrmActions,
  crmActionLabel,
  fallbackCrmAnalysis,
  type CrmActionContext,
} from "./crm-analysis-eligibility";

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
  action_context: CrmActionContext;
};

type ProfileValues = {
  summary: string;
  urgency: string | null;
  timeline: string | null;
  next_best_action: string;
  lead_score: number;
  generated_by: "ai" | "fallback";
  result_kind: AiResultKind;
  action_type: CrmActionType;
  validation_code: string | null;
};

type TagValues = {
  lead_id: string | null;
  contact_id: string | null;
  tag: string;
  confidence: number;
  reason: string;
  status: "suggested" | "auto_applied";
};

export async function analyzeCrmLead(
  leadId: string,
  actor: StaffAccess,
  options: { requestId?: string } = {},
) {
  let run: CrmAnalysisRunRow;
  try {
    run = await beginCrmAnalysisRun(leadId, actor, options.requestId);
  } catch (error) {
    if (crmAnalysisError(error) === "CRM_AI_DENIED")
      return { profile: null, tags: [], analysis: { status: "denied" as const } };
    throw error;
  }
  if (!run.started) {
    const status = run.current_source_fingerprint !== run.source_fingerprint ? "stale" : undefined;
    const output = run.output as {
      profile?: Record<string, unknown>;
      tags?: Record<string, unknown>[];
    } | null;
    return {
      profile: output?.profile ? mapProfile(output.profile) : null,
      tags: (output?.tags ?? []).map(mapTag),
      analysis: mapCrmAnalysisRun(run, status),
    };
  }
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

  const fallback = fallbackCrmAnalysis(lead.action_context);
  const ai = await generateAiJson<unknown>({
    system:
      "Analyze Hong Kong property CRM leads for staff only. Do not invent facts. Return a strict object with summary (1-2000 Traditional Chinese characters), urgency (normal/recent/high/null), timeline (30_days/90_days/later/unknown/null), action {type,reason (1-500 characters)}, suggested_tags (at most 12 objects with tag 1-80 characters, confidence 0-1, reason 1-500 characters). No extra fields. Choose only an allowedAction. Action reasons are review text and never instructions to execute or send.",
    prompt: JSON.stringify({
      intent: lead.intent,
      budget_min: lead.budget_min,
      budget_max: lead.budget_max,
      preferred_estates: lead.preferred_estates,
      source: lead.source,
      last_activity_days: lead.last_activity_days,
      eligibility: lead.action_context,
      allowedActions: allowedCrmActions(lead.action_context),
    }),
    fallback,
  });
  // When the model call fails we still persist the canned fallback profile so staff
  // have something to act on, but it must be marked as 'fallback' (not silently
  // recorded as a real AI analysis) and the failure surfaced to the caller.
  const validation = validateCrmAnalysis(ai.value);
  const eligible =
    ai.ok &&
    validation.ok &&
    allowedCrmActions(lead.action_context).includes(validation.value.action.type);
  const generatedBy: "ai" | "fallback" = eligible ? "ai" : "fallback";
  if (!ai.ok) {
    console.error(
      `[crm-enrichment] AI lead analysis failed for lead ${leadId}; persisting fallback profile (error=${ai.error ?? "unknown"})`,
    );
  }
  const value: CrmAnalysis = eligible && validation.ok ? validation.value : fallback;
  const validationCode = !ai.ok
    ? ai.error
    : !validation.ok
      ? validation.code
      : !eligible
        ? "INELIGIBLE_ACTION"
        : null;

  const leadScore = scoreLeadProfile({
    intent: lead.intent,
    budget_min: lead.budget_min,
    budget_max: lead.budget_max,
    preferred_estates: lead.preferred_estates,
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

  try {
    await writeLeadAnalysis(
      lead,
      {
        summary: value.summary,
        urgency: value.urgency,
        timeline: value.timeline,
        next_best_action: crmActionLabel(value.action.type),
        lead_score: lead.action_context.isTest ? 0 : leadScore,
        generated_by: generatedBy,
        result_kind: eligible ? "model_validated" : "fallback",
        action_type: value.action.type,
        validation_code: validationCode,
      },
      mergeTagInputs(tags),
      run,
      actor,
      ai.metadata,
    );
  } catch (error) {
    const code = crmAnalysisError(error);
    if (!code) throw error;
    const status =
      code === "CRM_AI_DENIED" ? "denied" : code === "CRM_AI_CANCELLED" ? "cancelled" : "stale";
    const [failed] = await queryRows(
      "UPDATE crm_ai_analysis_runs SET status=$1,completed_at=now(),validation_code=$2,provider=$3,resolved_model=$4,usage=$5::jsonb WHERE id=$6 AND actor_staff_id=$7 AND status='running' RETURNING *",
      [
        status,
        code,
        ai.metadata?.provider ?? null,
        ai.metadata?.resolvedModel ?? null,
        JSON.stringify(ai.metadata?.usage ?? null),
        run.id,
        actor.staffId,
      ],
    );
    return { profile: null, tags: [], analysis: mapCrmAnalysisRun(failed ?? run, status) };
  }
  const [completed] = await queryRows(
    "SELECT * FROM crm_ai_analysis_runs WHERE id=$1 AND actor_staff_id=$2",
    [run.id, actor.staffId],
  );
  if (!completed) throw new Error("CRM_AI_RESULT_UNAVAILABLE");
  const output = completed.output as {
    profile: Record<string, unknown>;
    tags: Record<string, unknown>[];
  };
  return {
    profile: mapProfile(output.profile),
    tags: output.tags.map(mapTag),
    analysis: mapCrmAnalysisRun(completed),
  };
}

export async function fetchCrmAiProfile(input: { leadId?: string; contactId?: string }) {
  if (!input.leadId && !input.contactId) return { profile: null, tags: [] };

  const profiles = await queryRows(
    `SELECT p.*,to_jsonb(r) AS analysis_run,
       CASE WHEN r.id IS NOT NULL THEN ep_crm_analysis_source_revision(p.lead_id,$3) END AS current_source_fingerprint
     FROM crm_ai_profiles p LEFT JOIN crm_ai_analysis_runs r ON r.id=p.analysis_run_id
     WHERE ($1::uuid IS NULL OR p.lead_id = $1::uuid)
       AND ($2::uuid IS NULL OR p.contact_id = $2::uuid)
     ORDER BY p.updated_at DESC, p.created_at DESC
     LIMIT 1`,
    [input.leadId ?? null, input.contactId ?? null, process.env.WOZTELL_CHANNEL_ID || null],
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
  const [latestRun] = input.leadId
    ? await queryRows(
        "SELECT r.*,ep_crm_analysis_source_revision(r.lead_id,$2) AS current_source_fingerprint FROM crm_ai_analysis_runs r WHERE lead_id=$1 ORDER BY started_at DESC,id DESC LIMIT 1",
        [input.leadId, process.env.WOZTELL_CHANNEL_ID || null],
      )
    : [];

  return {
    profile: profiles[0] ? mapProfile(profiles[0]) : null,
    tags: tags.map(mapTag),
    analysis: latestRun
      ? mapCrmAnalysisRun(
          latestRun,
          latestRun.status === "completed" &&
            latestRun.current_source_fingerprint !== latestRun.source_fingerprint
            ? "stale"
            : undefined,
        )
      : profiles[0]?.analysis_run
        ? mapCrmAnalysisRun(
            profiles[0].analysis_run as Record<string, unknown>,
            profiles[0].current_source_fingerprint !==
              (profiles[0].analysis_run as Record<string, unknown>).source_fingerprint
              ? "stale"
              : undefined,
          )
        : undefined,
  };
}

export async function approveCrmAiTag(
  input: { tagId: string; staffId: string; approve: boolean },
  actor: StaffAccess,
) {
  const status = input.approve ? "approved" : "rejected";
  let rows: Record<string, unknown>[];
  try {
    const [, updated] = await getSql().transaction((tx) => [
      tx.query("SELECT ep_assert_crm_tag($1::uuid,$2::uuid,$3,$4,$5)", [
        input.tagId,
        actor.staffId,
        actor.authUserId,
        process.env.WOZTELL_CHANNEL_ID || null,
        input.approve,
      ]),
      tx.query(
        `UPDATE crm_ai_tags
     SET status = $1::crm_ai_tag_status,
         approved_by = $2,
         approved_at = CASE WHEN $1 = 'approved' THEN now() ELSE NULL END
     WHERE id = $3
     RETURNING *`,
        [status, actor.staffId, input.tagId],
      ),
    ]);
    rows = updated;
  } catch (error) {
    const code = crmAnalysisError(error);
    if (!code) throw error;
    throw Object.assign(
      new Error(
        code === "CRM_AI_STALE"
          ? "資料已更新，請重新分析後再確認標籤。"
          : "目前沒有權限處理此標籤。",
      ),
      { code },
    );
  }
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
       (l.source ~* '(^|[_ -])(test|synthetic|qa)([_ -]|$)' OR COALESCE(c.tags && ARRAY['test','synthetic','qa','測試'],false)
         OR COALESCE(l.note ~ '^測試記錄',false)) AS is_test,
       (c.normalized_phone ~ '^\\+?[0-9]{8,15}$') AS has_verified_contact,
       (l.source IN ('website','live_agent') OR EXISTS(SELECT 1 FROM whatsapp_conversations wc WHERE wc.contact_id=c.id AND wc.woztell_member_id IS NOT NULL AND wc.channel_id=$2)) AS source_verified,
       EXISTS(SELECT 1 FROM whatsapp_conversations wc WHERE wc.contact_id=c.id
         AND wc.woztell_member_id IS NOT NULL AND wc.channel_id=$2
         AND wc.last_inbound_at BETWEEN now()-interval '24 hours' AND now()) AS service_reply_allowed,
       (c.normalized_phone ~ '^\\+?[0-9]{8,15}$' AND c.opt_in_whatsapp AND NOT c.opted_out_whatsapp) AS marketing_eligible,
       EXTRACT(DAY FROM now() - COALESCE(MAX(a.created_at), l.updated_at, l.created_at))::int
         AS last_activity_days
     FROM crm_leads l
     LEFT JOIN crm_contacts c ON c.id = l.contact_id
     LEFT JOIN crm_activities a ON a.lead_id = l.id
     WHERE l.id = $1
     GROUP BY l.id, c.id
     LIMIT 1`,
    [leadId, process.env.WOZTELL_CHANNEL_ID || null],
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
    action_context: {
      isTest: row.is_test === true,
      hasVerifiedContact: row.has_verified_contact === true,
      sourceVerified: row.source_verified === true,
      serviceReplyAllowed: row.service_reply_allowed === true,
      marketingEligible: row.marketing_eligible === true,
    },
  };
}

async function writeLeadAnalysis(
  lead: LeadInput,
  values: ProfileValues,
  tags: TagValues[],
  run: CrmAnalysisRunRow,
  actor: StaffAccess,
  metadata?: { provider: string | null; resolvedModel: string | null; usage: unknown },
) {
  const sql = getSql();
  await sql.transaction((tx) => [
    tx.query(
      crmAnalysisGuard(run, lead.id, actor).statement,
      crmAnalysisGuard(run, lead.id, actor).params,
    ),
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
    tx.query(profileUpsertSql(), [...profileParams(lead, values), run.id]),
    tx.query(tagUpsertSql(), [lead.id, JSON.stringify(tags.map(tagRecord)), run.id]),
    tx.query(
      `UPDATE crm_ai_analysis_runs SET status='completed',result_kind=$1,validation_code=$2,provider=$3,resolved_model=$4,usage=$5::jsonb,completed_at=now(),
      output=jsonb_build_object('profile',(SELECT to_jsonb(p) FROM crm_ai_profiles p WHERE p.analysis_run_id=$6),
        'tags',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM crm_ai_tags t WHERE t.lead_id=$7),'[]'::jsonb)) WHERE id=$6 AND status='running'`,
      [
        values.result_kind,
        values.validation_code,
        metadata?.provider ?? null,
        metadata?.resolvedModel ?? null,
        JSON.stringify(metadata?.usage ?? null),
        run.id,
        lead.id,
      ],
    ),
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
    values.result_kind,
    values.action_type,
    values.validation_code,
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
        result_kind = $13,
        action_type = $14,
        validation_code = $15,
        analysis_version = 'crm-analysis-v2',
        analysis_run_id = $16::uuid,
        last_analyzed_at = now(),
        updated_at = now()
    WHERE lead_id = $1::uuid
    RETURNING *
  ),
  inserted AS (
    INSERT INTO crm_ai_profiles (
      contact_id, lead_id, intent, intent_confidence, budget_band, preferred_estates, urgency,
      timeline, language, lead_score, next_best_action, summary, generated_by, last_analyzed_at,
      updated_at, result_kind, action_type, validation_code, analysis_version, analysis_run_id
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
      now(), $13, $14, $15, 'crm-analysis-v2', $16::uuid
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
        reason = input.reason,
        analysis_run_id = $3::uuid
    FROM input
    WHERE existing.lead_id = input.lead_id
      AND existing.tag = input.tag
      AND existing.status NOT IN ('approved','rejected')
    RETURNING existing.*
  ),
  inserted AS (
    INSERT INTO crm_ai_tags (
      contact_id, lead_id, tag, category, safety_level, status, confidence, reason, created_by_ai, analysis_run_id
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
      true, $3::uuid
    FROM input
    WHERE NOT EXISTS (
      SELECT 1
      FROM crm_ai_tags existing
      WHERE existing.lead_id = input.lead_id
        AND existing.tag = input.tag
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

function tagCategory(tag: string) {
  return tag.split("_")[0]?.trim() || "general";
}

function clampConfidence(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
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
    analysis_run_id: stringOrNull(row.analysis_run_id),
    generated_by: stringOrNull(row.generated_by),
    result_kind: stringOrNull(row.result_kind),
    action_type: stringOrNull(row.action_type),
    validation_code: stringOrNull(row.validation_code),
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
