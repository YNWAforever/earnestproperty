import "@tanstack/react-start/server-only";
import { z } from "zod";
import { queryRows, transactionRows } from "../neon/db.server.ts";
import type { StaffAccess } from "../neon/auth.server";
import {
  unresolvedServicePolicy,
  draftServicePolicy,
  type ServicePolicy,
} from "./service-policy.ts";
export const serviceRulesSchema = z
  .object({
    timezone: z.string().max(100).nullable(),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).nullable(),
    holidays: z
      .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .max(366)
      .nullable(),
    openMinute: z.number().int().min(0).max(1439).nullable(),
    closeMinute: z.number().int().min(1).max(1440).nullable(),
    durationMode: z.enum(["elapsed", "opening"]).nullable(),
    beforeOpen: z.enum(["overnight", "daytime"]).nullable(),
    atOpen: z.enum(["daytime", "overnight"]).nullable(),
    atClose: z.enum(["daytime", "overnight"]).nullable(),
    crossClosing: z.enum(["elapsed", "opening"]).nullable(),
    reception: z.enum(["excluded", "sales"]).nullable(),
    suppressSurveyAfterHuman: z.boolean().nullable(),
    freshnessSeconds: z.number().int().positive().max(31622400).nullable(),
    surveyExpirySeconds: z.number().int().positive().max(31622400).nullable(),
    workerLagSeconds: z.number().int().positive().max(86400).nullable(),
    managerStaffId: z.string().uuid().nullable(),
  })
  .strict();
const draftSchema = z
  .object({
    rules: serviceRulesSchema,
    afterHoursCopy: z.string().trim().max(2000).nullable(),
    copyVersion: z.string().trim().min(1).max(80).nullable(),
  })
  .strict();
async function authorize(actor: Pick<StaffAccess, "staffId" | "roles">, query: typeof queryRows) {
  if (!actor.roles.some((r) => r === "admin" || r === "manager"))
    throw new Response("Forbidden", { status: 403 });
  if (
    !(
      await query(
        `SELECT s.id FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$1::uuid AND s.active AND r.role IN ('admin','manager') LIMIT 1`,
        [actor.staffId],
      )
    ).length
  )
    throw new Response("Forbidden", { status: 403 });
}
function policyDto(row: Record<string, unknown>): ServicePolicy {
  const { afterHoursCopy, ...rules } = row.rules as Record<string, unknown>;
  return {
    id: String(row.id),
    version: Number(row.version),
    status: row.status as ServicePolicy["status"],
    approvedBy: row.approved_by ? String(row.approved_by) : null,
    effectiveAt: row.effective_at ? new Date(String(row.effective_at)).toISOString() : null,
    copyVersion: row.copy_version ? String(row.copy_version) : null,
    copy: { afterHours: typeof afterHoursCopy === "string" ? afterHoursCopy : null },
    rules: serviceRulesSchema.parse({ ...draftServicePolicy().rules, ...rules }),
  };
}
export async function loadServicePolicy(
  id: string,
  query = queryRows,
): Promise<ServicePolicy | null> {
  z.string().uuid().parse(id);
  const [r] = await query("SELECT * FROM whatsapp_service_policies WHERE id=$1::uuid", [id]);
  return r ? policyDto(r) : null;
}
export async function listServicePolicies(
  actor: Pick<StaffAccess, "staffId" | "roles">,
  query = queryRows,
) {
  await authorize(actor, query);
  return (
    await query("SELECT * FROM whatsapp_service_policies ORDER BY version DESC,id DESC LIMIT 100")
  ).map(policyDto);
}
export async function saveServicePolicyDraft(
  value: unknown,
  actor: Pick<StaffAccess, "staffId" | "roles">,
  query = queryRows,
) {
  await authorize(actor, query);
  const input = draftSchema.parse(value);
  const [row] = await query(
    `WITH inserted AS (INSERT INTO whatsapp_service_policies(version,status,rules,copy_version) SELECT COALESCE(max(version),0)+1,'draft',$1::jsonb,$2 FROM whatsapp_service_policies RETURNING *) , audit AS (INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata) SELECT $3::uuid,'whatsapp.policy.draft','service_policy',id,'{}'::jsonb FROM inserted RETURNING id) SELECT * FROM inserted`,
    [
      JSON.stringify({ ...input.rules, afterHoursCopy: input.afterHoursCopy }),
      input.copyVersion,
      actor.staffId,
    ],
  );
  return policyDto(row);
}
export async function approveServicePolicy(
  value: unknown,
  actor: Pick<StaffAccess, "staffId" | "roles">,
  ports = { query: queryRows, transaction: transactionRows },
) {
  await authorize(actor, ports.query);
  const input = z
    .object({
      id: z.string().uuid(),
      version: z.number().int().positive(),
      effectiveAt: z.string().datetime({ offset: true }),
      decisionEvidenceRef: z.string().trim().min(1).max(160),
    })
    .strict()
    .parse(value);
  const policy = await loadServicePolicy(input.id, ports.query);
  if (!policy || policy.status !== "draft" || policy.version !== input.version)
    throw new Response("POLICY_VERSION_CONFLICT", { status: 409 });
  const reviewed = {
    ...policy,
    status: "approved" as const,
    approvedBy: actor.staffId,
    effectiveAt: input.effectiveAt,
  };
  const missing = unresolvedServicePolicy(reviewed);
  if (missing.length) throw new Response(missing.join(","), { status: 400 });
  const [manager] = await ports.query(
    `SELECT s.id FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$1::uuid AND s.active AND r.role='manager' LIMIT 1`,
    [policy.rules.managerStaffId],
  );
  if (!manager) throw new Response("POLICY_MANAGER_UNVERIFIED", { status: 409 });
  const result = await ports.transaction([
    {
      statement: "SELECT id FROM whatsapp_service_policies WHERE id=$1::uuid FOR UPDATE",
      params: [input.id],
    },
    {
      statement: `WITH approved AS (UPDATE whatsapp_service_policies SET status='approved',approved_by=$3::uuid,effective_at=$4::timestamptz WHERE id=$1::uuid AND version=$2 AND status='draft' AND rules=$5::jsonb RETURNING id), audit AS (INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata) SELECT $3::uuid,'whatsapp.policy.approve','service_policy',id,jsonb_build_object('decisionEvidenceRef',$6::text) FROM approved RETURNING id) SELECT id FROM approved`,
      params: [
        input.id,
        input.version,
        actor.staffId,
        input.effectiveAt,
        JSON.stringify({ ...policy.rules, afterHoursCopy: policy.copy.afterHours }),
        input.decisionEvidenceRef,
      ],
    },
  ]);
  if (!result[1]?.length) throw new Response("POLICY_VERSION_CONFLICT", { status: 409 });
  return { ok: true };
}
