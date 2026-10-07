import "@tanstack/react-start/server-only";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { resolveSiteOrigin } from "../../../scripts/site-origin.mjs";
import { queryRows, transactionRows } from "../neon/db.server.ts";
import { createStaffWhatsAppTransport } from "../woztell/staff-whatsapp-transport.server.ts";
import { createInboxApi } from "../woztell/inbox-api.server.ts";
import {
  buildStaffTemplateResponse,
  parseStaffAlertTemplate,
  type StaffAlertTemplate,
  type StaffTemplateResponse,
} from "../woztell/staff-alert-template.ts";
import { staffDestinationNotACustomer } from "./staff-recipient-guard.ts";
type Ports = { query: typeof queryRows; transaction: typeof transactionRows };
const defaults: Ports = { query: queryRows, transaction: transactionRows };
export type StaffNotificationRuntime = {
  enabled: boolean;
  generationId: string | null;
  channelId: string | null;
  /** Owner-approved template used outside the 24-hour window; null = 模板未設定. */
  template: StaffAlertTemplate | null;
};
/** The staff WhatsApp gate shared by lead alerts, staff WhatsApp readiness and the
 * staff template runtime card: `EP_WA_STAFF_NOTIFICATIONS_ENABLED` only, independent
 * of `EP_WA_ENQUIRY_MODE` (transport capability and channel are checked by callers). */
