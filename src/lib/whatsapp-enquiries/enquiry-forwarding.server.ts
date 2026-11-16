import "@tanstack/react-start/server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveSiteOrigin } from "../../../scripts/site-origin.mjs";
import { queryRows, transactionRows, type DbRow } from "../neon/db.server.ts";
import {
  enquiryInfoLockStatements,
  enquiryInfoSchemaAvailable,
} from "../neon/enquiry-info-decisions.server.ts";
import { retryableJobError } from "../control-plane/job-handlers.server.ts";
import {
  createEnquiryInfoTemplateTransport,
  enquiryInfoTemplateDigest,
  type EnquiryInfoSendBinding,
  type EnquiryInfoSendResult,
} from "../woztell/enquiry-info-template-transport.server.ts";
import {
  buildStaffTemplateResponse,
  formatCustomerPhone,
} from "../woztell/staff-alert-template.ts";
import { normalizePhone } from "../phone.js";
import {
  staffWhatsappAlertRuntime,
  type StaffNotificationRuntime,
} from "./staff-notifications.server.ts";
import { companyPhone, providerChannelId } from "./wa-config.server.ts";
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
import {
  enquiryInfoSourceWitnessParams,
  enquiryInfoSourceWitnessSql,
  parseEnquiryInfoSourceWitness,
  resolveEnquiryInfoSource,
  type EnquiryInfoSourceWitness,
} from "./enquiry-info-source-witness.server.ts";
import {
  enquiryInfoCausalReceiptSql,
  enquiryInfoDispatchEvidenceSql,
  enquiryInfoEvidenceHash,
  loadEnquiryInfoDispatchContext,
  loadEnquiryInfoPhoneEvidence,
  parseEnquiryInfoDispatchEvidence,
  type EnquiryInfoDispatchEvidence,
} from "./enquiry-info-dispatch-guards.server.ts";

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
  transport?: typeof createEnquiryInfoTemplateTransport;
  env?: NodeJS.ProcessEnv;
  resolve?: (
    query: typeof queryRows,
    payload: EnquiryForwardPayload,
  ) => Promise<ForwardRoute | null>;
};
type Summary = { accepted: number; unknown: number; blocked: number; alreadySent: number };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const subjectColumn = (source: string) =>
  source === "website" ? "lead_id" : "forwarding_inquiry_id";
// A permit may wait on policy locks past its lease; now() would retain BEGIN's time.
const lease = (job = "j") =>
  `${job}.status='running' AND ${job}.lease_owner=$3 AND ${job}.lease_expires_at>clock_timestamp()`;
const purpose = "t.routing_snapshot->>'purpose'='enquiry_forward'";
const samePayload =
  "j.job_type='woztell.enquiry.forward' AND j.payload_version=1 AND j.payload=jsonb_build_object('source',$6::text,'subjectId',$7::text)";
