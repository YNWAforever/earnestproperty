/**
 * Pure decisions for a reviewed historical staff resend.
 *
 * No database, no `server-only` import, so `node --test` can exercise it and
 * `lead-alert.server.ts` can share the attempt-key prefix without a cycle.
 *
 * The reviewed rows live in `staff_notification_attempts` under a reserved
 * attempt-key prefix. Regular lead-alert workers must never claim, reconcile or
 * suppress them (a lost historical save must stay lost, not be re-sent by the
 * ordinary lane), and this module is the one place that prefix is spelled.
 */
import { createHash } from "node:crypto";

/** Reserved namespace in `staff_notification_attempts.attempt_key`. */
export const HISTORICAL_RESEND_ATTEMPT_PREFIX = "historical-resend:";
/** Reviewed historical resends only ever use the phone transport. */
export const HISTORICAL_RESEND_TRANSPORT = "website_lead_phone";
/** A dispatching row older than this is unknown: the synchronous caller died. */
export const HISTORICAL_RESEND_STALE_SECONDS = 300;
/** Canonical phone form stored by the endpoint migration. */
export const HISTORICAL_RESEND_PHONE = /^852[4-9][0-9]{7}$/;
export const HISTORICAL_RESEND_FINGERPRINT = /^[a-f0-9]{64}$/;
export const HISTORICAL_RESEND_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Bump when the approval payload changes shape; it invalidates old previews. */
export const HISTORICAL_RESEND_FINGERPRINT_VERSION = "historical-resend-v1";

export const HISTORICAL_RESEND_REASONS = Object.freeze({
  runtimeDisabled: "runtime_disabled",
  templateUnconfigured: "template_unconfigured",
  channelUnconfigured: "channel_unconfigured",
  originUnconfigured: "origin_unconfigured",
  channelMismatch: "channel_mismatch",
  leadNotFound: "lead_not_found",
  recipientNotInScope: "recipient_not_in_historical_scope",
  noRecipientProof: "no_recipient_proof",
  proofStaffMismatch: "proof_staff_mismatch",
  proofEndpointInvalid: "proof_endpoint_invalid",
  proofNotPhone: "proof_transport_not_phone",
  proofNotReady: "proof_not_ready",
  proofChannelMismatch: "proof_channel_mismatch",
  proofFingerprintInvalid: "proof_fingerprint_invalid",
  proofEndpointChanged: "proof_endpoint_changed",
  originalJobsPending: "original_jobs_pending",
  crossRouteInFlight: "cross_route_in_flight",
  recipientAlreadySent: "recipient_already_sent",
  duplicateReviewRequired: "duplicate_review_required",
  ledgerTerminal: "ledger_terminal",
  ledgerUnknownPermanent: "ledger_unknown_permanent",
});

/** One attempt per lead+staff, forever: an endpoint-version change must not resend. */
export function historicalResendAttemptKey(leadId, staffId) {
  return `${HISTORICAL_RESEND_ATTEMPT_PREFIX}${leadId}:${staffId}`;
}

export function isHistoricalResendAttemptKey(value) {
  return typeof value === "string" && value.startsWith(HISTORICAL_RESEND_ATTEMPT_PREFIX);
}

/** Evidence copy only; the approved template is what is actually sent. */
export function historicalResendMessage(sourceLabel) {
  return `歷史查詢補發：${String(sourceLabel ?? "").trim() || "新查詢"}`;
}

/**
 * CAS token for one preview. It binds the server-resolved historical lead
 * (including `resolveHistoricalLead`'s own fingerprint and the server-calculated
 * staff scope), the signed recipient proof (agent-1's fingerprint binds identity,
 * purpose, approved hours, directory identity and the reviewed conflict hash),
 * the exact endpoint identity/destination, the transport channel and the message.
 */
export function historicalResendFingerprint(parts) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        HISTORICAL_RESEND_FINGERPRINT_VERSION,
        parts.leadFingerprint,
        parts.proofFingerprint,
        parts.leadId,
        parts.staffId,
        parts.channelId,
        parts.transport,
        parts.endpointId,
        parts.endpointVersion,
        parts.destinationReference,
        parts.message,
      ]),
    )
    .digest("hex");
}