export function staffWhatsappAlertRuntime(): StaffNotificationRuntime {
  return {
    enabled: process.env.EP_WA_STAFF_NOTIFICATIONS_ENABLED === "true",
    generationId: process.env.EP_WA_ACTIVATION_ID ?? null,
    channelId: process.env.EP_WA_COMPANY_CHANNEL_ID ?? null,
    template: parseStaffAlertTemplate(process.env.EP_WA_STAFF_ALERT_TEMPLATE),
  };
}
/** Enquiry notifications additionally need WhatsApp enquiry automation active. */
export function staffNotificationRuntime(): StaffNotificationRuntime {
  const runtime = staffWhatsappAlertRuntime();
  return { ...runtime, enabled: runtime.enabled && process.env.EP_WA_ENQUIRY_MODE === "active" };
}
type Result = {
  state: "accepted" | "failed" | "unknown" | "suppressed";
  evidenceKind?: "private_note_posted" | "provider_accepted";
  providerOperationId?: string;
};
export type StaffNotificationTransport = {
  verificationRef: string;
  postPrivateNote?: (scope: {
    channelId: string;
    memberId: string;
    inboxUserId: string;
    folderId: string;
    message: string;
    beforeSend: () => Promise<void>;
  }) => Promise<Result>;
  sendStaffWhatsApp?: (scope: {
    channelId: string;
    memberId: string;
    message: string;
    /** Sent instead of TEXT when present; TEXT is valid only inside the 24-hour window. */
    template: StaffTemplateResponse | null;
    beforeSend: () => Promise<void>;
  }) => Promise<Result>;
};
export function staffNotificationWorkLink(input: {
  id: string;
  conversation_id: unknown;
  inquiry_id: unknown;
}) {
  const origin = resolveSiteOrigin();
  if (!origin || !origin.startsWith("https://")) return null;
  const url = new URL("/admin/whatsapp", origin);
  url.searchParams.set("conversation", String(input.conversation_id));
  url.searchParams.set("enquiry", String(input.inquiry_id));
  url.searchParams.set("notification", input.id);
  return url.toString();
}
export async function staffNotificationSchemaAvailable(query = queryRows) {
  return (
    (await query("SELECT to_regclass('staff_notification_intents') IS NOT NULL AS available"))[0]
      ?.available === true
  );
}
export async function captureStaffReady(inquiryId: string, query = queryRows) {
  z.string().uuid().parse(inquiryId);
  return query("SELECT wa_capture_staff_ready($1::uuid) notification_id", [inquiryId]);
}
const eligibility = `n.work_state IN ('pending','acknowledged') AND i.status NOT IN ('closed','resolved','spam') AND i.first_human_response_at IS NULL AND NOT i.association_review AND n.recipient_staff_id=w.confirmed_staff_id AND n.assignment_version=w.assignment_version AND n.activation_generation=$2::uuid AND a.ended_at IS NULL AND w.channel_id=$3 AND s.active AND EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=s.id AND r.role IN ('admin','manager','agent')) AND m.eligible AND m.retired_at IS NULL AND EXISTS(SELECT 1 FROM whatsapp_assignment_requests r WHERE r.id=w.pending_assignment_id AND r.state='confirmed' AND r.version=n.assignment_version AND r.desired_staff_id=n.recipient_staff_id AND r.evidence->>'authoritative'='true')`;
const joins = `FROM staff_notification_intents n JOIN inquiries i ON i.id=n.inquiry_id JOIN whatsapp_conversations w ON w.id=n.conversation_id JOIN staff_users s ON s.id=n.recipient_staff_id JOIN whatsapp_staff_channels m ON m.staff_id=s.id AND m.channel_id=w.channel_id JOIN whatsapp_enquiry_activations a ON a.id=n.activation_generation`;
export async function dispatchStaffNotification(
  notificationId: string,
  options: { checkpoint: () => Promise<void>; job?: { jobId: string; workerId: string } },
  ports: Ports = defaults,
  runtime = staffNotificationRuntime(),
  injected?: StaffNotificationTransport,
) {
  z.string().uuid().parse(notificationId);
  const query = ports.query;
  if (!(await staffNotificationSchemaAvailable(query)))
    return { accepted: 0, blocked: 1, unknown: 0 };
  await reconcileStaffNotification(notificationId, query);
  if (!runtime.enabled || !runtime.generationId || !runtime.channelId) {
    await query(
      "UPDATE staff_notification_attempts SET dispatch_state='suppressed',safe_error='notifications_disabled',updated_at=now() WHERE notification_id=$1::uuid AND dispatch_state='queued'",
      [notificationId],
    );
    return { accepted: 0, blocked: 1, unknown: 0 };
  }
  await options.checkpoint();
  const [n] = await query(
    `SELECT n.*,w.channel_id,w.woztell_member_id,m.inbox_user_id,m.folder_id ${joins} WHERE n.id=$1::uuid AND ${eligibility}`,
    [notificationId, runtime.generationId, runtime.channelId],
  );
  if (!n) {
    await query(
      "UPDATE staff_notification_intents SET work_state='superseded',resolution_reason='dispatch_eligibility_changed',updated_at=now() WHERE id=$1::uuid AND work_state IN ('pending','acknowledged')",
      [notificationId],
    );
    return { accepted: 0, blocked: 1, unknown: 0 };
  }
  // Reload the same capability policy shown in admin. The SQL boundary below
  // remains the final atomic guard before the provider request.
  let readiness: Awaited<
    ReturnType<
      (typeof import("../neon/whatsapp-readiness.server.ts"))["inspectWhatsappStaffReadinessForDispatch"]
    >
  > = null;
  if (ports === defaults) {
    try {
      const { inspectWhatsappStaffReadinessForDispatch } =
        await import("../neon/whatsapp-readiness.server.ts");
      readiness = await inspectWhatsappStaffReadinessForDispatch(String(n.recipient_staff_id), {
        query,
      });
    } catch {
      // An unreadable capability is blocked, never treated as ready.
    }
  }
  // Staff WhatsApp is planned only for a recipient with a live destination, so
  // the single switch never turns into suppressed rows for unmapped staff.
  const [liveStaffEndpoint] = await query(
    "SELECT id FROM staff_notification_endpoints WHERE staff_id=$1::uuid AND channel_id=$2 AND transport='staff_whatsapp' AND enabled AND retired_at IS NULL",
    [n.recipient_staff_id, n.channel_id],
  );
  const transports = ["inbox_private_note", ...(liveStaffEndpoint ? ["staff_whatsapp"] : [])];
  let accepted = 0,
    blocked = 0,
    unknown = 0;
  for (const transport of transports) {
    const [ep] = await query(
      "SELECT * FROM staff_notification_endpoints WHERE staff_id=$1::uuid AND channel_id=$2 AND transport=$3",
      [n.recipient_staff_id, n.channel_id, transport],
    );
    const key = createHash("sha256")
      .update(JSON.stringify([notificationId, transport, 1]))
      .digest("hex");
    await query(
      "INSERT INTO staff_notification_attempts(notification_id,transport,endpoint_id,endpoint_version,attempt_key) VALUES($1::uuid,$2,$3::uuid,$4,$5) ON CONFLICT DO NOTHING",
      [notificationId, transport, ep?.id ?? null, ep?.version ?? null, key],
    );
    const [attempt] = await query(
      "SELECT * FROM staff_notification_attempts WHERE notification_id=$1::uuid AND transport=$2 AND attempt_generation=1",
      [notificationId, transport],
    );
    if (
      ep &&
      (attempt.endpoint_id !== ep.id ||
        Number(attempt.endpoint_version) !== Number(ep.version) ||
        attempt.destination_reference_snapshot !== ep.destination_reference ||
        attempt.channel_id_snapshot !== ep.channel_id)
    ) {
      blocked++;
      continue;
    }
    if (attempt.dispatch_state !== "queued") {
      blocked++;
      continue;
    }
    let adapter = injected;
    try {
      adapter ??=
        transport === "inbox_private_note" ? createInboxApi() : createStaffWhatsAppTransport();
    } catch {
      /* unverified capability is retained as a block */
    }
    const capability =
      transport === "inbox_private_note" ? adapter?.postPrivateNote : adapter?.sendStaffWhatsApp;
    let reason = !ep
      ? "destination_unverified"
      : !adapter?.verificationRef || !capability
        ? "transport_capability_unverified"
        : !options.job
          ? "job_lease_required"
          : null;
    if (ports === defaults) {
      const capability =
        transport === "inbox_private_note" ? readiness?.inboxPrivateNote : readiness?.staffWhatsapp;
      if (!capability || capability.state !== "ready")
        reason = capability?.reasons[0]?.code ?? "schema_unavailable";
    }
    if (transport === "staff_whatsapp" && ep?.destination_reference === n.woztell_member_id)
      reason = "customer_destination_forbidden";
    const workLink = staffNotificationWorkLink({
      id: notificationId,
      conversation_id: n.conversation_id,
      inquiry_id: n.inquiry_id,
    });
    if (!workLink) reason = "work_origin_unconfigured";
    const insideWindow =
      !!ep?.last_inbound_at &&
      new Date(String(ep.last_inbound_at)).getTime() > Date.now() - 86400000;
    // A configured template is always the payload. TEXT goes out only when no template
    // exists, and then the SQL boundary still demands an open window ($9 = false).
    // The reason names the readiness window block more precisely but never hides another.
    if (
      transport === "staff_whatsapp" &&
      !insideWindow &&
      !runtime.template &&
      (!reason || reason === "outside_message_window" || reason === "template_unverified")
    )
      reason = "template_not_configured";
    if (reason) {
      await query(
        "UPDATE staff_notification_attempts SET dispatch_state='suppressed',safe_error=$2 WHERE id=$1::uuid AND dispatch_state='queued'",
        [attempt.id, reason],
      );
      blocked++;
      continue;
    }
    const claim = randomUUID();
    const boundary = async () => {
      await options.checkpoint();
      const live = ports === defaults ? staffNotificationRuntime() : runtime;
      if (!live.enabled || live.generationId !== runtime.generationId)
        throw new Error("dispatch_disabled");
      const [valid] = await query(
        `SELECT n.id ${joins} JOIN staff_notification_attempts t ON t.notification_id=n.id JOIN staff_notification_endpoints ep ON ep.id=t.endpoint_id JOIN ops_jobs j ON j.id=t.job_id WHERE n.id=$1::uuid AND ${eligibility} AND m.inbox_user_id=$7 AND m.folder_id=$8 AND t.id=$4::uuid AND t.claim_id=$5::uuid AND t.dispatch_state='dispatching' AND ep.staff_id=n.recipient_staff_id AND ep.channel_id=w.channel_id AND ep.transport=t.transport AND ep.version=t.endpoint_version AND ep.enabled AND ep.permission_granted AND ep.retired_at IS NULL AND ep.verified_at IS NOT NULL AND ep.quiet_hours_policy @> '{"approved":true,"allowAllHours":true}'::jsonb AND (t.transport<>'staff_whatsapp' OR (ep.destination_reference<>w.woztell_member_id AND ${staffDestinationNotACustomer("ep")} AND (ep.last_inbound_at BETWEEN now()-interval '24 hours' AND now() OR $9::boolean))) AND j.status='running' AND j.lease_owner=$6 AND j.lease_expires_at>now()`,
        [
          notificationId,
          runtime.generationId,
          runtime.channelId,
          attempt.id,
          claim,
          options.job!.workerId,
          n.inbox_user_id,
          n.folder_id,
          // $9: the payload is a template, so the 24-hour window does not apply.
          runtime.template !== null,
        ],
      );
      if (!valid) throw new Error("dispatch_eligibility_changed");
    };
    const claimed = await ports.transaction([
      {
        statement:
          "SELECT w.id FROM whatsapp_conversations w JOIN staff_notification_intents n ON n.conversation_id=w.id WHERE n.id=$1::uuid FOR UPDATE OF w",
        params: [notificationId],
      },
      {
        statement:
          "UPDATE staff_notification_attempts SET dispatch_state='dispatching',claim_id=$2::uuid,job_id=$3::uuid,dispatch_started_at=now(),updated_at=now() WHERE id=$1::uuid AND dispatch_state='queued' RETURNING id",
        params: [attempt.id, claim, options.job!.jobId],
      },
      {
        statement:
          "INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key) SELECT 'woztell.enquiry.staff.notify.reconcile',1,jsonb_build_object('notificationId',t.notification_id),'queued',3,j.lease_expires_at+interval '1 minute','wa.staff.reconcile:'||t.id FROM staff_notification_attempts t JOIN ops_jobs j ON j.id=t.job_id WHERE t.id=$1::uuid AND t.claim_id=$2::uuid ON CONFLICT(idempotency_key) DO NOTHING",
        params: [attempt.id, claim],
      },
    ]);
    if (!claimed[1]?.length) {
      blocked++;
      continue;
    }
    try {
      await boundary();
    } catch {
      await query(
        "UPDATE staff_notification_attempts SET dispatch_state='suppressed',safe_error='dispatch_eligibility_changed',finished_at=now() WHERE id=$1::uuid AND claim_id=$2::uuid AND dispatch_state='dispatching'",
        [attempt.id, claim],
      );
      blocked++;
      continue;
    }
    let result: Result = { state: "unknown" };
    try {
      const message = `New enquiry requires attention. Open Earnest: ${workLink}`;
      result =
        transport === "inbox_private_note"
          ? await adapter!.postPrivateNote!({
              channelId: String(n.channel_id),
              memberId: String(n.woztell_member_id),
              inboxUserId: String(n.inbox_user_id),
              folderId: String(n.folder_id),
              message,
              beforeSend: boundary,
            })
          : await adapter!.sendStaffWhatsApp!({
              channelId: String(n.channel_id),
              memberId: String(ep!.destination_reference),
              message,
              template: !runtime.template
                ? null
                : buildStaffTemplateResponse(runtime.template, {
                    name: "WhatsApp 客戶",
                    source: "WhatsApp 查詢",
                    link: workLink!,
                  }),
              beforeSend: boundary,
            });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        ["WOZTELL_INBOX_PREFLIGHT_BLOCKED", "STAFF_NOTIFICATION_PREFLIGHT_BLOCKED"].includes(
          String(error.code),
        )
      )
        result = { state: "suppressed" };
      /* Only a started irreversible POST has a possibly accepted unknown outcome. */
    }
    await query(
      "UPDATE staff_notification_attempts SET dispatch_state=$3,evidence_kind=$4,provider_operation_id=$5,provider_accepted_at=CASE WHEN $3='accepted' THEN COALESCE(provider_accepted_at,now()) ELSE provider_accepted_at END,provider_acceptance_source=CASE WHEN $3='accepted' THEN COALESCE(provider_acceptance_source,'woztell_send_responses') ELSE provider_acceptance_source END,safe_error=CASE WHEN $3='unknown' THEN 'provider_outcome_unknown' WHEN $3='failed' THEN 'provider_refused' WHEN $3='suppressed' THEN 'transport_preflight_blocked' ELSE NULL END,finished_at=now(),updated_at=now() WHERE id=$1::uuid AND claim_id=$2::uuid AND dispatch_state IN ('dispatching','unknown')",
      [
        attempt.id,
        claim,
        result.state,
        result.evidenceKind ?? null,
        result.providerOperationId ?? null,
      ],
    );
    if (result.state === "accepted") accepted++;
    else if (result.state === "unknown") unknown++;
    else blocked++;
  }
  return { accepted, blocked, unknown };
}
/** Expired leases only become unknown; no automatic resend or invented delivery evidence. */
export async function reconcileStaffNotification(notificationId: string, query = queryRows) {
  z.string().uuid().parse(notificationId);
  const rows = await query(
    "UPDATE staff_notification_attempts t SET dispatch_state='unknown',safe_error='lease_expired_after_dispatch',updated_at=now() WHERE t.notification_id=$1::uuid AND t.dispatch_state='dispatching' AND (t.job_id IS NULL OR NOT EXISTS(SELECT 1 FROM ops_jobs j WHERE j.id=t.job_id AND j.status='running' AND j.lease_expires_at>now())) RETURNING id",
    [notificationId],
  );
  return { unknown: rows.length };
}
export async function checkStaffAcknowledgement(notificationId: string, query = queryRows) {
  z.string().uuid().parse(notificationId);
  // No business-approved acknowledgement deadline or quiet-hours/reminder policy exists.
  const [n] = await query(
    "SELECT id FROM staff_notification_intents WHERE id=$1::uuid AND work_state='pending'",
    [notificationId],
  );
  return { pending: n ? 1 : 0, reminders: 0, blocked: n ? 1 : 0 };
}
export async function getStaffNotificationHealth(
  actor: { staffId: string; roles: string[] },
  query = queryRows,
) {
  if (!actor.roles.some((r) => r === "manager" || r === "admin"))
    throw new Response("Forbidden", { status: 403 });
  const [allowed] = await query(
    "SELECT s.id FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$1::uuid AND s.active AND r.role IN ('manager','admin') LIMIT 1",
    [actor.staffId],
  );
  if (!allowed) throw new Response("Forbidden", { status: 403 });
  if (!(await staffNotificationSchemaAvailable(query)))
    return { schemaAvailable: false, counts: {} };
  const [counts] = await query(
    `SELECT (SELECT count(*)::int FROM staff_notification_intents WHERE help_requested_at IS NOT NULL AND work_state IN ('pending','acknowledged')) AS help_requested,(SELECT count(*)::int FROM staff_notification_intents WHERE work_state='pending') AS unacknowledged,(SELECT count(*)::int FROM staff_notification_attempts WHERE dispatch_state='unknown') AS unknown,(SELECT count(*)::int FROM staff_notification_attempts WHERE dispatch_state IN ('failed','suppressed')) AS failed_or_suppressed,(SELECT count(DISTINCT a.lead_id)::int FROM staff_notification_attempts a WHERE a.lead_id IS NOT NULL AND a.dispatch_state IN ('failed','suppressed') AND a.created_at>now()-interval '7 days' AND NOT EXISTS(SELECT 1 FROM staff_notification_attempts b WHERE b.lead_id=a.lead_id AND b.dispatch_state IN ('accepted','delivered'))) AS lead_alerts_blocked,(SELECT count(*)::int FROM staff_notification_routing_exceptions WHERE state='open') AS routing_exceptions,(SELECT count(*)::int FROM staff_notification_routing_exceptions WHERE state='open' AND attended_staff_id IS NULL) AS unattended_blockers,(SELECT count(*)::int FROM staff_notification_internal_events WHERE association_state='review') AS association_review,(SELECT EXTRACT(EPOCH FROM now()-min(created_at))::int FROM staff_notification_attempts WHERE dispatch_state='queued') AS oldest_queued_seconds`,
  );
  return { schemaAvailable: true, counts };
}
