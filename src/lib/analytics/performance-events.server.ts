import "@tanstack/react-start/server-only";

import type { StaffAccess } from "../neon/auth.server.ts";
import { queryRows, transactionRows } from "../neon/db.server.ts";
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
  if (rows[0].lead_id) return { eventKey: "lead_qualified:" + rows[0].lead_id };
  // A conflict can become visible only after the insert's statement snapshot.
  // Read the original immutable request using a fresh snapshot and current scope.
  const replay = await queryRows<{ lead_id: string | null; actor_allowed: boolean }>(
    `WITH actor_row AS MATERIALIZED (
       SELECT id,branch_id FROM staff_users
       WHERE id=$4::uuid AND auth_user_id=$6 AND active FOR SHARE
     ), actor_roles AS MATERIALIZED (
       SELECT r.role FROM staff_roles r JOIN actor_row a ON a.id=r.staff_user_id
       WHERE r.role IN ('admin','manager') FOR SHARE OF r
     ), source_lead AS MATERIALIZED (
       SELECT id,assigned_agent_id FROM crm_leads WHERE id=$1::uuid FOR SHARE
     ), source_owner AS MATERIALIZED (
       SELECT branch_id FROM staff_users
       WHERE id=(SELECT assigned_agent_id FROM source_lead) FOR SHARE
     ), original AS (
       SELECT q.lead_id FROM crm_lead_qualifications q
       JOIN source_lead l ON l.id=q.lead_id CROSS JOIN actor_row a
       JOIN performance_events e ON e.lead_id=l.id
         AND e.event_key='lead_qualified:'||l.id::text AND e.source='crm_lead:'||l.id::text
       WHERE q.qualified_by=a.id AND q.qualified_at=$2::timestamptz AND q.evidence=$3
         AND EXISTS(SELECT 1 FROM actor_roles)
         AND (($5::boolean AND EXISTS(SELECT 1 FROM actor_roles WHERE role='admin'))
           OR (a.branch_id IS NOT NULL AND a.branch_id=(SELECT branch_id FROM source_owner)))
     ) SELECT (SELECT lead_id::text FROM original) AS lead_id,
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
  if (!replay[0]?.actor_allowed) throw new Response("Forbidden", { status: 403 });
  if (!replay[0].lead_id)
    throw new Response("Lead is outside scope or has a different qualification", { status: 409 });
  return { eventKey: "lead_qualified:" + replay[0].lead_id };
}

/** Serialize quality decisions on their source, then read a fresh statement snapshot. */
export async function reviseSourceQuality(
  kind: "inquiry" | "event",
  sourceKey: string,
  input: { quality: PerformanceEventQuality; reason: string; expectedRevisionId: string | null },
  actor: StaffAccess,
): Promise<{ sourceKey: string; affectedHkDay: string }> {
  requireAdmin(actor);
  const revision = input.expectedRevisionId;
  if (
    !["production", "test", "spam", "unknown"].includes(input.quality) ||
    typeof input.reason !== "string" ||
    input.reason.trim().length < 8 ||
    (revision !== null &&
      (typeof revision !== "string" ||
        !/^[1-9][0-9]{0,18}$/.test(revision) ||
        BigInt(revision) > 9223372036854775807n))
  )
    throw new Response("Invalid quality correction", { status: 400 });
  // These identifiers are selected only by trusted server callers, never request strings.
  const inquiry = kind === "inquiry";
  const table = inquiry ? "inquiry_quality_revisions" : "performance_event_quality_revisions";
  const column = inquiry ? "inquiry_id" : "event_key";
  const target = inquiry ? "$1::uuid" : "$1::text";
  const actorGuard = `actor_row AS MATERIALIZED (
    SELECT id FROM staff_users WHERE id=$4::uuid AND auth_user_id=$5 AND active FOR SHARE
  ), actor_grant AS MATERIALIZED (
    SELECT r.staff_user_id FROM staff_roles r JOIN actor_row a ON a.id=r.staff_user_id
    WHERE r.role='admin' FOR SHARE OF r
  )`;
  const results = await transactionRows(
    [
      {
        statement: `WITH actor_row AS MATERIALIZED (
        SELECT id FROM staff_users WHERE id=$2::uuid AND auth_user_id=$3 AND active FOR SHARE
      ), actor_grant AS MATERIALIZED (
        SELECT r.staff_user_id FROM staff_roles r JOIN actor_row a ON a.id=r.staff_user_id
        WHERE r.role='admin' FOR SHARE OF r
      ) SELECT ${inquiry ? "id" : "event_key"} FROM ${inquiry ? "inquiries" : "performance_events"}
        WHERE ${inquiry ? "id" : "event_key"}=${target}
          AND EXISTS(SELECT 1 FROM actor_grant) FOR UPDATE`,
        params: [sourceKey, actor.staffId, actor.authUserId],
      },
      {
        // The preceding lock can wait. ReadCommitted gives this statement a new snapshot
        // after that wait; a lock inside this same CTE would retain the stale snapshot.
        statement: `WITH ${actorGuard}, selected AS MATERIALIZED (
        SELECT ${inquiry ? "id::text" : "event_key"} AS source_key,
          ${inquiry ? "created_at" : "occurred_at"} AS source_time
        FROM ${inquiry ? "inquiries" : "performance_event_records"}
        WHERE ${inquiry ? "id" : "event_key"}=${target}
      ), latest AS MATERIALIZED (
        SELECT id,quality,reason,changed_by FROM ${table}
        WHERE ${column}=${target} ORDER BY id DESC LIMIT 1
      ), valid_base AS MATERIALIZED (
        SELECT $6::bigint IS NULL OR EXISTS(
          SELECT 1 FROM ${table} WHERE ${column}=${target} AND id=$6::bigint
        ) AS valid
      ), successor AS MATERIALIZED (
        SELECT quality,reason,changed_by FROM ${table}
        WHERE ${column}=${target} AND ($6::bigint IS NULL OR id>$6::bigint)
        ORDER BY id LIMIT 1
      ), accepted AS MATERIALIZED (
        SELECT s.source_key FROM selected s CROSS JOIN actor_grant a
        WHERE (SELECT valid FROM valid_base) AND (
          EXISTS(SELECT 1 FROM successor WHERE changed_by=a.staff_user_id AND quality=$2 AND reason=$3)
          OR EXISTS(SELECT 1 FROM latest WHERE id=$6::bigint AND changed_by=a.staff_user_id
            AND quality=$2 AND reason=$3)
        )
      ), written AS (
        INSERT INTO ${table}(${column},quality,reason,changed_by)
        SELECT ${inquiry ? "s.source_key::uuid" : "s.source_key"},$2,$3,a.staff_user_id
        FROM selected s CROSS JOIN actor_grant a
        WHERE (SELECT valid FROM valid_base)
          AND (SELECT id FROM latest) IS NOT DISTINCT FROM $6::bigint
          AND NOT EXISTS(SELECT 1 FROM accepted)
        RETURNING ${column}::text AS source_key
      ) SELECT COALESCE((SELECT source_key FROM written),(SELECT source_key FROM accepted)) AS source_key,
        (SELECT (source_time AT TIME ZONE 'Asia/Hong_Kong')::date::text FROM selected) AS affected_hk_day,
        EXISTS(SELECT 1 FROM selected) AS source_exists,
        EXISTS(SELECT 1 FROM actor_grant) AS actor_allowed`,
        params: [
          sourceKey,
          input.quality,
          input.reason.trim(),
          actor.staffId,
          actor.authUserId,
          revision,
        ],
      },
    ],
    { isolationLevel: "ReadCommitted" },
  );
  const row = results[1]?.[0] as
    | {
        source_key: string | null;
        affected_hk_day: string | null;
        source_exists: boolean;
        actor_allowed: boolean;
      }
    | undefined;
  if (!row?.actor_allowed) throw new Response("Forbidden", { status: 403 });
  if (!row.source_exists) throw new Response("Quality source not found", { status: 404 });
  if (!row.source_key || !row.affected_hk_day)
    throw new Response("Quality snapshot differs; reload the source", { status: 409 });
  return { sourceKey: row.source_key, affectedHkDay: row.affected_hk_day };
}

/** Append a reasoned decision, or acknowledge its exact original immutable successor. */
export async function revisePerformanceEventQuality(
  input: {
    eventKey: string;
    quality: PerformanceEventQuality;
    reason: string;
    expectedRevisionId: string | null;
  },
  actor: StaffAccess,
): Promise<{ eventKey: string; affectedHkDay: string }> {
  requireAdmin(actor);
  if (
    typeof input.eventKey !== "string" ||
    !/^(lead_qualified|viewing_completed|assignment_confirmed|human_response|deal_confirmed|deal_cancelled):[0-9a-f:-]+$/i.test(
      input.eventKey,
    )
  )
    throw new Response("Invalid quality correction", { status: 400 });
  const decision = await reviseSourceQuality("event", input.eventKey, input, actor);
  return { eventKey: decision.sourceKey, affectedHkDay: decision.affectedHkDay };
}
