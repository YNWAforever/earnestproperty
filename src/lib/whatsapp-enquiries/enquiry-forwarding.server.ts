import "@tanstack/react-start/server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveSiteOrigin } from "../../../scripts/site-origin.mjs";
import { queryRows, transactionRows, type DbRow } from "../neon/db.server.ts";
import { retryableJobError } from "../control-plane/job-handlers.server.ts";
import { createStaffWhatsAppTransport } from "../woztell/staff-whatsapp-transport.server.ts";
import {
  buildStaffTemplateResponse,
  formatCustomerPhone,
} from "../woztell/staff-alert-template.ts";
import {
  staffWhatsappAlertRuntime,
  type StaffNotificationRuntime,
  type StaffNotificationTransport,
} from "./staff-notifications.server.ts";
import { providerChannelId } from "./wa-config.server.ts";
import { staffDestinationNotACustomer } from "./staff-recipient-guard.ts";
import {
  ENQUIRY_FORWARD_JOB,
  ENQUIRY_FORWARD_PURPOSE,
  forwardingPhone,
  forwardingSourceLabel,
  forwardingSubjectKey,
  uniqueForwardingRecipients,
} from "./enquiry-forwarding-policy.mjs";
import { resolveEnquiryForwarding } from "./enquiry-routing.server.ts";
import { forwardingSchemaAvailable } from "./enquiry-forwarding-coverage.server.ts";

export const enquiryForwardPayload = z
  .object({ source: z.enum(["website", "whatsapp"]), subjectId: z.string().uuid() })
  .strict();
export type EnquiryForwardPayload = z.infer<typeof enquiryForwardPayload>;
export type ForwardRecipient = {
  key: string;
  kind: "copy" | "manager" | "sales";
  staffId: string | null;
  phone: string;
  displayName?: string;
};
export type ForwardRoute = {
  source: "website" | "whatsapp";
  subjectId: string;
  createdAt: string | Date;
  customerName: string | null;
  customerPhone: string | null;
  summary: string | null;
  propertyId?: string | null;
  propertyNo?: string | null;
  dealType?: string | null;
  conversationId?: string | null;
  routingKind: "property" | "estate" | "general" | "review";
  reason?: string | null;
  routingVersion: string;
  routeKey?: string;
  routeRevision?: number;
  recipients: ForwardRecipient[];
  channelId?: string | null;
};
type Context = { jobId: string; workerId: string; checkpoint: () => Promise<void> };
type Deps = {
  query?: typeof queryRows;
  transaction?: typeof transactionRows;
  runtime?: () => StaffNotificationRuntime;
  transport?: () => StaffNotificationTransport;
  resolve?: (
    query: typeof queryRows,
    payload: EnquiryForwardPayload,
  ) => Promise<ForwardRoute | null>;
};
type Summary = { accepted: number; unknown: number; blocked: number; alreadySent: number };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const subjectColumn = (source: string) =>
  source === "website" ? "lead_id" : "forwarding_inquiry_id";
const lease = (job = "j") =>
  `${job}.status='running' AND ${job}.lease_owner=$3 AND ${job}.lease_expires_at>now()`;
const purpose = "t.routing_snapshot->>'purpose'='enquiry_forward'";
const samePayload =
  "j.job_type='woztell.enquiry.forward' AND j.payload->>'source'=$6 AND j.payload->>'subjectId'=$7";
const recipientReady = `r.enabled AND r.retired_at IS NULL AND r.permission_granted AND r.permission_ref IS NOT NULL AND r.verified_at IS NOT NULL AND r.verification_ref IS NOT NULL AND r.destination_reference IS NOT NULL AND r.channel_id=$4 AND (r.destination_type='member_id' OR (r.destination_type='recipient_id' AND r.destination_reference=r.phone)) AND (r.staff_id IS NULL OR EXISTS(SELECT 1 FROM staff_users current_staff WHERE current_staff.id=r.staff_id AND current_staff.active AND COALESCE((to_jsonb(current_staff)->>'show_on_website')::boolean,false) AND (enquiry_notification_phone(current_staff.whatsapp)=r.phone OR (r.kind='manager' AND enquiry_notification_phone(current_staff.phone)=r.phone))))`;
const notCustomer = `${staffDestinationNotACustomer("r")} AND ${staffDestinationNotACustomer("r", "phone")}`;

