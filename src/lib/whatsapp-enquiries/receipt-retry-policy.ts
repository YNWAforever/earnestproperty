// The one retry rule for WhatsApp inbound receipts. Recovery claims exactly the
// rows RECEIPT_RETRYABLE_SQL matches, and the service lane's nextDueAt is the
// earliest RECEIPT_DUE_AT_SQL among RECEIPT_ELIGIBLE_SQL rows, so the alarm can
// never be armed for a receipt that recovery would refuse (no 1 s hot-loop).
// Pure: string constants only, no imports.

export const RECEIPT_MAX_ATTEMPTS = 20;

/** Rows recovery may ever retry: state in (pending,blocked_schema,failed), attempt_count < 20, block_reason ≠ REVIEW_REQUIRED. */
export function RECEIPT_ELIGIBLE_SQL(alias: string): string {
  return `(${alias}.projection_state IN ('pending','blocked_schema','failed')
    AND ${alias}.attempt_count < ${RECEIPT_MAX_ATTEMPTS}
    AND ${alias}.block_reason IS DISTINCT FROM 'REVIEW_REQUIRED')`;
}

/**
 * When an eligible receipt may next be claimed: after any live lease and after an
 * exponential backoff from its last touch (2 min, 4 min, … capped at 1 h).
 * A pending receipt has attempt 1, so it waits 2 min: the grace for a webhook
 * inline projection that may still be running.
 */
export function RECEIPT_DUE_AT_SQL(alias: string): string {
  return `greatest(coalesce(${alias}.lease_until,'-infinity'::timestamptz), ${alias}.updated_at + least(interval '2 minutes' * power(2, greatest(${alias}.attempt_count-1,0)), interval '1 hour'))`;
}

/**
 * The in-flight grace: a receipt is left alone for 2 minutes after its last touch, because the
 * webhook's inline projection (or another claimer) may still be running. Recovery and manual
 * retry both require it, so neither can project a receipt the webhook is still projecting.
 */
export function RECEIPT_INFLIGHT_GRACE_SQL(alias: string): string {
  return `${alias}.updated_at <= now() - interval '2 minutes'`;
}

/** The lease claim shared by recovery and manual retry (target alias `r`): 60 s lease, one more attempt. */
export const RECEIPT_CLAIM_SET_SQL =
  "lease_until=now()+interval '60 seconds',attempt_count=r.attempt_count+1,updated_at=now()";

/** ELIGIBLE AND DUE_AT <= now() — the exact claim predicate. */
export function RECEIPT_RETRYABLE_SQL(alias: string): string {
  return `(${RECEIPT_ELIGIBLE_SQL(alias)} AND ${RECEIPT_INFLIGHT_GRACE_SQL(alias)} AND ${RECEIPT_DUE_AT_SQL(alias)} <= now())`;
}
