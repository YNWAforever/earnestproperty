import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { queryRows, transactionRows } from "../db.server.ts";
import { resolveHistoricalLead } from "../historical-lead-route.server.ts";
import { getHistoricalRecipientProof } from "../historical-recipient-proof.server.ts";
import { createStaffWhatsAppTransport } from "../../woztell/staff-whatsapp-transport.server.ts";
import {
  buildStaffTemplateResponse,
  formatCustomerPhone,
  type StaffAlertTemplate,
  type StaffTemplateResponse,
} from "../../woztell/staff-alert-template.ts";
import { staffWhatsappAlertRuntime } from "../../whatsapp-enquiries/staff-notifications.server.ts";
import { companyChannelId, providerChannelId } from "../../whatsapp-enquiries/wa-config.server.ts";
import { resolveSiteOrigin } from "../../../../scripts/site-origin.mjs";
import {
  HISTORICAL_RESEND_REASONS,
  HISTORICAL_RESEND_STALE_SECONDS,
  historicalResendAttemptKey,
  historicalResendFingerprint,
  historicalResendLedgerState,
  historicalResendMessage,
  historicalResendOutcome,
  historicalResendProofReasons,
} from "./historical-resend-dispatch.mjs";
import type {
  HistoricalLeadResolution,
  HistoricalResendActor,
  HistoricalResendDispatch,
  HistoricalResendLedger,
  HistoricalResendPorts,
  HistoricalResendPreview,
  HistoricalResendRuntime,
  HistoricalResendScan,
} from "./historical-resend-dispatch.types.ts";
import type { HistoricalRecipientProof } from "../historical-recipient-proof.types.ts";

/**
 * Reviewed historical staff resend (phone transport only).
 *
 * One authenticated admin/manager decision per historical lead + staff member.
 * The signed recipient proof is the only identity/purpose authority; this module
 * never re-derives it and never asks the staff user to reconfirm anything. The
 * claim, the immutable decision row and the attempt ledger are keyed per
 * lead+staff, so an endpoint-version change can never resend. `preview` is
 * strictly read-only (it even derives staleness without writing). Only the
 * dispatch path may reconcile a dead `dispatching` row to `unknown`, and nothing
 * here retries a provider call whose outcome is unknown.
 */

const pairInput = z.object({ leadId: z.string().uuid(), staffId: z.string().uuid() }).strict();
const dispatchInput = pairInput
  .extend({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    confirm: z.literal(true),
    decisionNote: z.string().trim().max(200).optional(),
  })
  .strict();

const PHONE_TEMPLATE_PARAMS = "name,source,phone,link";

/** The approved staff alert template, phone route only. */
function phoneTemplateReady(template: StaffAlertTemplate | null) {
  return (
    template?.name === "staff_enquiry_followup" &&
    template.language === "zh_HK" &&
    template.params.join(",") === PHONE_TEMPLATE_PARAMS
  );
}

/** Auth is the only business-adjacent failure that throws by design. */
async function authorize(actor: HistoricalResendActor, ports: HistoricalResendPorts) {
  if (!actor.roles.some((role) => role === "admin" || role === "manager"))
    throw new Response("Forbidden", { status: 403 });
  const [row] = await ports.query(
    "SELECT s.id FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$1::uuid AND s.active AND r.role IN ('admin','manager') LIMIT 1",
    [actor.staffId],
  );
  if (!row) throw new Response("Forbidden", { status: 403 });
}

