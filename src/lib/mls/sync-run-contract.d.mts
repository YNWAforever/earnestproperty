export type SyncStageStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "unknown"
  | "cancelled";
export type SyncHealth =
  | "never_synced"
  | "healthy"
  | "running"
  | "stale"
  | "failed"
  | "blocked"
  | "unknown";
export interface SyncStage {
  status: SyncStageStatus;
  stage?: string;
  receiptId?: string;
  errorCode?: string;
  startedAt?: string;
  finishedAt?: string;
  reconciled?: boolean;
  pagesRead?: number;
  pagesFailed?: number;
}
export interface SyncRunSummary {
  runId?: string;
  source?: string;
  scopeId?: string;
  policyVersion?: string;
  parserVersion?: string;
  requestHash?: string;
  gitSha?: string;
  workflowRunId?: string;
  startedAt?: string;
  finishedAt?: string;
  lastAcceptedFullAt?: string | null;
  enabled?: boolean;
  readFailed?: boolean;
  dryRun?: boolean;
  stages?: Record<string, SyncStage>;
  branches?: Record<string, unknown>;
  counts?: Record<string, number>;
  privateEvidenceRef?: Record<string, string>;
}
export const SYNC_STAGES: readonly string[];
export const SYNC_STATUSES: readonly SyncStageStatus[];
export function transitionStage(previous: SyncStage, event: SyncStage): SyncStage;
export function validateRunSummary<T extends SyncRunSummary>(summary: T): T;
export function deriveSyncHealth(summary: SyncRunSummary, now?: number): SyncHealth;
