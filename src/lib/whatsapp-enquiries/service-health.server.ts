import "@tanstack/react-start/server-only";
import { queryRows } from "../neon/db.server.ts";
import type { StaffAccess } from "../neon/auth.server";
import type { StaffWhatsappReadiness } from "../neon/whatsapp-readiness.types.ts";
import {
  currentWhatsappReadinessRuntime,
  listWhatsappStaffReadiness,
} from "../neon/whatsapp-readiness.server.ts";
import { assessWhatsappRuntime } from "../neon/whatsapp-readiness-policy.ts";
import { dueWorkHealth, summarizeStaffCoverage } from "./service-health-model.ts";

type Actor = Pick<StaffAccess, "staffId" | "roles">;
type Query = typeof queryRows;
const iso = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);
const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);

export async function getServiceHealth(
  actor: Actor,
  query: Query = queryRows,
  options: { readiness?: StaffWhatsappReadiness[] } = {},
) {
  if (!actor.roles.some((role) => role === "admin" || role === "manager"))
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
  const mode = process.env.EP_WA_ENQUIRY_MODE ?? "off";
  const serviceEnabled = process.env.EP_WA_SERVICE_AUTOMATION_ENABLED === "true";
  const current = currentWhatsappReadinessRuntime();
  const runtime = assessWhatsappRuntime({
    mode,
    serviceEnabled,
    channelId: current.channelId,
    inboxProviderVerified: current.inboxProviderVerified,
    staffTransportVerified: current.staffTransportVerified,
    staffWhatsappEnabled: current.staffWhatsAppEnabled && current.notificationsEnabled,
    checkedAt: new Date().toISOString(),
  });
  const emptyCounts = {
    opens: 0,
    enquiries: 0,
    attributable: 0,
    confirmedAssignments: 0,
    humanResponses: 0,
    surveyAnswers: 0,
  };
  const base = {
    schemaAvailable: false,
    mode,
    serviceEnabled,
    runtime,
    policy: {
      version: null as number | null,
      purpose: null as string | null,
      timezone: null as string | null,
      workerLagSeconds: null as number | null,
    },
    coverage: null as ReturnType<typeof summarizeStaffCoverage> | null,
    heartbeatAt: null as string | null,
    oldestDueAt: null as string | null,
    nextWakeAt: null as string | null,
    lastSuccessAt: null as string | null,
    overdueJobs: 0,
    expiredLeases: 0,
    routingUnknown: 0,
    sendingUnknown: 0,
    blockedSurveys: 0,
    missingApproval: true,
    counts: emptyCounts,
    measurement: {
      timezone: "Asia/Hong_Kong" as const,
      humanResponseSample: 0,
      exclusions: ["spam", "test attempts", "bot replies", "unlinked conversations"],
    },
    reasons: [] as string[],
  };
  const [schema] = await query(
    `SELECT to_regclass('whatsapp_service_actions') IS NOT NULL AND to_regclass('whatsapp_service_policies') IS NOT NULL AND to_regclass('whatsapp_service_surveys') IS NOT NULL AND to_regclass('whatsapp_assignment_requests') IS NOT NULL AND to_regclass('whatsapp_staff_channels') IS NOT NULL AND to_regclass('staff_notification_endpoints') IS NOT NULL AND to_regclass('ops_jobs') IS NOT NULL AS available, to_regclass('whatsapp_service_worker_heartbeats') IS NOT NULL AS heartbeat`,
  );
  if (schema?.available !== true || schema?.heartbeat !== true)
    return { ...base, reasons: ["SERVICE_SCHEMA_UNAVAILABLE"] };
  const [policyRow] = await query(
    `SELECT version,rules FROM whatsapp_service_policies WHERE status='approved' AND effective_at<=now() ORDER BY effective_at DESC,version DESC LIMIT 1`,
  );
  const rules =
    policyRow?.rules && typeof policyRow.rules === "object"
      ? (policyRow.rules as Record<string, unknown>)
      : {};
  const lag =
    Number.isInteger(rules.workerLagSeconds) && Number(rules.workerLagSeconds) > 0
      ? Number(rules.workerLagSeconds)
      : null;
  const policy = {
    version: policyRow ? num(policyRow.version) : null,
    purpose: typeof rules.purpose === "string" ? rules.purpose : null,
    timezone: typeof rules.timezone === "string" ? rules.timezone : null,
    workerLagSeconds: lag,
  };
  const [row] = await query(`SELECT
    (SELECT min(run_after) FROM ops_jobs WHERE status='queued' AND run_after<=now() AND job_type LIKE 'woztell.%') AS oldest_due,
    (SELECT min(run_after) FROM ops_jobs WHERE status='queued' AND run_after>now() AND job_type LIKE 'woztell.%') AS next_wake,
    (SELECT max(updated_at) FROM ops_jobs WHERE status='succeeded' AND job_type LIKE 'woztell.%') AS last_success,
    (SELECT count(*)::int FROM ops_jobs WHERE status='queued' AND run_after<=now() AND job_type LIKE 'woztell.%') AS overdue_jobs,
    (SELECT count(*)::int FROM ops_jobs WHERE status='running' AND lease_expires_at<now() AND job_type LIKE 'woztell.%') AS expired_leases,
    (SELECT count(*)::int FROM whatsapp_assignment_requests WHERE state='unknown') AS routing_unknown,
    (SELECT count(*)::int FROM whatsapp_service_actions WHERE state='unknown') AS sending_unknown,
    (SELECT count(*)::int FROM whatsapp_service_actions WHERE purpose='survey' AND state='blocked') AS blocked_surveys,
    (SELECT count(*)::int FROM whatsapp_link_opens) AS opens,
    (SELECT count(*)::int FROM inquiries WHERE source='whatsapp' AND conversation_id IS NOT NULL AND status NOT IN ('spam','test')) AS enquiries,
    (SELECT count(*)::int FROM inquiries WHERE source='whatsapp' AND attribution_method='reference' AND status NOT IN ('spam','test')) AS attributable,
    (SELECT count(*)::int FROM whatsapp_conversations WHERE confirmed_staff_id IS NOT NULL) AS confirmed_assignments,
    (SELECT count(*)::int FROM inquiries WHERE source='whatsapp' AND intake_message_id IS NOT NULL AND first_human_response_at IS NOT NULL AND first_human_response_staff_id IS NOT NULL AND status NOT IN ('spam','test')) AS human_responses,
    (SELECT count(*)::int FROM whatsapp_service_surveys WHERE answer IS NOT NULL) AS survey_answers`);
  const [beat] = await query(
    "SELECT max(seen_at) AS seen_at FROM whatsapp_service_worker_heartbeats",
  );
  const eligibleRows = await query(
    `SELECT s.id::text AS id FROM staff_users s WHERE s.active AND EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=s.id AND (r.role IN ('admin','manager') OR (r.role='agent' AND s.branch_id IS NOT NULL)))`,
  );
  const reasons: string[] = [];
  let coverage = null as ReturnType<typeof summarizeStaffCoverage> | null;
  try {
    const readiness =
      options.readiness ?? (query === queryRows ? await listWhatsappStaffReadiness(actor) : null);
    if (readiness)
      coverage = summarizeStaffCoverage(
        eligibleRows.map((item) => String(item.id)),
        readiness,
        `active intake roles, assigned agent branch, channel ${current.channelId ?? "unconfigured"}`,
      );
    else reasons.push("STAFF_READINESS_UNAVAILABLE");
  } catch {
    reasons.push("STAFF_READINESS_UNAVAILABLE");
  }
  const oldestDueAt = iso(row?.oldest_due),
    heartbeatAt = iso(beat?.seen_at);
  const overdueJobs = num(row?.overdue_jobs),
    expiredLeases = num(row?.expired_leases);
  reasons.push(
    ...dueWorkHealth({
      now: new Date().toISOString(),
      oldestDueAt,
      overdueJobs,
      expiredLeases,
      heartbeatAt,
      lagSeconds: lag,
    }),
  );
  if (!policyRow) reasons.push("SERVICE_POLICY_UNAPPROVED");
  if (num(row?.routing_unknown)) reasons.push("ASSIGNMENT_RECONCILIATION_REQUIRED");
  if (num(row?.sending_unknown)) reasons.push("SEND_RECONCILIATION_REQUIRED");
  if (serviceEnabled && mode !== "active") reasons.push("SERVICE_CONFIG_MODE_MISMATCH");
  const counts = {
    opens: num(row?.opens),
    enquiries: num(row?.enquiries),
    attributable: num(row?.attributable),
    confirmedAssignments: num(row?.confirmed_assignments),
    humanResponses: num(row?.human_responses),
    surveyAnswers: num(row?.survey_answers),
  };
  return {
    ...base,
    schemaAvailable: true,
    policy,
    coverage,
    heartbeatAt,
    oldestDueAt,
    nextWakeAt: iso(row?.next_wake),
    lastSuccessAt: iso(row?.last_success),
    overdueJobs,
    expiredLeases,
    routingUnknown: num(row?.routing_unknown),
    sendingUnknown: num(row?.sending_unknown),
    blockedSurveys: num(row?.blocked_surveys),
    missingApproval: !policyRow,
    counts,
    measurement: { ...base.measurement, humanResponseSample: counts.humanResponses },
    reasons,
  };
}
