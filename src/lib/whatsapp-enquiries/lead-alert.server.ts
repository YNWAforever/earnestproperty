import "@tanstack/react-start/server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveSiteOrigin } from "../../../scripts/site-origin.mjs";
import { queryRows, transactionRows } from "../neon/db.server.ts";
import { LEAD_ALERT_JOB_TYPE, LEAD_ALERT_RECONCILE_JOB_TYPE } from "../neon/lead-alert-enqueue.js";
import { retryableJobError } from "../control-plane/job-handlers.server.ts";
import { createStaffWhatsAppTransport } from "../woztell/staff-whatsapp-transport.server.ts";
import { buildStaffTemplateResponse } from "../woztell/staff-alert-template.ts";
import {
  staffNotificationRuntime,
  type StaffNotificationRuntime,
  type StaffNotificationTransport,
} from "./staff-notifications.server.ts";

/**
 * FX-05b: one staff WhatsApp alert per new lead.
 *
 * Destinations are planned once (frozen) as `staff_notification_attempts` rows
 * keyed by `lead_id`, then each row is reserved queued → dispatching under the
 * job lease before the single provider call. An outcome that may have reached
 * the provider is never resent: a lost lease turns into `unknown`. Every
 * terminal state leaves a row, so nothing is silent in staff health.
 */
export const LEAD_ALERT_JOB = LEAD_ALERT_JOB_TYPE;
export const LEAD_ALERT_RECONCILE_JOB = LEAD_ALERT_RECONCILE_JOB_TYPE;

export type LeadAlertBlockReason =
  | "notifications_disabled"
  | "template_not_configured"
  | "channel_unverified"
  | "transport_capability_unverified"
  | "work_origin_unconfigured"
  | "lead_missing"
  | "no_destination"
  | "destination_is_customer"
  | "assigned_destination_unavailable"
  | "dispatch_eligibility_changed";

export type LeadAlertDeps = {
  query?: typeof queryRows;
  transaction?: typeof transactionRows;
  runtime?: () => StaffNotificationRuntime;
  transport?: () => StaffNotificationTransport;
};

type Summary = { accepted: number; unknown: number; blocked: number };
type SendResult = Awaited<ReturnType<NonNullable<StaffNotificationTransport["sendStaffWhatsApp"]>>>;

/** Lead alerts are gated by the one staff switch only; website leads are not
 * WhatsApp enquiries, so `EP_WA_ENQUIRY_MODE` / the activation do not apply. */
export function leadAlertRuntime(): StaffNotificationRuntime {
  return {
    ...staffNotificationRuntime(),
    enabled: process.env.EP_WA_STAFF_NOTIFICATIONS_ENABLED === "true",
  };
}

/** An endpoint a lead alert may use (aliases: ep endpoint, m mapping, s staff). */
const ENDPOINT_ELIGIBLE = `ep.transport='staff_whatsapp' AND ep.enabled AND ep.verified_at IS NOT NULL AND ep.permission_granted AND ep.retired_at IS NULL AND ep.quiet_hours_policy @> '{"approved":true,"allowAllHours":true}'::jsonb AND m.eligible AND m.verified_at IS NOT NULL AND m.retired_at IS NULL AND (ep.mapping_version IS NULL OR ep.mapping_version=m.version) AND s.active AND EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=s.id AND r.role IN ('admin','manager','agent'))`;
const ENDPOINT_JOINS = `JOIN staff_users s ON s.id=ep.staff_id JOIN whatsapp_staff_channels m ON m.staff_id=ep.staff_id AND m.channel_id=ep.channel_id`;
/** D-11: a staff destination is never a customer's WhatsApp member or phone.
 * One fragment for plan, claim and beforeSend. Phones compare by digits only: the
 * destination's digits (at least 8) against the customer's full digits, the last 8
 * digits, and 852 + the last 8 ("+852 9123 4567" = "85291234567" = "91234567"). */
