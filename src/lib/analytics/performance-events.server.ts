import "@tanstack/react-start/server-only";

import type { StaffAccess } from "../neon/auth.server.ts";
import { queryRows } from "../neon/db.server.ts";
import {
  buildRecordPerformanceEventQuery,
  validatePerformanceEvent,
} from "./performance-events.mjs";
import type {
  PerformanceEventInput,
  PerformanceEventQuality,
  PerformanceEventRecord,
} from "./performance-events.ts";

function requireAdmin(actor: StaffAccess) {
  if (!actor.roles.includes("admin")) throw new Response("Forbidden", { status: 403 });
}

/** Repair a missed projection from an authoritative source. Only trusted server workflows call this. */
export async function recordPerformanceEvent(
  event: PerformanceEventInput,
  actorOrSystem: { kind: "system" },
): Promise<PerformanceEventRecord> {
  if (actorOrSystem?.kind !== "system") throw new Response("Forbidden", { status: 403 });
  const parsed = validatePerformanceEvent(event);
  const { statement, params } = buildRecordPerformanceEventQuery(event);
  await queryRows(statement, params);
  const rows = await queryRows<PerformanceEventRecord>(
    "SELECT * FROM performance_event_records WHERE event_key=$1",
    [parsed.idempotencyKey],
  );
  const row = rows[0];
  if (!row || row.source !== event.source) {
    throw new Response("No verified performance source", { status: 409 });
  }
  for (const [claimed, actual] of [
    [event.inquiryId, row.inquiry_id],
    [event.leadId, row.lead_id],
    [event.transactionId, row.transaction_id],
    [event.staffId, row.staff_id],
    [event.branchIdAtEvent, row.branch_id_at_event],
    [event.policyVersion, row.policy_version],
  ]) {
    if (claimed !== undefined && claimed !== actual) {
      throw new Response("Performance source dimensions differ", { status: 409 });
    }
  }
  if (new Date(row.occurred_at).getTime() !== new Date(event.occurredAt).getTime()) {
    throw new Response("Performance source time differs", { status: 409 });
  }
  return row;
}

/** Explicit qualification evidence; stages alone do not prove a lead was qualified. */
export async function qualifyLeadForPerformance(
  input: { leadId: string; qualifiedAt: string; evidence: string },
  actor: StaffAccess,
): Promise<{ eventKey: string }> {
  if (!actor.roles.some((role) => role === "admin" || role === "manager")) {
    throw new Response("Forbidden", { status: 403 });
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.leadId) ||
    !Number.isFinite(Date.parse(input.qualifiedAt)) ||
    input.evidence.trim().length < 8
  ) {
    throw new Response("Invalid qualification", { status: 400 });
  }
  // Keep the current account, grant and source ownership stable through the immutable write.
  const rows = await queryRows<{ lead_id: string | null; actor_allowed: boolean }>(
    `WITH actor_row AS MATERIALIZED (
       SELECT id,branch_id FROM staff_users
       WHERE id=$4::uuid AND auth_user_id=$6 AND active FOR SHARE
     ), actor_roles AS MATERIALIZED (
       SELECT r.role FROM staff_roles r JOIN actor_row a ON a.id=r.staff_user_id
       WHERE r.role IN ('admin','manager') FOR SHARE OF r
     ), source_lead AS MATERIALIZED (
       SELECT id,assigned_agent_id FROM crm_leads
       WHERE id=$1::uuid AND stage IN ('contacted','viewing','negotiating','closed_won') FOR SHARE
     ), source_owner AS MATERIALIZED (
       SELECT branch_id FROM staff_users
       WHERE id=(SELECT assigned_agent_id FROM source_lead) FOR SHARE
     ), written AS (
       INSERT INTO crm_lead_qualifications(lead_id,qualified_at,evidence,qualified_by)
       SELECT l.id,$2::timestamptz,$3,a.id FROM source_lead l CROSS JOIN actor_row a
       WHERE EXISTS(SELECT 1 FROM actor_roles)
         AND (($5::boolean AND EXISTS(SELECT 1 FROM actor_roles WHERE role='admin'))
           OR (a.branch_id IS NOT NULL AND a.branch_id=(SELECT branch_id FROM source_owner)))
       ON CONFLICT DO NOTHING RETURNING lead_id
     ) SELECT (SELECT lead_id::text FROM written) AS lead_id,
       EXISTS(SELECT 1 FROM actor_roles) AS actor_allowed`,
    [
      input.leadId,
      input.qualifiedAt,
      input.evidence.trim(),
      actor.staffId,
      actor.roles.includes("admin"),
      actor.authUserId,
    ],
  );
  if (!rows[0]?.actor_allowed) throw new Response("Forbidden", { status: 403 });
  if (!rows[0].lead_id)
    throw new Response("Lead is outside scope or already qualified", { status: 409 });
  return { eventKey: "lead_qualified:" + rows[0].lead_id };
}

/** Append a reasoned quality decision. The report view reads the latest revision. */
export async function revisePerformanceEventQuality(
  input: { eventKey: string; quality: PerformanceEventQuality; reason: string },
  actor: StaffAccess,
): Promise<{ eventKey: string; affectedHkDay: string }> {
  requireAdmin(actor);
  if (
    !/^(lead_qualified|viewing_completed|assignment_confirmed|human_response|deal_confirmed|deal_cancelled):[0-9a-f:-]+$/i.test(
      input.eventKey,
    ) ||
    !["production", "test", "spam", "unknown"].includes(input.quality) ||
    input.reason.trim().length < 8
  ) {
    throw new Response("Invalid quality correction", { status: 400 });
  }
  const rows = await queryRows<{ event_key: string; affected_hk_day: string }>(
    `WITH selected AS (
       SELECT event_key,occurred_at FROM performance_event_records WHERE event_key=$1
     ), written AS (
       INSERT INTO performance_event_quality_revisions(event_key,quality,reason,changed_by)
       SELECT event_key,$2,$3,$4::uuid FROM selected
       RETURNING event_key
     )
     SELECT written.event_key,(selected.occurred_at AT TIME ZONE 'Asia/Hong_Kong')::date::text AS affected_hk_day
     FROM written JOIN selected USING(event_key)`,
    [input.eventKey, input.quality, input.reason.trim(), actor.staffId],
  );
  if (!rows[0]) throw new Response("Performance event not found", { status: 404 });
  return { eventKey: rows[0].event_key, affectedHkDay: rows[0].affected_hk_day };
}
