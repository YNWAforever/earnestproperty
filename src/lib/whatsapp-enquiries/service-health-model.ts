import type { StaffWhatsappReadiness } from "../neon/whatsapp-readiness.types.ts";
import { heartbeatIsStale, jobQueueThresholds } from "../control-plane/job-queue-health.ts";

export type StaffCoverage = {
  scope: string;
  eligibleStaff: number;
  assignmentReadyStaff: number;
  staffWhatsappReadyStaff: number;
  missingMappingStaff: number;
};

export function summarizeStaffCoverage(
  eligibleIds: readonly string[],
  readiness: readonly StaffWhatsappReadiness[],
  scope: string,
): StaffCoverage {
  const byId = new Map(readiness.map((item) => [item.staffId, item]));
  const unique = new Set(eligibleIds);
  let assignmentReadyStaff = 0;
  let staffWhatsappReadyStaff = 0;
  let missingMappingStaff = 0;
  for (const id of unique) {
    const item = byId.get(id);
    if (item?.assignment.state === "ready") assignmentReadyStaff++;
    if (item?.staffWhatsapp.state === "ready") staffWhatsappReadyStaff++;
    if (!item || item.assignment.reasons.some((reason) => reason.code === "mapping_missing"))
      missingMappingStaff++;
  }
  return {
    scope,
    eligibleStaff: unique.size,
    assignmentReadyStaff,
    staffWhatsappReadyStaff,
    missingMappingStaff,
  };
}

export function dueWorkHealth(input: {
  now: string;
  oldestDueAt: string | null;
  overdueJobs: number;
  expiredLeases: number;
  heartbeatAt: string | null;
  lagSeconds: number | null;
  /** Defaults to the HKT-clock threshold for `now` (FX-07 owner decision 4). */
  heartbeatStaleAfterMinutes?: number;
}) {
  const reasons: string[] = [];
  if (input.expiredLeases > 0) reasons.push("SERVICE_LEASE_EXPIRED");
  const oldest = input.oldestDueAt ? Date.parse(input.oldestDueAt) : Number.NaN;
  const lag =
    Number.isFinite(input.lagSeconds) && input.lagSeconds! > 0 ? input.lagSeconds! * 1000 : 0;
  if (input.overdueJobs > 0 && Number.isFinite(oldest) && Date.parse(input.now) - oldest > lag)
    reasons.push("SERVICE_DUE_WORK_OVERDUE");
  if (input.overdueJobs > 0 && !input.heartbeatAt) reasons.push("SERVICE_WORKER_NOT_OBSERVED");
  // With a scheduled sweep, a stale or missing service-lane heartbeat means the
  // worker is not reaching us, even when there is no work right now.
  const now = new Date(input.now);
  const staleAfter =
    input.heartbeatStaleAfterMinutes ?? jobQueueThresholds(now).heartbeatStaleMinutes;
  if (heartbeatIsStale(input.heartbeatAt, now, staleAfter)) reasons.push("SERVICE_WORKER_STALE");
  return reasons;
}