const DEST_DIGITS = "regexp_replace(ep.destination_reference,'\\D','','g')";
const CUSTOMER_DIGITS = "regexp_replace(c.normalized_phone,'\\D','','g')";
const NOT_A_CUSTOMER = `NOT EXISTS(SELECT 1 FROM whatsapp_conversations w WHERE w.channel_id=ep.channel_id AND w.woztell_member_id=ep.destination_reference) AND NOT EXISTS(SELECT 1 FROM crm_contacts c WHERE c.whatsapp_member_id=ep.destination_reference OR c.normalized_phone=ep.destination_reference OR (length(${DEST_DIGITS})>=8 AND ${DEST_DIGITS} IN (${CUSTOMER_DIGITS},right(${CUSTOMER_DIGITS},8),'852'||right(${CUSTOMER_DIGITS},8))))`;
/** The attempt `t` still targets exactly the endpoint it froze. */
const SAME_ENDPOINT = `ep.id=t.endpoint_id AND ep.version=t.endpoint_version AND ep.destination_reference=t.destination_reference_snapshot AND ep.channel_id=t.channel_id_snapshot`;
const LEASE_IS_MINE = `j.status='running' AND j.lease_owner=$LEASE_OWNER AND j.lease_expires_at>now()`;
const leaseIsMine = (param: string) => LEASE_IS_MINE.replace("$LEASE_OWNER", param);

