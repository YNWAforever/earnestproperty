export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

const maxRetryDelayMs = 15 * 60 * 1_000;

export function retryDelayMs(attemptCount: number) {
  const boundedAttempt = Math.max(0, Math.min(Math.trunc(attemptCount), 30));
  return Math.min(2 ** boundedAttempt * 1_000, maxRetryDelayMs);
}

export function jobFailureTransition(input: {
  attemptCount: number;
  maxAttempts: number;
  retryable: boolean;
  nowMs: number;
}): { status: "queued" | "failed"; runAfterMs: number | null } {
  if (input.retryable && input.attemptCount < input.maxAttempts) {
    return {
      status: "queued",
      runAfterMs: input.nowMs + retryDelayMs(input.attemptCount),
    };
  }
  return { status: "failed", runAfterMs: null };
}

export function manualRetryTransition(input: {
  status: JobStatus;
  attemptCount: number;
  maxAttempts: number;
}): { status: "queued"; maxAttempts: number } | null {
  if (input.status !== "failed" && input.status !== "cancelled") return null;
  return {
    status: "queued",
    maxAttempts: input.attemptCount + 1,
  };
}

export function canCancelJob(status: JobStatus) {
  return status === "queued" || status === "running" || status === "failed";
}

/**
 * Idempotency key for a campaign's WhatsApp delivery job.
 *
 * Deliberately scoped to a single queue RUN, not to the campaign. The key was
 * previously just `woztell.campaign.deliver:${campaignId}`, which made a
 * campaign un-sendable for good: enqueueJob's ON CONFLICT is a no-op that
 * returns the existing row, so once that row reached a terminal state
 * ('succeeded', or 'failed' after max_attempts) every later enqueue -- from the
 * admin button and from the send-queue cron alike -- got the dead row back.
 * The route answered 202 with that job's status, the UI reported success, and
 * nothing was ever in 'queued' for a worker to pick up.
 *
 * `queueRunAt` is whatsapp_campaigns.reviewed_at, re-stamped on every queue
 * flip. Both enqueue paths derive the key from the row, so concurrent enqueues
 * of the same run still collapse to one job -- which is what stops a
 * re-materialized campaign being delivered twice.
 *
 * The timestamp is normalised to epoch milliseconds rather than used verbatim,
 * because the two callers do NOT hand over the same string for the same row:
 * the admin route gets the driver's Date via toISOString()
 * ("2026-08-11T02:00:00.000Z") while the cron reads timestamptz::text from
 * Postgres ("2026-08-11 02:00:00+00"). Interpolating those directly would give
 * two different keys for one queue run, so both paths would enqueue -- and the
 * campaign would be delivered twice, to real customers, billably. Normalising
 * here keeps the key immune to representation drift on either side.
 */
export function campaignDeliveryIdempotencyKey(campaignId: string, queueRunAt: string) {
  const parsed = new Date(queueRunAt);
  const runToken = Number.isNaN(parsed.getTime())
    ? // Unparseable: fall back to the raw value rather than collapsing every
      // bad timestamp onto one key, which would suppress real enqueues.
      queueRunAt
    : String(parsed.getTime());
  return `woztell.campaign.deliver:${campaignId}:${runToken}`;
}
