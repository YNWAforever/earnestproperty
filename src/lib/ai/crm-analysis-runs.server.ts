import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { queryRows, getSql, dateOrNull, stringOrEmpty, stringOrNull } from "../neon/db.server";
import type { StaffAccess } from "../neon/auth.server";
import type { CrmAnalysisRunMeta } from "./ai-types";
export type CrmAnalysisRunRow = Record<string, unknown> & {
  id: string;
  source_fingerprint: string;
  status: string;
  started: boolean;
};
export async function beginCrmAnalysisRun(
  leadId: string,
  actor: StaffAccess,
  requestId?: string,
): Promise<CrmAnalysisRunRow> {
  const runId = z
    .string()
    .uuid()
    .parse(requestId ?? randomUUID());
  const rows = await queryRows<{ run: CrmAnalysisRunRow }>(
    "SELECT ep_begin_crm_analysis_run($1::uuid,$2::uuid,$3::uuid,$4,$5) AS run",
    [runId, leadId, actor.staffId, actor.authUserId, process.env.WOZTELL_CHANNEL_ID || null],
  );
  if (!rows[0]?.run) throw Object.assign(new Error("CRM_AI_DENIED"), { code: "CRM_AI_DENIED" });
  return rows[0].run;
}
export function crmAnalysisGuard(run: CrmAnalysisRunRow, leadId: string, actor: StaffAccess) {
  return {
    statement: "SELECT ep_assert_crm_analysis_run($1::uuid,$2::uuid,$3::uuid,$4,$5)",
    params: [
      run.id,
      leadId,
      actor.staffId,
      actor.authUserId,
      process.env.WOZTELL_CHANNEL_ID || null,
    ],
  };
}
export function crmAnalysisError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : "";
  const code = message.match(/CRM_AI_(DENIED|STALE|CANCELLED)/)?.[0];
  if (code) return code;
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    ["40001", "40P01"].includes(String(error.code))
  )
    return "CRM_AI_STALE";
  return null;
}

export async function cancelCrmAnalysisRun(leadId: string, runId: string, actor: StaffAccess) {
  z.string().uuid().parse(runId);
  const [, rows] = await getSql().transaction((tx) => [
    tx.query("SELECT ep_assert_crm_analysis_snapshot($1::uuid,$2::uuid,$3,$4)", [
      leadId,
      actor.staffId,
      actor.authUserId,
      process.env.WOZTELL_CHANNEL_ID || null,
    ]),
    tx.query(
      `INSERT INTO crm_ai_analysis_runs(id,lead_id,actor_staff_id,source_fingerprint,prompt_version,schema_version,status,completed_at,validation_code)
      VALUES($1,$2,$3,ep_crm_analysis_source_revision($2,$4),'crm-analysis-20261003','crm-analysis-v2','cancelled',now(),'CANCELLED_BY_ACTOR')
      ON CONFLICT(id) DO UPDATE SET status=CASE WHEN crm_ai_analysis_runs.status='running' THEN 'cancelled' ELSE crm_ai_analysis_runs.status END,
        completed_at=COALESCE(crm_ai_analysis_runs.completed_at,now()),validation_code=CASE WHEN crm_ai_analysis_runs.status='running' THEN 'CANCELLED_BY_ACTOR' ELSE crm_ai_analysis_runs.validation_code END
      WHERE crm_ai_analysis_runs.actor_staff_id=$3 AND crm_ai_analysis_runs.lead_id=$2 RETURNING *`,
      [runId, leadId, actor.staffId, process.env.WOZTELL_CHANNEL_ID || null],
    ),
  ]);
  if (!rows[0]) throw Object.assign(new Error("CRM_AI_DENIED"), { code: "CRM_AI_DENIED" });
  return mapCrmAnalysisRun(rows[0]);
}
export function mapCrmAnalysisRun(
  row: Record<string, unknown>,
  observedStatus?: string,
): CrmAnalysisRunMeta {
  const stored = stringOrEmpty(row.status);
  const status = observedStatus ?? (stored === "running" ? "pending" : stored);
  return {
    runId: stringOrEmpty(row.id),
    actorStaffId: stringOrEmpty(row.actor_staff_id),
    sourceFingerprint: stringOrEmpty(row.source_fingerprint),
    promptVersion: stringOrEmpty(row.prompt_version),
    schemaVersion: stringOrEmpty(row.schema_version),
    status: status as CrmAnalysisRunMeta["status"],
    resultKind: stringOrEmpty(row.result_kind) as CrmAnalysisRunMeta["resultKind"],
    provider: stringOrNull(row.provider),
    resolvedModel: stringOrNull(row.resolved_model),
    startedAt: dateOrNull(row.started_at) ?? "",
    completedAt: dateOrNull(row.completed_at),
    validationCode: stringOrNull(row.validation_code),
    usage: (row.usage ?? null) as CrmAnalysisRunMeta["usage"],
  };
}
