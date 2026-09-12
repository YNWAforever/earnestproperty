import "@tanstack/react-start/server-only";
import { queryRows } from "../neon/db.server.ts";
import type { StaffAccess } from "../neon/auth.server";
export type ServiceHealth = {
  schemaAvailable: boolean;
  mode: string;
  serviceEnabled: boolean;
  heartbeatAt: string | null;
  oldestDueAt: string | null;
  routingUnknown: number;
  sendingUnknown: number;
  blockedSurveys: number;
  unverifiedStaff: number;
  missingApproval: boolean;
  counts: {
    opens: number;
    enquiries: number;
    attributable: number;
    confirmedAssignments: number;
    humanResponses: number;
    surveyAnswers: number;
  };
  reasons: string[];
};
export async function getServiceHealth(
  actor: Pick<StaffAccess, "staffId" | "roles">,
  query = queryRows,
): Promise<ServiceHealth> {
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
  const base: ServiceHealth = {
    schemaAvailable: false,
    mode: process.env.EP_WA_ENQUIRY_MODE ?? "off",
    serviceEnabled: process.env.EP_WA_SERVICE_AUTOMATION_ENABLED === "true",
    heartbeatAt: null,
    oldestDueAt: null,
    routingUnknown: 0,
    sendingUnknown: 0,
    blockedSurveys: 0,
    unverifiedStaff: 0,
    missingApproval: true,
    counts: {
      opens: 0,
      enquiries: 0,
      attributable: 0,
      confirmedAssignments: 0,
      humanResponses: 0,
      surveyAnswers: 0,
    },
    reasons: [],
  };
  const [schema] = await query(
    `SELECT to_regclass('whatsapp_service_actions') IS NOT NULL AS available,to_regclass('whatsapp_service_worker_heartbeats') IS NOT NULL AS heartbeat`,
  );
  if (!schema?.available) return { ...base, reasons: ["SERVICE_SCHEMA_UNAVAILABLE"] };
  const [row] = await query(`SELECT
 (SELECT min(run_after) FROM ops_jobs WHERE status='queued' AND run_after<=now() AND (job_type LIKE 'woztell.enquiry.%' OR job_type='woztell.reply.deliver' AND payload_version=2)) AS oldest_due,
 (SELECT count(*)::int FROM whatsapp_assignment_requests WHERE state='unknown') AS routing_unknown,
 (SELECT count(*)::int FROM whatsapp_service_actions WHERE state='unknown') AS sending_unknown,
 (SELECT count(*)::int FROM whatsapp_service_actions WHERE purpose='survey' AND state='blocked') AS blocked_surveys,
 (SELECT count(*)::int FROM whatsapp_staff_channels WHERE NOT eligible OR verified_at IS NULL OR retired_at IS NOT NULL) AS unverified_staff,
 NOT EXISTS(SELECT 1 FROM whatsapp_service_policies WHERE status='approved' AND effective_at<=now()) AS missing_approval,
 (SELECT count(*)::int FROM whatsapp_link_opens) AS opens,
 (SELECT count(*)::int FROM inquiries WHERE source='whatsapp' AND conversation_id IS NOT NULL) AS enquiries,
 (SELECT count(*)::int FROM inquiries WHERE source='whatsapp' AND attribution_method='reference') AS attributable,
 (SELECT count(*)::int FROM whatsapp_conversations WHERE confirmed_staff_id IS NOT NULL) AS confirmed_assignments,
 (SELECT count(*)::int FROM inquiries WHERE source='whatsapp' AND first_human_response_at IS NOT NULL) AS human_responses,
 (SELECT count(*)::int FROM whatsapp_service_surveys WHERE answer IS NOT NULL) AS survey_answers`);
  const [beat] = schema.heartbeat
    ? await query("SELECT max(seen_at) AS seen_at FROM whatsapp_service_worker_heartbeats")
    : [];
  const reasons: string[] = [];
  if (!beat?.seen_at) reasons.push("SERVICE_WORKER_NOT_OBSERVED");
  if (row.missing_approval) reasons.push("SERVICE_POLICY_UNAPPROVED");
  if (Number(row.routing_unknown)) reasons.push("ASSIGNMENT_RECONCILIATION_REQUIRED");
  if (Number(row.sending_unknown)) reasons.push("SEND_RECONCILIATION_REQUIRED");
  return {
    ...base,
    schemaAvailable: true,
    heartbeatAt: beat?.seen_at ? new Date(String(beat.seen_at)).toISOString() : null,
    oldestDueAt: row.oldest_due ? new Date(String(row.oldest_due)).toISOString() : null,
    routingUnknown: Number(row.routing_unknown),
    sendingUnknown: Number(row.sending_unknown),
    blockedSurveys: Number(row.blocked_surveys),
    unverifiedStaff: Number(row.unverified_staff),
    missingApproval: row.missing_approval === true,
    counts: {
      opens: Number(row.opens),
      enquiries: Number(row.enquiries),
      attributable: Number(row.attributable),
      confirmedAssignments: Number(row.confirmed_assignments),
      humanResponses: Number(row.human_responses),
      surveyAnswers: Number(row.survey_answers),
    },
    reasons,
  };
}