export {
  forwardingCoversSubject,
  forwardingSchemaAvailable,
} from "./enquiry-forwarding-coverage.server.ts";

function templateHash(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const template = value as Record<string, unknown>;
  return hash([template.name, template.language, template.params]);
}
function contentHash(route: ForwardRoute) {
  return hash([
    route.customerName,
    route.customerPhone,
    route.summary,
    route.propertyId ?? null,
    route.propertyNo ?? null,
    route.dealType ?? null,
  ]);
}
function workLink(route: ForwardRoute, origin: string) {
  const url = new URL(route.source === "website" ? "/admin/leads" : "/admin/whatsapp", origin);
  if (route.source === "website") url.searchParams.set("lead", route.subjectId);
  else {
    url.searchParams.set("enquiry", route.subjectId);
    if (route.conversationId) url.searchParams.set("conversation", route.conversationId);
  }
  return url.toString();
}
function runtimeBlock(
  runtime: StaffNotificationRuntime,
  transport: StaffNotificationTransport | null,
  origin: string | null | undefined,
) {
  if (!runtime.enabled) return "notifications_disabled";
  if (!runtime.template) return "template_not_configured";
  if (!runtime.channelId || runtime.channelId !== providerChannelId()) return "channel_unverified";
  if (
    !transport?.verificationRef ||
    (!transport.sendStaffWhatsApp && !transport.sendStaffWhatsAppByPhone)
  )
    return "transport_capability_unverified";
  if (!origin?.startsWith("https://")) return "work_origin_unconfigured";
  return null;
}
function snapshot(
  route: ForwardRoute,
  recipient: ForwardRecipient,
  runtime: StaffNotificationRuntime,
) {
  return {
    purpose: ENQUIRY_FORWARD_PURPOSE,
    source: route.source,
    subjectId: route.subjectId,
    routingKind: route.routingKind,
    routingVersion: route.routingVersion,
    reason: route.reason ?? null,
    propertyId: route.propertyId ?? null,
    routeKey: route.routeKey ?? null,
    routeRevision: route.routeRevision ?? null,
    recipientKey: recipient.key,
    recipientKind: recipient.kind,
    recipientPhone: recipient.phone,
    staffId: recipient.staffId,
    contentHash: contentHash(route),
    template: runtime.template,
  };
}

export async function reconcileEnquiryForwarding(
  input: unknown,
  context?: Pick<Context, "jobId" | "workerId">,
  query = queryRows,
) {
  const payload = enquiryForwardPayload.parse(input);
  if (!(await forwardingSchemaAvailable(query))) return { unknown: 0 };
  const rows = await query(
    `UPDATE staff_notification_attempts t SET dispatch_state='unknown',safe_error='dispatch_outcome_unknown',finished_at=now(),updated_at=now()
     WHERE t.${subjectColumn(payload.source)}=$1::uuid AND ${purpose} AND t.dispatch_state='dispatching'
       AND ((t.job_id=$2::uuid AND EXISTS(SELECT 1 FROM ops_jobs current_job WHERE current_job.id=$2::uuid AND current_job.status='running' AND current_job.lease_owner=$3 AND current_job.lease_expires_at>now() AND current_job.job_type='woztell.enquiry.forward' AND current_job.payload->>'source'=$4 AND current_job.payload->>'subjectId'=$1::text)) OR NOT EXISTS(SELECT 1 FROM ops_jobs j WHERE j.id=t.job_id AND j.status='running' AND j.lease_expires_at>now())) RETURNING t.id`,
    [payload.subjectId, context?.jobId ?? null, context?.workerId ?? null, payload.source],
  );
  return { unknown: rows.length };
}