const recipientReady = `r.enabled AND r.retired_at IS NULL AND r.permission_granted AND r.permission_ref IS NOT NULL AND r.verified_at IS NOT NULL AND r.verification_ref IS NOT NULL AND r.channel_id=$4 AND r.destination_type='recipient_id' AND r.destination_reference=r.phone AND (r.staff_id IS NULL OR EXISTS(SELECT 1 FROM staff_users current_staff WHERE current_staff.id=r.staff_id AND current_staff.active AND COALESCE((to_jsonb(current_staff)->>'show_on_website')::boolean,false) AND (enquiry_notification_phone(current_staff.whatsapp)=r.phone OR (r.kind='manager' AND enquiry_notification_phone(current_staff.phone)=r.phone))))`;
export {
  forwardingCoversSubject,
  forwardingSchemaAvailable,
} from "./enquiry-forwarding-coverage.server.ts";
function templateHash(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const t = value as Record<string, unknown>;
  return hash([t.name, t.language, t.params]);
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
function runtimeBlock(runtime: StaffNotificationRuntime, origin: string | null | undefined) {
  if (!runtime.enabled) return "notifications_disabled";
  if (!runtime.template) return "template_not_configured";
  if (!runtime.channelId || runtime.channelId !== providerChannelId()) return "channel_unverified";
  if (!origin?.startsWith("https://")) return "work_origin_unconfigured";
  return null;
}
function snapshot(
  route: ForwardRoute,
  recipient: ForwardRecipient,
  runtime: StaffNotificationRuntime,
  info: EnquiryInfoDispatchEvidence | null,
  sourceWitness: EnquiryInfoSourceWitness,
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
    info,
    sourceWitness,
    frozenEvidenceHash: info ? enquiryInfoEvidenceHash(info, sourceWitness) : null,
  };
}
function routeMatches(route: ForwardRoute | null, frozen: Record<string, unknown>) {
  return (
    !!route &&
    route.source === frozen.source &&
    route.subjectId === frozen.subjectId &&
    contentHash(route) === frozen.contentHash &&
    route.routingKind === frozen.routingKind &&
    route.routingVersion === frozen.routingVersion &&
    (route.propertyId ?? null) === frozen.propertyId &&
    (route.routeKey ?? null) === frozen.routeKey &&
    (route.routeRevision ?? null) === frozen.routeRevision &&
    uniqueForwardingRecipients(route.recipients).some(
      (r) =>
        r.key === frozen.recipientKey &&
        r.kind === frozen.recipientKind &&
        r.phone === frozen.recipientPhone &&
        r.staffId === frozen.staffId,
    )
  );
}
function privateValues(env: NodeJS.ProcessEnv) {
  return [
    ...new Set(
      Object.entries(env)
        .filter(
          ([key, value]) =>
            /TOKEN|SECRET|PASSWORD|SIGNATURE|API_KEY|ACCESS_KEY|DATABASE_URL|VERIFICATION_REF|REVIEW_REF/.test(
              key,
            ) &&
            typeof value === "string" &&
            value.trim(),
        )
        .flatMap(([, value]) => [value!, value!.trim()]),
    ),
  ];
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
    AND ((t.job_id=$2::uuid AND EXISTS(SELECT 1 FROM ops_jobs current_job WHERE current_job.id=$2::uuid AND current_job.status='running' AND current_job.lease_owner=$3 AND current_job.lease_expires_at>now() AND current_job.job_type='woztell.enquiry.forward' AND current_job.payload=jsonb_build_object('source',$4::text,'subjectId',$1::text))) OR NOT EXISTS(SELECT 1 FROM ops_jobs j WHERE j.id=t.job_id AND j.status='running' AND j.lease_expires_at>now())) RETURNING t.id`,
    [payload.subjectId, context?.jobId ?? null, context?.workerId ?? null, payload.source],
  );
  return { unknown: rows.length };
}

/** A leased job sends each frozen destination at most once, under a one-use DB permit. */
export async function dispatchEnquiryForwarding(input: unknown, context: Context, deps: Deps = {}) {
  const payload = enquiryForwardPayload.parse(input);
  if (deps.query && !deps.transaction) throw Error("ENQUIRY_FORWARD_TRANSACTION_REQUIRED");
  const transaction = deps.transaction ?? transactionRows;
  const query =
    deps.query ??
    (deps.transaction
      ? ((async (statement: string, params: unknown[] = []) =>
          (await transaction([{ statement, params }], { isolationLevel: "ReadCommitted" }))[0] ??
          []) as typeof queryRows)
      : queryRows);
  const runtimeOf = deps.runtime ?? staffWhatsappAlertRuntime;
  const transportFactory = deps.transport ?? createEnquiryInfoTemplateTransport;
  const env = deps.env ?? process.env;
  const resolve = deps.resolve ?? resolveEnquiryForwarding;
  const summary: Summary = { accepted: 0, unknown: 0, blocked: 0, alreadySent: 0 };
  await context.checkpoint();
  const mine = await query(
    "SELECT j.id FROM ops_jobs j WHERE j.id=$1::uuid AND j.status='running' AND j.lease_owner=$2 AND j.lease_expires_at>now() AND j.job_type='woztell.enquiry.forward' AND j.payload_version=1 AND j.payload=jsonb_build_object('source',$3::text,'subjectId',$4::text)",
    [context.jobId, context.workerId, payload.source, payload.subjectId],
  );
  if (!mine.length)
    throw Object.assign(new Error("Forwarding job ownership lost"), { code: "JOB_OWNERSHIP_LOST" });
  if (!(await forwardingSchemaAvailable(query)) || !(await enquiryInfoSchemaAvailable(query)))
    return { summary: { ...summary, blocked: 1 } };
  await reconcileEnquiryForwarding(payload, context, query);
  const resolved = await resolveEnquiryInfoSource(payload, resolve, query);
  const route = resolved?.route;
  if (
    !resolved ||
    !route ||
    route.source !== payload.source ||
    route.subjectId !== payload.subjectId
  )
    return { summary: { ...summary, blocked: 1 } };
  const resolveCurrent = async (frozen: Record<string, unknown>) => {
    const current = await resolveEnquiryInfoSource(payload, resolve, query);
    const captured = parseEnquiryInfoSourceWitness(frozen.sourceWitness);
    return (
      !!current &&
      !!captured &&
      current.witness.hash === captured.hash &&
      (frozen.recipientKind !== "sales" || current.witness.salesHash === captured.salesHash) &&
      routeMatches(current.route, frozen)
    );
  };
  let runtime = runtimeOf();
  const origin = resolveSiteOrigin();
  const key = forwardingSubjectKey(payload.source, payload.subjectId),
    column = subjectColumn(payload.source);
  const [copy] = await query(
    "SELECT enabled,enabled_since,channel_id FROM enquiry_notification_recipients WHERE recipient_key='copy'",
  );
  if (
    !copy?.enabled ||
    !copy.enabled_since ||
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
    const appId = env.WOZTELL_APP_ID,
      sender = normalizePhone(companyPhone());
    const infoContext =
      typeof appId === "string" &&
      /^[A-Za-z0-9_-]{1,128}$/.test(appId) &&
      runtime.channelId &&
      runtime.template &&
      sender
        ? await loadEnquiryInfoDispatchContext(
            {
              appId,
              channelId: runtime.channelId,
              companySenderPhone: sender,
              template: runtime.template,
            },
            query,
          )
        : null;
    const desired = await Promise.all(
      recipients.map(async (recipient) => ({
        key: recipient.key,
        kind: recipient.kind,
        phone: recipient.phone,
        staff_id: recipient.staffId,
        attempt_key: hash([key, recipient.phone]),
        snapshot: snapshot(
          route,
          recipient,
          runtime,
          infoContext
            ? await loadEnquiryInfoPhoneEvidence(infoContext, recipient.phone, query)
            : null,
          resolved.witness,
        ),
      })),
    );
    const candidateReady = `r.id IS NOT NULL AND r.phone=d.phone AND r.kind=d.kind AND r.staff_id IS NOT DISTINCT FROM d.staff_id AND ${recipientReady} AND ${enquiryInfoDispatchEvidenceSql("d.snapshot")} AND ${enquiryInfoCausalReceiptSql("d.snapshot")} AND enquiry_forwarding_is_enabled($4)`;
    await transaction(
      [
        { statement: "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", params: [key] },
        {
          statement: `INSERT INTO staff_notification_attempts(${column},transport,forwarding_recipient_id,recipient_version,destination_reference_snapshot,channel_id_snapshot,attempt_key,dispatch_state,safe_error,finished_at,routing_snapshot)
      SELECT $1::uuid,'staff_whatsapp',r.id,r.version,r.destination_reference,$4,d.attempt_key,
        CASE WHEN ${candidateReady} THEN 'queued' ELSE 'suppressed' END,
        CASE WHEN r.id IS NULL THEN 'recipient_not_configured' WHEN r.phone<>d.phone THEN 'recipient_phone_changed'
          WHEN NOT enquiry_forwarding_is_enabled($4) THEN 'forwarding_disabled'
          WHEN d.snapshot->'info' IS NULL OR d.snapshot->'info'='null'::jsonb THEN 'info_policy_unavailable'
          WHEN NOT (${enquiryInfoCausalReceiptSql("d.snapshot")}) THEN 'receipt_not_in_current_cutover'
          WHEN NOT (${enquiryInfoDispatchEvidenceSql("d.snapshot")}) THEN 'recipient_identity_review_required'
          WHEN NOT (${recipientReady}) OR r.kind<>d.kind OR r.staff_id IS DISTINCT FROM d.staff_id THEN 'recipient_not_ready' ELSE NULL END,
        CASE WHEN ${candidateReady} THEN NULL ELSE now() END,d.snapshot||jsonb_build_object('destinationType',r.destination_type)
      FROM jsonb_to_recordset($5::jsonb) AS d(key text,kind text,phone text,staff_id uuid,attempt_key text,snapshot jsonb)
      LEFT JOIN enquiry_notification_recipients r ON r.recipient_key=d.key
      WHERE EXISTS(SELECT 1 FROM ops_jobs j WHERE j.id=$2::uuid AND ${lease()} AND j.job_type='woztell.enquiry.forward' AND j.payload_version=1 AND j.payload=jsonb_build_object('source',$6::text,'subjectId',$1::text))
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
      { isolationLevel: "ReadCommitted" },
    );
  }
  const attempts = await query(
    `SELECT t.* FROM staff_notification_attempts t WHERE t.${column}=$1::uuid AND ${purpose} ORDER BY t.created_at,t.id`,
    [payload.subjectId],
  );
  const blocked = runtimeBlock(runtime, origin);
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
    if (["unknown", "dispatching"].includes(String(attempt.dispatch_state))) {
      summary.unknown++;
      continue;
    }
    if (attempt.dispatch_state !== "queued") {
      summary.blocked++;
      continue;
    }
    await context.checkpoint();
    const claim = randomUUID();
    let ownedClaim = claim;
    const frozen = attempt.routing_snapshot as Record<string, unknown>;
    const info = parseEnquiryInfoDispatchEvidence(frozen.info);
    const sourceWitness = parseEnquiryInfoSourceWitness(frozen.sourceWitness);
    const snapshotValid =
      info &&
      sourceWitness &&
      enquiryInfoEvidenceHash(info, sourceWitness) === frozen.frozenEvidenceHash &&
      frozen.source === payload.source &&
      frozen.subjectId === payload.subjectId &&
      info.channelId === runtime.channelId &&
      info.appId === env.WOZTELL_APP_ID &&
      info.companySenderPhone === normalizePhone(companyPhone());
    const eligibleSql = `r.id=t.forwarding_recipient_id AND r.version=t.recipient_version AND r.destination_reference=t.destination_reference_snapshot AND r.destination_type=t.routing_snapshot->>'destinationType' AND r.channel_id=t.channel_id_snapshot AND r.phone=t.routing_snapshot->>'recipientPhone' AND ${recipientReady} AND ${enquiryInfoDispatchEvidenceSql("t.routing_snapshot")} AND ${enquiryInfoCausalReceiptSql("t.routing_snapshot")} AND enquiry_forwarding_is_enabled($4)`;
    const args = [
      attempt.id,
      context.jobId,
      context.workerId,
      runtime.channelId,
      claim,
      payload.source,
      payload.subjectId,
    ];
    const reserved = snapshotValid
      ? await query(
          `UPDATE staff_notification_attempts t SET dispatch_state='dispatching',claim_id=$5::uuid,job_id=$2::uuid,dispatch_started_at=now(),safe_error=NULL,updated_at=now()
      FROM enquiry_notification_recipients r,ops_jobs j WHERE t.id=$1::uuid AND t.dispatch_state='queued' AND ${eligibleSql} AND j.id=$2::uuid AND ${lease()} AND ${samePayload} RETURNING t.id`,
          args,
        )
      : [];
    if (!reserved.length) {
      await query(
        "UPDATE staff_notification_attempts SET dispatch_state='suppressed',safe_error='dispatch_eligibility_changed',finished_at=now(),updated_at=now() WHERE id=$1::uuid AND dispatch_state='queued' AND EXISTS(SELECT 1 FROM ops_jobs j WHERE j.id=$2::uuid AND j.status='running' AND j.lease_owner=$3 AND j.lease_expires_at>now() AND j.job_type='woztell.enquiry.forward' AND j.payload=jsonb_build_object('source',$4::text,'subjectId',$5::text))",
        [attempt.id, context.jobId, context.workerId, payload.source, payload.subjectId],
      );
      summary.blocked++;
      continue;
    }
    let boundaryPassed = false,
      boundaryFailed = false,
      permitConsumed = false,
      sourceMismatch = false;
    const beforeSend = async () => {
      try {
        await context.checkpoint();
        runtime = runtimeOf();
        if (
          runtimeBlock(runtime, origin) ||
          templateHash(runtime.template) !== templateHash(frozen.template) ||
          !(await resolveCurrent(frozen))
        )
          throw Error("runtime_or_routing_changed");
        const live = await query(
          `SELECT t.id FROM staff_notification_attempts t JOIN enquiry_notification_recipients r ON r.id=t.forwarding_recipient_id JOIN ops_jobs j ON j.id=t.job_id WHERE t.id=$1::uuid AND t.claim_id=$5::uuid AND t.dispatch_state='dispatching' AND t.job_id=$2::uuid AND ${eligibleSql} AND ${lease()} AND ${samePayload}`,
          args,
        );
        if (!live.length) throw Error("dispatch_eligibility_changed");
      } catch (error) {
        boundaryFailed = true;
        throw error;
      }
      boundaryPassed = true;
    };
    let result: EnquiryInfoSendResult | { state: "suppressed" } = { state: "unknown" };
    try {
      const template = buildStaffTemplateResponse(runtime.template!, {
        name: String(route.customerName ?? ""),
        source: forwardingSourceLabel(route),
        phone: formatCustomerPhone(route.customerPhone),
        link: workLink(route, origin!),
      });
      const binding: EnquiryInfoSendBinding = {
        purpose: "enq_forward_info",
        version: 1,
        appId: info!.appId,
        channelId: info!.channelId,
        companySenderPhone: info!.companySenderPhone,
        recipientPhone: String(frozen.recipientPhone),
        attemptId: String(attempt.id),
        operationId: claim,
        armId: info!.armId,
        providerProofAuditId: info!.providerProofAuditId,
        recipientVersion: Number(attempt.recipient_version),
        frozenEvidenceHash: String(frozen.frozenEvidenceHash),
        templateDigest: enquiryInfoTemplateDigest(runtime.template!, template),
      };
      const transport = transportFactory({
        privateValues: privateValues(env),
        resolvePermit: async (request) => {
          if (
            permitConsumed ||
            Object.keys(request).length !== Object.keys(binding).length ||
            !Object.entries(binding).every(
              ([key, value]) => request[key as keyof EnquiryInfoSendBinding] === value,
            ) ||
            !(await resolveCurrent(frozen))
          )
            return null;
          const consumedClaim = randomUUID();
          const statements = enquiryInfoLockStatements(
            { appId: info!.appId, channelId: info!.channelId },
            [{ kind: "recipient_phone", phone: binding.recipientPhone }],
            [`woztell-phone:${binding.recipientPhone}`],
          );
          const rows = await transaction(
            [
              ...statements,
              {
                // CAS transfers this one reserved claim into its consumed permit. A second
                // process with the original operation id cannot cross the I/O boundary.
                statement: `WITH source_check AS MATERIALIZED (
                  SELECT ${enquiryInfoSourceWitnessSql("t.routing_snapshot")} AS matches
                  FROM staff_notification_attempts t WHERE t.id=$1::uuid
                ), permit AS (
                  UPDATE staff_notification_attempts t SET claim_id=$8::uuid,updated_at=now()
                  FROM enquiry_notification_recipients r,ops_jobs j
                  WHERE t.id=$1::uuid AND t.claim_id=$5::uuid AND t.dispatch_state='dispatching'
                    AND t.job_id=$2::uuid AND ${eligibleSql} AND j.id=t.job_id AND ${lease()} AND ${samePayload}
                    AND (SELECT matches FROM source_check) RETURNING t.id
                ) SELECT (SELECT id FROM permit) AS id,(SELECT matches FROM source_check) AS source_matches`,
                params: [...args, consumedClaim, ...enquiryInfoSourceWitnessParams],
              },
            ],
            { isolationLevel: "ReadCommitted" },
          );
          const checked = rows[rows.length - 1]?.[0];
          if (!checked?.id) {
            sourceMismatch = checked?.source_matches === false;
            return null;
          }
          ownedClaim = consumedClaim;
          permitConsumed = true;
          return Object.freeze({ ...binding });
        },
      });
      result = await transport.sendTemplateByPhone({
        binding,
        templateContract: runtime.template!,
        template,
        beforeSend,
      });
      if (result.state === "accepted" && (!boundaryPassed || !permitConsumed))
        result = { state: "unknown" };
    } catch (error) {
      const preflight =
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "STAFF_NOTIFICATION_PREFLIGHT_BLOCKED";
      // The informational factory guarantees this code means no provider fetch,
      // including permit denial after beforeSend has already succeeded.
      if (preflight || (!boundaryPassed && boundaryFailed)) result = { state: "suppressed" };
    }
    await query(
      "UPDATE staff_notification_attempts SET dispatch_state=$3,evidence_kind=$4,provider_operation_id=$5,provider_accepted_at=CASE WHEN $3='accepted' THEN COALESCE(provider_accepted_at,now()) ELSE provider_accepted_at END,provider_acceptance_source=CASE WHEN $3='accepted' THEN COALESCE(provider_acceptance_source,'woztell_send_responses') ELSE provider_acceptance_source END,safe_error=CASE WHEN $3='unknown' THEN 'provider_outcome_unknown' WHEN $3='failed' THEN 'provider_refused' WHEN $3='suppressed' THEN CASE WHEN $6::boolean THEN 'source_witness_mismatch' ELSE 'dispatch_eligibility_changed' END ELSE NULL END,finished_at=now(),updated_at=now() WHERE id=$1::uuid AND claim_id=$2::uuid AND dispatch_state IN ('dispatching','unknown')",
      [
        attempt.id,
        ownedClaim,
        result.state,
        "evidenceKind" in result ? (result.evidenceKind ?? null) : null,
        "providerOperationId" in result ? (result.providerOperationId ?? null) : null,
        sourceMismatch,
      ],
    );
    if (result.state === "accepted") summary.accepted++;
    else if (result.state === "unknown") summary.unknown++;
    else summary.blocked++;
  }
  return { summary };
}
export { ENQUIRY_FORWARD_JOB, forwardingPhone };
export type { DbRow };
