export const SYNC_STAGES = Object.freeze([
  "collection",
  "ingestion",
  "publication",
  "verification",
]);
export const SYNC_STATUSES = Object.freeze([
  "pending",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "unknown",
  "cancelled",
]);
const terminal = new Set(["succeeded", "failed", "blocked", "cancelled"]);
export function transitionStage(previous, event) {
  if (!SYNC_STATUSES.includes(event.status)) throw Error("invalid_stage_status");
  if (terminal.has(previous.status) && previous.status !== event.status)
    throw Error("terminal_stage_transition");
  if (terminal.has(previous.status)) {
    if (Object.entries(event).some(([key, value]) => previous[key] !== value))
      throw Error("terminal_stage_change");
    return previous;
  }
  if (previous.status === "unknown" && event.status !== "unknown" && !event.reconciled)
    throw Error("reconciliation_required");
  if (event.stage === "ingestion" && event.status === "succeeded" && !event.receiptId)
    throw Error("ingestion_receipt_required");
  return { ...previous, ...event };
}
export function validateRunSummary(summary) {
  for (const clocks of [summary, ...Object.values(summary.stages ?? {})]) {
    const times = [clocks.startedAt, clocks.finishedAt].map((value) => {
      if (value === undefined) return undefined;
      if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
        !Number.isFinite(Date.parse(value))
      )
        throw Error("invalid_execution_timing");
      const [year, month, day, hour] = value.slice(0, 19).split(/[T:-]/).map(Number);
      const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (day > daysInMonth[month - 1] || hour > 23) throw Error("invalid_execution_timing");
      return Date.parse(value);
    });
    if (times[0] !== undefined && times[1] !== undefined && times[1] < times[0])
      throw Error("invalid_execution_timing");
  }
  const counts = summary.counts ?? {};
  for (const n of Object.values(counts))
    if (!Number.isSafeInteger(n) || n < 0) throw Error("invalid_actual_count");
  if (
    summary.dryRun &&
    ["canonicalCreated", "canonicalUpdated", "published"].some((k) => (counts[k] ?? 0) !== 0)
  )
    throw Error("dry_run_writes_forbidden");
  if (summary.stages?.ingestion?.status === "succeeded" && !summary.stages.ingestion.receiptId)
    throw Error("ingestion_receipt_required");
  if (
    summary.privateEvidenceRef &&
    JSON.stringify(summary.privateEvidenceRef).match(/https?:|token|password|authorization/i)
  )
    throw Error("private_evidence_reference_invalid");
  return summary;
}
export function deriveSyncHealth(summary, now = Date.now()) {
  if (summary.readFailed) return "unknown";
  const states = Object.values(summary.stages ?? {}).map((s) => s.status);
  const accepted = Date.parse(summary.lastAcceptedFullAt ?? "");
  if (Number.isFinite(accepted) && now - accepted >= 30 * 3600000) return "stale";
  if (states.includes("unknown")) return "unknown";
  if (states.includes("blocked")) return "blocked";
  if (states.some((s) => s === "failed" || s === "cancelled")) return "failed";
  if (states.includes("running")) return "running";
  if (!Number.isFinite(accepted)) return "never_synced";
  return "healthy";
}