function attemptKey(parts: string[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function sourceLabel(lead: Record<string, unknown>) {
  if (lead.source === "website") return lead.property_id ? "物業查詢" : "網站查詢";
  return "新查詢";
}

/** Expired leases only become unknown; never an automatic resend. */
export async function reconcileLeadStaffAlert(leadId: string, query = queryRows) {
  return reconcile(leadId, query, null);
}

// `current`: the running job and this worker. A dispatching row of that same job
// can only come from an earlier lease (this run has not claimed yet), so its
// outcome is unknown even though the job is running again; the clause applies
// only while this worker holds the job's live lease. ops_jobs keeps no lease
// acquisition time (`updated_at` is not one), so the "not claimed yet" order is
// the guarantee: reconcile runs after checkpoint() and before any claim.
async function reconcile(
  leadId: string,
  query: typeof queryRows,
  current: { jobId: string; workerId: string } | null,
) {
  z.string().uuid().parse(leadId);
  const rows = await query(
    "UPDATE staff_notification_attempts t SET dispatch_state='unknown',safe_error='lease_expired_after_dispatch',updated_at=now() WHERE t.lead_id=$1::uuid AND t.dispatch_state='dispatching' AND (t.job_id IS NULL OR (t.job_id=$2::uuid AND EXISTS(SELECT 1 FROM ops_jobs o WHERE o.id=$2::uuid AND o.status='running' AND o.lease_owner=$3 AND o.lease_expires_at>now())) OR NOT EXISTS(SELECT 1 FROM ops_jobs j WHERE j.id=t.job_id AND j.status='running' AND j.lease_expires_at>now())) RETURNING id",
    [leadId, current?.jobId ?? null, current?.workerId ?? null],
  );
  return { unknown: rows.length };
}

export async function handleLeadStaffAlert(
  payload: { leadId: string },
  context: { jobId: string; workerId: string; checkpoint: () => Promise<void> },
  deps: LeadAlertDeps = {},
): Promise<{ summary: Summary }> {
  const leadId = z.string().uuid().parse(payload.leadId);
  const query = deps.query ?? queryRows;
  const transaction = deps.transaction ?? transactionRows;
  const runtimeOf = deps.runtime ?? leadAlertRuntime;
  const summary: Summary = { accepted: 0, unknown: 0, blocked: 0 };

  // Steps 1–2 run before any claim: a failure here leaves rows queued, so the
  // job may safely retry. Nothing after the first claim is ever retried.
  let runtime: StaffNotificationRuntime;
  let transport: StaffNotificationTransport | null = null;
  let lead: Record<string, unknown> | undefined;
  let origin: string | null;
  try {
    await context.checkpoint();
    summary.unknown += (await reconcile(leadId, query, context)).unknown;
    [lead] = await query(
      "SELECT l.id,l.source,l.property_id,c.name FROM crm_leads l LEFT JOIN crm_contacts c ON c.id=l.contact_id WHERE l.id=$1::uuid",
      [leadId],
    );
    // lead_missing: attempt.lead_id references crm_leads, so no row can be kept;
    // the log line (ids only) is its visible trace.
    if (!lead) {
      console.warn("[lead-alert] lead_missing", { leadId, jobId: context.jobId });
      return { summary: { ...summary, blocked: summary.blocked + 1 } };
    }
    runtime = runtimeOf();
    try {
      transport = (deps.transport ?? createStaffWhatsAppTransport)();
    } catch {
      transport = null;
    }
    origin = resolveSiteOrigin();
    const blocked: LeadAlertBlockReason | null = !runtime.enabled
      ? "notifications_disabled"
      : !runtime.template
        ? "template_not_configured"
        : !runtime.channelId || runtime.channelId !== process.env.WOZTELL_CHANNEL_ID
          ? "channel_unverified"
          : !transport?.verificationRef || !transport.sendStaffWhatsApp
            ? "transport_capability_unverified"
            : !origin?.startsWith("https://")
              ? "work_origin_unconfigured"
              : null;
    if (blocked) {
      const [, inserted, suppressed] = await transaction([
        { statement: "SELECT id FROM crm_leads WHERE id=$1::uuid FOR UPDATE", params: [leadId] },
        {
          statement:
            "INSERT INTO staff_notification_attempts(lead_id,transport,attempt_key,dispatch_state,safe_error,finished_at) SELECT $1::uuid,'staff_whatsapp',$2,'suppressed',$3,now() WHERE NOT EXISTS(SELECT 1 FROM staff_notification_attempts WHERE lead_id=$1::uuid) ON CONFLICT(attempt_key) DO NOTHING RETURNING id",
          params: [leadId, attemptKey([leadId, "blocked"]), blocked],
        },
        {
          // Frozen rows from an earlier run that can no longer be sent.
          statement:
            "UPDATE staff_notification_attempts SET dispatch_state='suppressed',safe_error=$2,finished_at=now(),updated_at=now() WHERE lead_id=$1::uuid AND dispatch_state='queued' RETURNING id",
          params: [leadId, blocked],
        },
      ]);
      summary.blocked += inserted.length + suppressed.length;
      return { summary };
    }
    await plan(leadId, runtime.channelId!, transaction, summary);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "JOB_OWNERSHIP_LOST"
    )
      throw error;
    throw retryableJobError(
      "LEAD_ALERT_PLAN_FAILED",
      "Lead alert planning failed; rows remain queued.",
    );
  }

  const template = buildStaffTemplateResponse(runtime.template!, {
    name: String(lead.name ?? ""),
    source: sourceLabel(lead),
    link: `${origin}/admin/leads?lead=${leadId}`,
  });
  const message = `新查詢：${sourceLabel(lead)}`; // evidence only; the template is always sent
  const queued = await query(
    "SELECT id FROM staff_notification_attempts WHERE lead_id=$1::uuid AND dispatch_state='queued' ORDER BY created_at,id",
    [leadId],
  );
  for (const attempt of queued) {
    await context.checkpoint();
    const claim = randomUUID();
    let claimed: Record<string, unknown>[][];
    try {
      claimed = await transaction([
        { statement: "SELECT id FROM crm_leads WHERE id=$1::uuid FOR UPDATE", params: [leadId] },
        {
          statement: "SELECT id FROM staff_notification_attempts WHERE id=$1::uuid FOR UPDATE",
          params: [attempt.id],
        },
        {
          statement: `UPDATE staff_notification_attempts t SET dispatch_state='dispatching',claim_id=$2::uuid,job_id=$3::uuid,dispatch_started_at=now(),updated_at=now() FROM staff_notification_endpoints ep ${ENDPOINT_JOINS}, ops_jobs j WHERE t.id=$1::uuid AND t.lead_id=$4::uuid AND t.dispatch_state='queued' AND ${SAME_ENDPOINT} AND ep.channel_id=$6 AND ${ENDPOINT_ELIGIBLE} AND ${NOT_A_CUSTOMER} AND j.id=$3::uuid AND ${leaseIsMine("$5")} RETURNING t.id,t.destination_reference_snapshot`,
          params: [attempt.id, claim, context.jobId, leadId, context.workerId, runtime.channelId],
        },
        {
          statement:
            "INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key) SELECT $3,1,jsonb_build_object('leadId',t.lead_id::text),'queued',3,j.lease_expires_at+interval '1 minute','lead-alert.reconcile:'||t.id FROM staff_notification_attempts t JOIN ops_jobs j ON j.id=t.job_id WHERE t.id=$1::uuid AND t.claim_id=$2::uuid ON CONFLICT(idempotency_key) DO NOTHING",
          params: [attempt.id, claim, LEAD_ALERT_RECONCILE_JOB],
        },
      ]);
    } catch {
      // The claim may or may not have committed. Retrying is safe: the next run
      // reconciles a committed-but-unacknowledged dispatch to unknown, never resends.
      throw retryableJobError(
        "LEAD_ALERT_CLAIM_FAILED",
        "Lead alert claim failed; retry reconciles it.",
      );
    }
    const [reserved] = claimed[2] ?? [];
    if (!reserved) {
      // Not claimable while the lease is still ours: the destination changed.
      // Without the lease the row stays queued for the worker that holds it.
      const suppressed = await query(
        `UPDATE staff_notification_attempts t SET dispatch_state='suppressed',safe_error='dispatch_eligibility_changed',finished_at=now(),updated_at=now() WHERE t.id=$1::uuid AND t.dispatch_state='queued' AND EXISTS(SELECT 1 FROM ops_jobs j WHERE j.id=$2::uuid AND ${leaseIsMine("$3")}) RETURNING id`,
        [attempt.id, context.jobId, context.workerId],
      );
      summary.blocked += suppressed.length;
      continue;
    }

    let boundaryFailed = false;
    let boundaryPassed = false;
    const beforeSend = async () => {
      try {
        await context.checkpoint();
        const live = runtimeOf();
        if (!live.enabled || !live.template || live.channelId !== runtime.channelId)
          throw new Error("dispatch_disabled");
        const [valid] = await query(
          `SELECT t.id FROM staff_notification_attempts t JOIN staff_notification_endpoints ep ON ${SAME_ENDPOINT} ${ENDPOINT_JOINS} JOIN ops_jobs j ON j.id=t.job_id WHERE t.id=$1::uuid AND t.claim_id=$2::uuid AND t.dispatch_state='dispatching' AND t.job_id=$3::uuid AND ep.channel_id=$5 AND ${ENDPOINT_ELIGIBLE} AND ${NOT_A_CUSTOMER} AND ${leaseIsMine("$4")}`,
          [attempt.id, claim, context.jobId, context.workerId, runtime.channelId],
        );
        if (!valid) throw new Error("dispatch_eligibility_changed");
      } catch (error) {
        boundaryFailed = true;
        throw error;
      }
      boundaryPassed = true;
    };

    let result: SendResult = { state: "unknown" };
    let safeError: string | null = null;
    try {
      result = await transport!.sendStaffWhatsApp!({
        channelId: runtime.channelId!,
        memberId: String(reserved.destination_reference_snapshot),
        message,
        template,
        beforeSend,
      });
    } catch (error) {
      // Only a started provider request has a possibly accepted, unknown outcome.
      const preflight =
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "STAFF_NOTIFICATION_PREFLIGHT_BLOCKED";
      if (!boundaryPassed && (preflight || boundaryFailed)) {
        result = { state: "suppressed" };
        safeError = boundaryFailed ? "dispatch_eligibility_changed" : "transport_preflight_blocked";
      }
    }
    await query(
      "UPDATE staff_notification_attempts SET dispatch_state=$3,evidence_kind=$4,provider_operation_id=$5,provider_accepted_at=CASE WHEN $3='accepted' THEN COALESCE(provider_accepted_at,now()) ELSE provider_accepted_at END,provider_acceptance_source=CASE WHEN $3='accepted' THEN COALESCE(provider_acceptance_source,'woztell_send_responses') ELSE provider_acceptance_source END,safe_error=CASE WHEN $3='unknown' THEN 'provider_outcome_unknown' WHEN $3='failed' THEN 'provider_refused' WHEN $3='suppressed' THEN COALESCE($6,'transport_preflight_blocked') ELSE NULL END,finished_at=now(),updated_at=now() WHERE id=$1::uuid AND claim_id=$2::uuid AND dispatch_state IN ('dispatching','unknown')",
      [
        attempt.id,
        claim,
        result.state,
        result.evidenceKind ?? null,
        result.providerOperationId ?? null,
        safeError,
      ],
    );
    if (result.state === "accepted") summary.accepted++;
    else if (result.state === "unknown") summary.unknown++;
    else summary.blocked++;
  }
  return { summary };
}

/** Freeze the destinations once per lead, inside one transaction holding the lead lock. */
async function plan(
  leadId: string,
  channelId: string,
  transaction: typeof transactionRows,
  summary: Summary,
) {
  const noRows = "NOT EXISTS(SELECT 1 FROM staff_notification_attempts x WHERE x.lead_id=$1::uuid)";
  const [, planned, none] = await transaction([
    { statement: "SELECT id FROM crm_leads WHERE id=$1::uuid FOR UPDATE", params: [leadId] },
    {
      // (a) the assigned agent's endpoint; (b) every duty manager's unless (a) is
      // sendable. One row per member id. A refused assigned endpoint (a customer
      // number, or present but ineligible) keeps its visible row AND falls back.
      statement: `WITH eligible AS (
          SELECT ep.id,ep.version,ep.staff_id,ep.destination_reference,s.is_duty_manager,(${NOT_A_CUSTOMER}) AS not_customer
          FROM staff_notification_endpoints ep ${ENDPOINT_JOINS}
          WHERE ep.channel_id=$2 AND ${ENDPOINT_ELIGIBLE}
        ), assigned AS (
          SELECT e.* FROM eligible e JOIN crm_leads l ON l.id=$1::uuid AND l.assigned_agent_id=e.staff_id
        ), unavailable AS (
          SELECT ep.id,ep.version FROM staff_notification_endpoints ep
          JOIN crm_leads l ON l.id=$1::uuid AND l.assigned_agent_id=ep.staff_id
          WHERE ep.channel_id=$2 AND ep.transport='staff_whatsapp' AND ep.retired_at IS NULL
            AND NOT EXISTS(SELECT 1 FROM assigned)
        ), chosen AS (
          SELECT * FROM assigned
          UNION ALL
          SELECT * FROM eligible WHERE is_duty_manager AND NOT EXISTS(SELECT 1 FROM assigned WHERE not_customer)
        ), destinations AS (
          SELECT DISTINCT ON (destination_reference) * FROM chosen ORDER BY destination_reference,id
        ), planned AS (
          INSERT INTO staff_notification_attempts(lead_id,transport,endpoint_id,endpoint_version,attempt_key,dispatch_state,safe_error,finished_at)
          SELECT $1::uuid,'staff_whatsapp',d.id,d.version,encode(sha256(convert_to(format('["%s","%s"]',$1::text,d.id::text),'UTF8')),'hex'),
            CASE WHEN d.not_customer THEN 'queued' ELSE 'suppressed' END,
            CASE WHEN d.not_customer THEN NULL ELSE 'destination_is_customer' END,
            CASE WHEN d.not_customer THEN NULL ELSE now() END
          FROM destinations d WHERE ${noRows}
          ON CONFLICT(attempt_key) DO NOTHING RETURNING dispatch_state
        ), refused AS (
          INSERT INTO staff_notification_attempts(lead_id,transport,endpoint_id,endpoint_version,attempt_key,dispatch_state,safe_error,finished_at)
          SELECT $1::uuid,'staff_whatsapp',u.id,u.version,$3,'suppressed','assigned_destination_unavailable',now()
          FROM unavailable u WHERE ${noRows}
          ON CONFLICT(attempt_key) DO NOTHING RETURNING dispatch_state
        )
        SELECT dispatch_state FROM planned UNION ALL SELECT dispatch_state FROM refused`,
      params: [leadId, channelId, attemptKey([leadId, "assigned_unavailable"])],
    },
    {
      statement: `INSERT INTO staff_notification_attempts(lead_id,transport,attempt_key,dispatch_state,safe_error,finished_at) SELECT $1::uuid,'staff_whatsapp',$2,'suppressed','no_destination',now() WHERE ${noRows} ON CONFLICT(attempt_key) DO NOTHING RETURNING id`,
      params: [leadId, attemptKey([leadId, "no_destination"])],
    },
  ]);
  summary.blocked +=
    planned.filter((row) => row.dispatch_state === "suppressed").length + none.length;
}
