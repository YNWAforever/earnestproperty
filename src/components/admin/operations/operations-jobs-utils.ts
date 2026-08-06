import type { JobListItem, JobStatus } from "@/lib/admin/operations/operations-types";

/** Pure state/pagination rules behind the jobs panel.
 *
 * Extracted from AdminOperationsJobs.tsx so that file exports only components
 * (react-refresh/only-export-components).
 */

export const canRetryOperationsJob = (status: JobStatus) =>
  status === "failed" || status === "cancelled";

export const canCancelOperationsJob = (status: JobStatus) =>
  status === "queued" || status === "running" || status === "failed";

export type JobRowMergeMode = "replace" | "append" | "refresh";

export const mergeOperationsJobRows = (
  current: JobListItem[],
  incoming: JobListItem[],
  mode: JobRowMergeMode,
): JobListItem[] => {
  if (mode === "append") return [...current, ...incoming];
  if (mode === "replace") return incoming;

  // "refresh" is the 30s background tick, which can only ever fetch page 1.
  // Replacing outright discarded every extra page the operator had loaded --
  // click Load more to 100 rows and the list snapped back to 25 half a minute
  // later, mid-read. Instead, update rows already held in place and prepend
  // only genuinely new ones, so deeper pages survive the tick.
  const incomingById = new Map(incoming.map((row) => [row.id, row]));
  const known = new Set(current.map((row) => row.id));
  return [
    ...incoming.filter((row) => !known.has(row.id)),
    ...current.map((row) => incomingById.get(row.id) ?? row),
  ];
};

export const shouldRefreshOperationsJobs = ({
  active,
  jobsRead,
  pending,
  previousPulse,
  pulse,
}: {
  active: boolean;
  jobsRead: boolean;
  pending: boolean;
  previousPulse: number;
  pulse: number;
}) => active && jobsRead && !pending && pulse !== previousPulse;
