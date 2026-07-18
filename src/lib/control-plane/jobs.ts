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