/** A leased job sends each frozen destination at most once. */
export async function dispatchEnquiryForwarding(input: unknown, context: Context, deps: Deps = {}) {
  const payload = enquiryForwardPayload.parse(input);
  const query = deps.query ?? queryRows,
    transaction = deps.transaction ?? transactionRows;
  const runtimeOf = deps.runtime ?? staffWhatsappAlertRuntime;
  const resolve = deps.resolve ?? resolveEnquiryForwarding;
  const summary: Summary = { accepted: 0, unknown: 0, blocked: 0, alreadySent: 0 };
  await context.checkpoint();
  const mine = await query(
    "SELECT j.id FROM ops_jobs j WHERE j.id=$1::uuid AND j.status='running' AND j.lease_owner=$2 AND j.lease_expires_at>now() AND j.job_type='woztell.enquiry.forward' AND j.payload->>'source'=$3 AND j.payload->>'subjectId'=$4",
    [context.jobId, context.workerId, payload.source, payload.subjectId],
  );
  if (!mine.length)
    throw Object.assign(new Error("Forwarding job ownership lost"), { code: "JOB_OWNERSHIP_LOST" });
  if (!(await forwardingSchemaAvailable(query))) return { summary: { ...summary, blocked: 1 } };
  await reconcileEnquiryForwarding(payload, context, query);
  const route = (await resolve(query, payload)) as ForwardRoute | null;
  if (!route) return { summary: { ...summary, blocked: 1 } };
  let runtime = runtimeOf();
  let transport: StaffNotificationTransport | null;
  try {
    transport = (deps.transport ?? createStaffWhatsAppTransport)();
  } catch {
    transport = null;
  }
  const origin = resolveSiteOrigin();
  const key = forwardingSubjectKey(payload.source, payload.subjectId);
  const column = subjectColumn(payload.source);
  const [copy] = await query(
    "SELECT enabled_since,enabled,channel_id FROM enquiry_notification_recipients WHERE recipient_key='copy' AND retired_at IS NULL",
  );
  if (
    !copy?.enabled_since ||
    !Number.isFinite(Date.parse(String(route.createdAt))) ||
    Date.parse(String(route.createdAt)) < Date.parse(String(copy.enabled_since))
  )
    return { summary: { ...summary, blocked: 1 } };
  const recipients = uniqueForwardingRecipients(route.recipients);
  if (!recipients.some((r) => r.kind === "copy" && r.phone === "85297987774"))
    throw Error("ENQUIRY_FORWARD_COPY_REQUIRED");
  const existing = await query(
    `SELECT id FROM staff_notification_attempts t WHERE t.${column}=$1::uuid AND ${purpose} LIMIT 1`,
    [payload.subjectId],
  );
  if (!existing.length) {
    const desired = recipients.map((recipient) => ({
      key: recipient.key,
      kind: recipient.kind,
      phone: recipient.phone,
      staff_id: recipient.staffId,
      attempt_key: hash([key, recipient.phone]),
      snapshot: snapshot(route, recipient, runtime),
    }));
    const candidateReady = `r.id IS NOT NULL AND r.phone=d.phone AND r.kind=d.kind AND r.staff_id IS NOT DISTINCT FROM d.staff_id AND ${recipientReady} AND ${notCustomer} AND enquiry_forwarding_is_enabled($4)`;
    await transaction(
      [
        { statement: "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", params: [key] },
        {
          statement: `INSERT INTO staff_notification_attempts(${column},transport,forwarding_recipient_id,recipient_version,destination_reference_snapshot,channel_id_snapshot,attempt_key,dispatch_state,safe_error,finished_at,routing_snapshot)
          SELECT $1::uuid,'staff_whatsapp',r.id,r.version,r.destination_reference,$4,d.attempt_key,
            CASE WHEN ${candidateReady} THEN 'queued' ELSE 'suppressed' END,
            CASE WHEN r.id IS NULL THEN 'recipient_not_configured' WHEN r.phone<>d.phone THEN 'recipient_phone_changed' WHEN NOT enquiry_forwarding_is_enabled($4) THEN 'forwarding_disabled' WHEN NOT (${notCustomer}) THEN 'destination_is_customer' WHEN NOT (${recipientReady}) OR r.kind<>d.kind OR r.staff_id IS DISTINCT FROM d.staff_id THEN 'recipient_not_ready' ELSE NULL END,
            CASE WHEN ${candidateReady} THEN NULL ELSE now() END,d.snapshot||jsonb_build_object('destinationType',r.destination_type)
          FROM jsonb_to_recordset($5::jsonb) AS d(key text,kind text,phone text,staff_id uuid,attempt_key text,snapshot jsonb)
          LEFT JOIN enquiry_notification_recipients r ON r.recipient_key=d.key
          WHERE EXISTS(SELECT 1 FROM ops_jobs j WHERE j.id=$2::uuid AND ${lease()} AND j.job_type='woztell.enquiry.forward' AND j.payload->>'source'=$6 AND j.payload->>'subjectId'=$1::text)
            AND NOT EXISTS(SELECT 1 FROM staff_notification_attempts t WHERE t.${column}=$1::uuid AND ${purpose})
          ON CONFLICT(attempt_key) DO NOTHING RETURNING id`,
          params: [
            payload.subjectId,
            context.jobId,
            context.workerId,
            runtime.channelId ?? copy.channel_id ?? null,
            JSON.stringify(desired),
            payload.source,
          ],
        },
      ],
      { isolationLevel: "Serializable" },
    );
  }
  const attempts = await query(
    `SELECT t.* FROM staff_notification_attempts t WHERE t.${column}=$1::uuid AND ${purpose} ORDER BY t.created_at,t.id`,
    [payload.subjectId],
  );
  const blocked = runtimeBlock(runtime, transport, origin);
  if (blocked && attempts.some((t) => t.dispatch_state === "queued")) {
    await query(
      `UPDATE staff_notification_attempts t SET safe_error=$2,updated_at=now() WHERE t.${column}=$1::uuid AND ${purpose} AND t.dispatch_state='queued'`,
      [payload.subjectId, blocked],
    );
    throw retryableJobError(
      "ENQUIRY_FORWARD_NOT_READY",
      "查詢通知設定未就緒，目的地及原因已保存。",
    );
  }
  for (const attempt of attempts) {
    if (["accepted", "delivered"].includes(String(attempt.dispatch_state))) {
      summary.alreadySent++;
      continue;
    }
    if (attempt.dispatch_state === "unknown" || attempt.dispatch_state === "dispatching") {
      summary.unknown++;
      continue;
    }
    if (attempt.dispatch_state !== "queued") {
      summary.blocked++;
      continue;
    }
    await context.checkpoint();
    const claim = randomUUID();
    const frozen = attempt.routing_snapshot as Record<string, unknown>;
    const eligibleSql = `r.id=t.forwarding_recipient_id AND r.version=t.recipient_version AND r.destination_reference=t.destination_reference_snapshot AND r.destination_type=t.routing_snapshot->>'destinationType' AND r.channel_id=t.channel_id_snapshot AND r.phone=t.routing_snapshot->>'recipientPhone' AND ${recipientReady} AND ${notCustomer} AND enquiry_forwarding_is_enabled($4)`;
    const reserved = await query(
      `UPDATE staff_notification_attempts t SET dispatch_state='dispatching',claim_id=$5::uuid,job_id=$2::uuid,dispatch_started_at=now(),safe_error=NULL,updated_at=now()
       FROM enquiry_notification_recipients r,ops_jobs j WHERE t.id=$1::uuid AND t.dispatch_state='queued' AND ${eligibleSql} AND j.id=$2::uuid AND ${lease()} AND ${samePayload} RETURNING t.id,t.destination_reference_snapshot`,
      [
        attempt.id,
        context.jobId,
        context.workerId,
        runtime.channelId,
        claim,
        payload.source,
        payload.subjectId,
      ],
    );
    if (!reserved.length) {
      await query(
        "UPDATE staff_notification_attempts SET dispatch_state='suppressed',safe_error='dispatch_eligibility_changed',finished_at=now(),updated_at=now() WHERE id=$1::uuid AND dispatch_state='queued' AND EXISTS(SELECT 1 FROM ops_jobs j WHERE j.id=$2::uuid AND j.status='running' AND j.lease_owner=$3 AND j.lease_expires_at>now() AND j.job_type='woztell.enquiry.forward' AND j.payload->>'source'=$4 AND j.payload->>'subjectId'=$5)",
        [attempt.id, context.jobId, context.workerId, payload.source, payload.subjectId],
      );
      summary.blocked++;
      continue;
    }
    let boundaryPassed = false,
      boundaryFailed = false;
    const beforeSend = async () => {
      try {
        await context.checkpoint();
        runtime = runtimeOf();
        if (
          runtimeBlock(runtime, transport, origin) ||
          templateHash(runtime.template) !== templateHash(frozen.template)
        )
          throw Error("runtime_changed");
        const current = (await resolve(query, payload)) as ForwardRoute | null;
        if (
          !current ||
          contentHash(current) !== frozen.contentHash ||
          current.routingKind !== frozen.routingKind ||
          (current.propertyId ?? null) !== frozen.propertyId ||
          (current.routeKey ?? null) !== frozen.routeKey ||
          (current.routeRevision ?? null) !== frozen.routeRevision ||
          !uniqueForwardingRecipients(current.recipients).some(
            (r) =>
              r.key === frozen.recipientKey &&
              r.phone === frozen.recipientPhone &&
              r.staffId === frozen.staffId,
          )
        )
          throw Error("routing_changed");
        const live = await query(
          `SELECT t.id FROM staff_notification_attempts t JOIN enquiry_notification_recipients r ON r.id=t.forwarding_recipient_id JOIN ops_jobs j ON j.id=t.job_id WHERE t.id=$1::uuid AND t.claim_id=$5::uuid AND t.dispatch_state='dispatching' AND t.job_id=$2::uuid AND ${eligibleSql} AND ${lease()} AND ${samePayload}`,
          [
            attempt.id,
            context.jobId,
            context.workerId,
            runtime.channelId,
            claim,
            payload.source,
            payload.subjectId,
          ],
        );
        if (!live.length) throw Error("dispatch_eligibility_changed");
      } catch (error) {
        boundaryFailed = true;
        throw error;
      }
      boundaryPassed = true;
    };
    let result: Awaited<ReturnType<NonNullable<StaffNotificationTransport["sendStaffWhatsApp"]>>> =
      { state: "unknown" };
    try {
      const template = buildStaffTemplateResponse(runtime.template!, {
        name: String(route.customerName ?? ""),
        source: forwardingSourceLabel(route),
        phone: formatCustomerPhone(route.customerPhone),
        link: workLink(route, origin!),
      });
      const common = {
        channelId: runtime.channelId!,
        message: `新查詢：${forwardingSourceLabel(route)}`,
        template,
        beforeSend,
      };
      if (frozen.destinationType === "recipient_id" && transport?.sendStaffWhatsAppByPhone)
        result = await transport.sendStaffWhatsAppByPhone({
          ...common,
          phone: String(reserved[0].destination_reference_snapshot),
        });
      else if (frozen.destinationType === "member_id" && transport?.sendStaffWhatsApp)
        result = await transport.sendStaffWhatsApp({
          ...common,
          memberId: String(reserved[0].destination_reference_snapshot),
        });
      else {
        boundaryFailed = true;
        throw Error("transport_destination_unverified");
      }
      if (!boundaryPassed && result.state === "accepted") result = { state: "unknown" };
    } catch (error) {
      const preflight =
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "STAFF_NOTIFICATION_PREFLIGHT_BLOCKED";
      if (!boundaryPassed && (boundaryFailed || preflight)) result = { state: "suppressed" };
    }
    await query(
      "UPDATE staff_notification_attempts SET dispatch_state=$3,evidence_kind=$4,provider_operation_id=$5,provider_accepted_at=CASE WHEN $3='accepted' THEN COALESCE(provider_accepted_at,now()) ELSE provider_accepted_at END,provider_acceptance_source=CASE WHEN $3='accepted' THEN COALESCE(provider_acceptance_source,'woztell_send_responses') ELSE provider_acceptance_source END,safe_error=CASE WHEN $3='unknown' THEN 'provider_outcome_unknown' WHEN $3='failed' THEN 'provider_refused' WHEN $3='suppressed' THEN 'dispatch_eligibility_changed' ELSE NULL END,finished_at=now(),updated_at=now() WHERE id=$1::uuid AND claim_id=$2::uuid AND dispatch_state IN ('dispatching','unknown')",
      [
        attempt.id,
        claim,
        result.state,
        result.evidenceKind ?? null,
        result.providerOperationId ?? null,
      ],
    );
    if (result.state === "accepted") summary.accepted++;
    else if (result.state === "unknown") summary.unknown++;
    else summary.blocked++;
  }
  return { summary };
}