/** Digits-only comparison: one phone typed two ways is one destination. */
function destinationDigits(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

/**
 * Read the attempt ledger without writing. A `dispatching` row older than the
 * stale window is derived as `unknown`: the synchronous caller that owned it is
 * gone, and no provider call may be retried. Preview never persists that.
 */
async function readLedger(
  ports: HistoricalResendPorts,
  leadId: string,
  staffId: string,
): Promise<HistoricalResendLedger> {
  const [row] = await ports.query(
    `SELECT id,
       CASE WHEN dispatch_state='dispatching'
             AND (dispatch_started_at IS NULL OR dispatch_started_at < now()-make_interval(secs => $2))
            THEN 'unknown' ELSE dispatch_state END AS dispatch_state,
       provider_operation_id
       FROM staff_notification_attempts WHERE attempt_key=$1`,
    [historicalResendAttemptKey(leadId, staffId), HISTORICAL_RESEND_STALE_SECONDS],
  );
  if (!row) return { state: "idle", dispatchState: null, attemptId: null };
  return {
    state: historicalResendLedgerState(row.dispatch_state),
    dispatchState: String(row.dispatch_state),
    attemptId: String(row.id),
    providerOperationId:
      row.provider_operation_id == null ? null : String(row.provider_operation_id),
  };
}

/** Writable reconciliation, called by the dispatch path only. */
async function reconcileStaleAttempt(
  ports: HistoricalResendPorts,
  leadId: string,
  staffId: string,
) {
  return ports.query(
    `UPDATE staff_notification_attempts SET dispatch_state='unknown',safe_error='lease_expired_after_dispatch',finished_at=now(),updated_at=now()
      WHERE attempt_key=$1 AND dispatch_state='dispatching'
        AND (dispatch_started_at IS NULL OR dispatch_started_at < now()-make_interval(secs => $2))
      RETURNING id`,
    [historicalResendAttemptKey(leadId, staffId), HISTORICAL_RESEND_STALE_SECONDS],
  );
}

async function readLinkedSubjects(
  ports: HistoricalResendPorts,
  leadId: string,
  inquiryId: string | null,
) {
  const [row] = await ports.query(
    `SELECT
       ARRAY(SELECT l.id FROM crm_leads l WHERE l.id=$1::uuid OR (l.contact_id IS NOT NULL AND l.contact_id=(SELECT contact_id FROM crm_leads WHERE id=$1::uuid)) ORDER BY l.created_at) AS lead_ids,
       ARRAY(SELECT i.id FROM inquiries i WHERE i.crm_lead_id=$1::uuid OR i.id=$2::uuid
         OR (i.crm_contact_id IS NOT NULL AND i.crm_contact_id=(SELECT contact_id FROM crm_leads WHERE id=$1::uuid))
         OR (i.conversation_id IS NOT NULL AND i.conversation_id=(SELECT conversation_id FROM inquiries WHERE id=$2::uuid))) AS inquiry_ids`,
    [leadId, inquiryId],
  );
  return {
    leadIds: (row?.lead_ids as string[] | null) ?? [leadId],
    inquiryIds: (row?.inquiry_ids as string[] | null) ?? [],
  };
}

/**
 * Conservative duplicate scan across every alias of the same subject: linked
 * leads/inquiries for the same contact or conversation, routing snapshots,
 * forwarding recipients, frozen destination snapshots and pending jobs
 * (`leadId`/`subjectId` payloads). Attribution uses the frozen destination, not
 * today's mutable endpoint. A row whose recipient cannot be proven is illegible
 * and blocks rather than guessing. Customer outbound intents are NOT a
 * duplicate signal for a staff resend and are deliberately excluded.
 */
async function scanDuplicateAliases(
  ports: HistoricalResendPorts,
  input: {
    leadId: string;
    inquiryId: string | null;
    staffId: string;
    destinationReference: string;
    excludeAttemptId: string | null;
  },
): Promise<HistoricalResendScan> {
  const { leadIds, inquiryIds } = await readLinkedSubjects(ports, input.leadId, input.inquiryId);
  const attempts = await ports.query(
    `SELECT t.id,t.dispatch_state,t.endpoint_id,t.forwarding_recipient_id,
        e.staff_id,COALESCE(t.destination_reference_snapshot,e.destination_reference) AS destination_reference,
        r.staff_id AS forwarding_staff_id,r.phone AS forwarding_phone
       FROM staff_notification_attempts t
       LEFT JOIN staff_notification_endpoints e ON e.id=t.endpoint_id
       LEFT JOIN enquiry_notification_recipients r ON r.id=t.forwarding_recipient_id
      WHERE (t.lead_id=ANY($1::uuid[]) OR t.forwarding_inquiry_id=ANY($2::uuid[])
        OR t.notification_id IN (SELECT id FROM staff_notification_intents WHERE inquiry_id=ANY($2::uuid[]))
        OR t.routing_snapshot->>'subjectId'=ANY($2::text[])
        OR t.routing_snapshot->>'leadId'=ANY($1::text[]))
        AND t.dispatch_state IN ('queued','dispatching','accepted','delivered','unknown')
        AND ($3::uuid IS NULL OR t.id<>$3::uuid)`,
    [leadIds, inquiryIds, input.excludeAttemptId],
  );
  const jobs = await ports.query(
    `SELECT id FROM ops_jobs
      WHERE status IN ('queued','running')
        AND (payload->>'leadId'=ANY($1::text[]) OR payload->>'subjectId'=ANY($2::text[]) OR payload->>'subjectId'=$3)`,
    [leadIds.map(String), inquiryIds.map(String), input.leadId],
  );
  const ours = destinationDigits(input.destinationReference);
  const scan: HistoricalResendScan = {
    originalJobsPending: jobs.length > 0,
    inFlight: false,
    priorRecipient: false,
    illegible: false,
  };
  for (const row of attempts) {
    if (row.dispatch_state === "queued" || row.dispatch_state === "dispatching") {
      scan.inFlight = true;
      continue;
    }
    const hasEndpoint = row.endpoint_id != null;
    const hasForwarding = row.forwarding_recipient_id != null;
    if (!hasEndpoint && !hasForwarding) {
      scan.illegible = true;
      continue;
    }
    const forwardingResolved = hasForwarding
      ? row.forwarding_staff_id != null || row.forwarding_phone != null
      : true;
    const endpointResolved = hasEndpoint
      ? row.staff_id != null || row.destination_reference != null
      : true;
    if (!forwardingResolved || !endpointResolved) {
      scan.illegible = true;
      continue;
    }
    const sameStaff =
      (row.staff_id != null && String(row.staff_id) === input.staffId) ||
      (row.forwarding_staff_id != null && String(row.forwarding_staff_id) === input.staffId);
    const destination =
      destinationDigits(row.destination_reference) ?? destinationDigits(row.forwarding_phone);
    if (sameStaff || (ours != null && destination === ours)) scan.priorRecipient = true;
  }
  return scan;
}

function scanReasons(scan: HistoricalResendScan | null): string[] {
  if (!scan) return [];
  const reasons: string[] = [];
  if (scan.originalJobsPending) reasons.push(HISTORICAL_RESEND_REASONS.originalJobsPending);
  if (scan.inFlight) reasons.push(HISTORICAL_RESEND_REASONS.crossRouteInFlight);
  if (scan.priorRecipient) reasons.push(HISTORICAL_RESEND_REASONS.recipientAlreadySent);
  if (scan.illegible) reasons.push(HISTORICAL_RESEND_REASONS.duplicateReviewRequired);
  return reasons;
}

type Evaluation = {
  reasons: string[];
  channelId: string;
  lead: HistoricalLeadResolution | null;
  proof: HistoricalRecipientProof | null;
  message: string | null;
  template: StaffTemplateResponse | null;
  fingerprint: string | null;
  ledger: HistoricalResendLedger;
  scan: HistoricalResendScan | null;
  checkedAt: string;
};

/** Shared preview/dispatch evaluation: one fingerprint, one reason list. */
async function evaluate(
  value: { leadId: string; staffId: string },
  ports: HistoricalResendPorts,
  options: { excludeAttemptId: string | null } = { excludeAttemptId: null },
): Promise<Evaluation> {
  const reasons: string[] = [];
  const runtime: HistoricalResendRuntime = ports.runtime();
  const channelId = ports.channelId();
  if (!channelId) reasons.push(HISTORICAL_RESEND_REASONS.channelUnconfigured);
  if (!runtime.enabled) reasons.push(HISTORICAL_RESEND_REASONS.runtimeDisabled);
  if (!runtime.template) reasons.push(HISTORICAL_RESEND_REASONS.templateUnconfigured);
  if (channelId && runtime.channelId !== channelId)
    reasons.push(HISTORICAL_RESEND_REASONS.channelMismatch);
  const origin = ports.origin();
  if (!origin?.startsWith("https://")) reasons.push(HISTORICAL_RESEND_REASONS.originUnconfigured);
  let transportOk = true;
  try {
    const transport = ports.transport();
    transportOk = Boolean(transport.verificationRef && transport.sendStaffWhatsAppByPhone);
  } catch {
    transportOk = false;
  }
  if (!transportOk) reasons.push("transport_capability_unverified");
  const base: Evaluation = {
    reasons,
    channelId: channelId ?? "",
    lead: null,
    proof: null,
    message: null,
    template: null,
    fingerprint: null,
    ledger: { state: "idle", dispatchState: null, attemptId: null },
    scan: null,
    checkedAt: ports.now().toISOString(),
  };
  if (!channelId) return base;
  const lead = await ports.resolveLead(value.leadId, channelId);
  if (!lead) {
    reasons.push(HISTORICAL_RESEND_REASONS.leadNotFound);
    return base;
  }
  base.lead = lead;
  if (!lead.staffIds.includes(value.staffId)) {
    reasons.push(HISTORICAL_RESEND_REASONS.recipientNotInScope);
    return base;
  }
  const proof = await ports.recipientProof(value.staffId, channelId);
  base.proof = proof;
  reasons.push(...historicalResendProofReasons(proof, channelId, value.staffId));
  if (proof && proof.eligible !== true) reasons.push(HISTORICAL_RESEND_REASONS.proofNotReady);
  const ledger = await readLedger(ports, value.leadId, value.staffId);
  base.ledger = ledger;
  if (ledger.attemptId && ledger.attemptId !== options.excludeAttemptId) {
    if (ledger.state === "sent") reasons.push(HISTORICAL_RESEND_REASONS.recipientAlreadySent);
    else if (ledger.state === "unknown")
      reasons.push(HISTORICAL_RESEND_REASONS.ledgerUnknownPermanent);
    else if (ledger.state === "in_flight")
      reasons.push(HISTORICAL_RESEND_REASONS.crossRouteInFlight);
    else reasons.push(HISTORICAL_RESEND_REASONS.ledgerTerminal);
  }
  if (!proof || !runtime.template || !origin?.startsWith("https://")) return base;
  let template: StaffTemplateResponse | null = null;
  try {
    template = buildStaffTemplateResponse(runtime.template, {
      name: String(lead.customerName ?? ""),
      source: String(lead.sourceLabel ?? ""),
      phone: formatCustomerPhone(lead.customerPhone ?? null),
      link: `${origin}/admin/leads?lead=${lead.leadId}`,
    });
  } catch {
    reasons.push(HISTORICAL_RESEND_REASONS.templateUnconfigured);
    return base;
  }
  if (!phoneTemplateReady(runtime.template)) {
    reasons.push(HISTORICAL_RESEND_REASONS.templateUnconfigured);
    return base;
  }
  const message = historicalResendMessage(lead.sourceLabel);
  const fingerprint = historicalResendFingerprint({
    leadFingerprint: lead.fingerprint,
    proofFingerprint: proof.fingerprint,
    leadId: lead.leadId,
    staffId: value.staffId,
    channelId,
    transport: proof.transport,
    endpointId: proof.endpointId,
    endpointVersion: proof.endpointVersion,
    destinationReference: proof.destinationReference,
    message,
  });
  const scan = await scanDuplicateAliases(ports, {
    leadId: value.leadId,
    inquiryId: lead.inquiryId,
    staffId: value.staffId,
    destinationReference: proof.destinationReference,
    excludeAttemptId: options.excludeAttemptId,
  });
  reasons.push(...scanReasons(scan));
  return { ...base, template, message, fingerprint, scan };
}

/** Read-only preview. Never writes, never sends, never throws for business reasons. */
export async function previewHistoricalStaffResend(
  value: unknown,
  actor: HistoricalResendActor,
  ports: HistoricalResendPorts = historicalResendPorts(),
): Promise<HistoricalResendPreview> {
  const input = pairInput.parse(value);
  await authorize(actor, ports);
  const result = await evaluate(input, ports);
  const proof = result.proof;
  return {
    ready: result.reasons.length === 0,
    eligible: proof?.eligible === true,
    reasons: [...new Set(result.reasons)],
    leadId: input.leadId,
    inquiryId: result.lead?.inquiryId ?? null,
    createdAt: result.lead?.createdAt ?? null,
    sourceLabel: result.lead?.sourceLabel ?? null,
    staffId: input.staffId,
    staffName: proof?.staffName ?? null,
    transport: "website_lead_phone",
    maskedDestination: proof?.maskedDestination ?? null,
    endpointVersion: proof?.endpointVersion ?? null,
    message: result.message,
    fingerprint: result.fingerprint,
    checkedAt: result.checkedAt,
    review: proof?.review ?? null,
    ledger: {
      state: result.ledger.state,
      dispatchState: result.ledger.dispatchState,
      attemptId: result.ledger.attemptId,
      providerOperationId: result.ledger.providerOperationId ?? null,
    },
  };
}

const CLAIM = `WITH claim AS (
  INSERT INTO staff_notification_attempts(lead_id,transport,endpoint_id,endpoint_version,destination_reference_snapshot,channel_id_snapshot,attempt_key,dispatch_state,claim_id,dispatch_started_at)
  VALUES($1::uuid,'staff_whatsapp',$2::uuid,$3,$4,$5,$6,'dispatching',$7::uuid,now())
  ON CONFLICT(attempt_key) DO NOTHING
  RETURNING id,claim_id
), decision AS (
  INSERT INTO historical_resend_decisions(lead_id,actor_staff_id,channel_id,staff_id,transport,endpoint_id,endpoint_version,attempt_id,fingerprint,decision,note)
  SELECT $1::uuid,$8::uuid,$5,$9::uuid,'website_lead_phone',$2::uuid,$3,c.id,$10,'approved_dispatch',$11
  FROM claim c ON CONFLICT(attempt_id) DO NOTHING
  RETURNING id
) SELECT c.id AS attempt_id,c.claim_id AS claim_id,d.id AS decision_id FROM claim c LEFT JOIN decision d ON true`;

export async function dispatchHistoricalStaffResend(
  value: unknown,
  actor: HistoricalResendActor,
  ports: HistoricalResendPorts = historicalResendPorts(),
): Promise<HistoricalResendDispatch> {
  const input = dispatchInput.parse(value);
  await authorize(actor, ports);
  // Only the writable path reconciles a dead synchronous dispatch. If one existed,
  // it becomes permanently unknown and the ledger below refuses to resend.
  await reconcileStaleAttempt(ports, input.leadId, input.staffId);
  const current = await evaluate(input, ports);
  if (current.reasons.length > 0) {
    const sent = current.ledger.state === "sent" || current.ledger.state === "unknown";
    return {
      ok: false,
      state: sent ? "duplicate" : "blocked",
      reason: current.reasons[0],
      attemptId: current.ledger.attemptId,
      decisionId: null,
      providerOperationId: current.ledger.providerOperationId ?? null,
      dispatchState: current.ledger.dispatchState,
    };
  }
  if (input.fingerprint !== current.fingerprint)
    throw new Response("HISTORICAL_RESEND_STALE_PREVIEW", { status: 409 });
  const proof = current.proof!;
  const channelId = current.channelId;
  const claimId = randomUUID();
  const [, claimedRows] = await ports.transaction([
    { statement: "SELECT id FROM crm_leads WHERE id=$1::uuid FOR UPDATE", params: [input.leadId] },
    {
      statement: CLAIM,
      params: [
        input.leadId,
        proof.endpointId,
        proof.endpointVersion,
        proof.destinationReference,
        channelId,
        historicalResendAttemptKey(input.leadId, input.staffId),
        claimId,
        actor.staffId,
        input.staffId,
        input.fingerprint,
        input.decisionNote ?? null,
      ],
    },
  ]);
  const [claimed] = (claimedRows ?? []) as {
    attempt_id?: string;
    claim_id?: string;
    decision_id?: string;
  }[];
  if (!claimed?.attempt_id) {
    const existing = await readLedger(ports, input.leadId, input.staffId);
    if (existing.state === "sent" || existing.state === "unknown")
      return {
        ok: false,
        state: "duplicate",
        reason:
          existing.state === "unknown"
            ? HISTORICAL_RESEND_REASONS.ledgerUnknownPermanent
            : HISTORICAL_RESEND_REASONS.recipientAlreadySent,
        attemptId: existing.attemptId,
        decisionId: null,
        providerOperationId: existing.providerOperationId ?? null,
        dispatchState: existing.dispatchState,
      };
    return {
      ok: false,
      state: "blocked",
      reason:
        existing.state === "in_flight"
          ? HISTORICAL_RESEND_REASONS.crossRouteInFlight
          : HISTORICAL_RESEND_REASONS.ledgerTerminal,
      attemptId: existing.attemptId,
      decisionId: null,
      providerOperationId: null,
      dispatchState: existing.dispatchState,
    };
  }
  const attemptId = claimed.attempt_id;
  const decisionId = claimed.decision_id ?? null;
  let boundaryPassed = false;
  const beforeSend = async () => {
    // The actor must still be authorized at the boundary: a demoted session may
    // not ride a preview it obtained while still allowed.
    await authorize(actor, ports);
    const live = await evaluate(input, ports, { excludeAttemptId: attemptId });
    if (live.reasons.length > 0 || live.fingerprint !== input.fingerprint)
      throw new Error("HISTORICAL_RESEND_ELIGIBILITY_CHANGED");
    const [row] = await ports.query(
      "SELECT id FROM staff_notification_attempts WHERE id=$1::uuid AND claim_id=$2::uuid AND dispatch_state='dispatching'",
      [attemptId, claimId],
    );
    if (!row) throw new Error("HISTORICAL_RESEND_ELIGIBILITY_CHANGED");
    boundaryPassed = true;
  };
  let outcome: ReturnType<typeof historicalResendOutcome>;
  let suppressedReason: string | null = null;
  try {
    const result = await ports.transport().sendStaffWhatsAppByPhone!({
      channelId,
      phone: proof.destinationReference,
      message: current.message!,
      template: current.template,
      beforeSend,
    });
    outcome = historicalResendOutcome(result);
  } catch (error) {
    const preflight =
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "STAFF_NOTIFICATION_PREFLIGHT_BLOCKED";
    if (!boundaryPassed) {
      outcome = historicalResendOutcome({ state: "suppressed" });
      suppressedReason = preflight ? "transport_preflight_blocked" : "dispatch_eligibility_changed";
    } else outcome = historicalResendOutcome({ state: "unknown" });
  }
  await ports.query(
    `UPDATE staff_notification_attempts SET dispatch_state=$3,evidence_kind=$4,provider_operation_id=$5,
       provider_accepted_at=CASE WHEN $3 IN ('accepted','delivered') THEN COALESCE(provider_accepted_at,now()) ELSE provider_accepted_at END,
       provider_acceptance_source=CASE WHEN $3 IN ('accepted','delivered') THEN COALESCE(provider_acceptance_source,'woztell_send_responses') ELSE provider_acceptance_source END,
       safe_error=CASE WHEN $3='unknown' THEN 'provider_outcome_unknown' WHEN $3='failed' THEN 'provider_refused' WHEN $3='suppressed' THEN COALESCE($6,'transport_preflight_blocked') ELSE NULL END,
       finished_at=now(),updated_at=now()
     WHERE id=$1::uuid AND claim_id=$2::uuid AND dispatch_state IN ('dispatching','unknown')`,
    [
      attemptId,
      claimId,
      outcome.dispatchState,
      outcome.evidenceKind ?? null,
      outcome.providerOperationId ?? null,
      suppressedReason,
    ],
  );
  return {
    ok: outcome.dispatchState === "accepted",
    state: outcome.dispatchState,
    reason: outcome.ok ? null : (outcome.reason ?? null),
    attemptId,
    decisionId,
    providerOperationId: outcome.providerOperationId ?? null,
    dispatchState: outcome.dispatchState,
  };
}

/**
 * Production ports. The proof resolver is the signed, read-only server reader;
 * wrappers can call `previewHistoricalStaffResend(value, actor)` directly.
 */
export function historicalResendPorts(
  overrides: Partial<HistoricalResendPorts> = {},
): HistoricalResendPorts {
  const query = overrides.query ?? queryRows;
  return {
    query,
    transaction: overrides.transaction ?? transactionRows,
    resolveLead:
      overrides.resolveLead ??
      ((leadId, channelId) => resolveHistoricalLead(leadId, channelId, query)),
    recipientProof:
      overrides.recipientProof ??
      ((staffId, channelId) => getHistoricalRecipientProof(staffId, channelId, query)),
    transport: overrides.transport ?? (() => createStaffWhatsAppTransport()),
    runtime:
      overrides.runtime ??
      (() => {
        const runtime = staffWhatsappAlertRuntime();
        return {
          enabled: runtime.enabled,
          channelId: companyChannelId(),
          template: runtime.template,
        };
      }),
    channelId: overrides.channelId ?? (() => providerChannelId()),
    origin: overrides.origin ?? (() => resolveSiteOrigin()),
    now: overrides.now ?? (() => new Date()),
  };
}