const PROOF_HEX = HISTORICAL_RESEND_FINGERPRINT;
const PHONE = HISTORICAL_RESEND_PHONE;
const UUID = HISTORICAL_RESEND_UUID;

/** Fail-closed classification of the signed proof: every ambiguity is a reason. */
export function historicalResendProofReasons(proof, channelId, staffId) {
  if (!proof) return [HISTORICAL_RESEND_REASONS.noRecipientProof];
  const reasons = [];
  if (proof.staffId !== staffId) reasons.push(HISTORICAL_RESEND_REASONS.proofStaffMismatch);
  if (!UUID.test(String(proof.endpointId ?? "")))
    reasons.push(HISTORICAL_RESEND_REASONS.proofEndpointInvalid);
  if (
    !Number.isSafeInteger(proof.endpointVersion) ||
    proof.endpointVersion <= 0 ||
    proof.endpointVersion > 2147483647
  )
    reasons.push(HISTORICAL_RESEND_REASONS.proofEndpointInvalid);
  if (proof.transport !== HISTORICAL_RESEND_TRANSPORT)
    reasons.push(HISTORICAL_RESEND_REASONS.proofNotPhone);
  if (proof.channelId !== channelId) reasons.push(HISTORICAL_RESEND_REASONS.proofChannelMismatch);
  if (!PHONE.test(String(proof.destinationReference ?? "")))
    reasons.push(HISTORICAL_RESEND_REASONS.proofEndpointChanged);
  if (!PROOF_HEX.test(String(proof.fingerprint ?? "")))
    reasons.push(HISTORICAL_RESEND_REASONS.proofFingerprintInvalid);
  const coded = Array.isArray(proof.reasons) ? proof.reasons : null;
  if (proof.ready !== true) {
    // `ready:false` with no code is still not a yes: never accept an empty reason list.
    if (coded && coded.length > 0) {
      for (const reason of coded) {
        reasons.push(`${HISTORICAL_RESEND_REASONS.proofNotReady}:${String(reason)}`);
      }
    } else reasons.push(HISTORICAL_RESEND_REASONS.proofNotReady);
  } else if (!coded || coded.length > 0) {
    // `ready:true` must carry an explicit empty reason array, not a missing one.
    reasons.push(HISTORICAL_RESEND_REASONS.proofNotReady);
  }
  return [...new Set(reasons)];
}

/**
 * Ledger classification. `accepted`/`delivered` (and any `unknown`) are
 * permanent: submission is at-most-once, so a repeat can only report the row.
 */
export function historicalResendLedgerState(state) {
  if (state === "accepted" || state === "delivered") return "sent";
  if (state === "unknown") return "unknown";
  if (state === "failed") return "failed";
  if (state === "suppressed") return "suppressed";
  if (state === "queued" || state === "dispatching") return "in_flight";
  return "idle";
}

export function isHistoricalResendPermanent(state) {
  return ["accepted", "delivered", "unknown", "failed", "suppressed"].includes(state);
}

/**
 * Provider outcome → attempt state. `accepted` needs no operation id (the
 * transport's authoritative parser decides acceptance) but returns one when the
 * provider supplied it, for delivery reconciliation. An uncertain outcome is
 * `unknown` forever and is never rewritten to accepted or failed.
 */
export function historicalResendOutcome(result) {
  const providerOperationId =
    typeof result?.providerOperationId === "string" && result.providerOperationId.trim()
      ? result.providerOperationId.trim()
      : null;
  if (result?.state === "accepted")
    return {
      dispatchState: "accepted",
      ok: true,
      evidenceKind: result.evidenceKind ?? null,
      providerOperationId,
    };
  if (result?.state === "failed")
    return {
      dispatchState: "failed",
      ok: false,
      reason: "provider_refused",
      providerOperationId,
    };
  if (result?.state === "suppressed")
    return {
      dispatchState: "suppressed",
      ok: false,
      reason: "transport_preflight_blocked",
      providerOperationId,
    };
  return {
    dispatchState: "unknown",
    ok: false,
    reason: "provider_outcome_unknown",
    providerOperationId,
  };
}
