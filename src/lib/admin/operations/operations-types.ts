import type { OperationsCapabilities } from "../../control-plane/capabilities.ts";

export type OperationTab = "overview" | "jobs" | "audit" | "migrations";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type HealthStatus = "healthy" | "degraded" | "failed";
export type HealthData = {
  status: HealthStatus;
  checks: Array<{
    key: string;
    required: boolean;
    status: HealthStatus;
    details?: Record<string, boolean>;
  }>;
  checkedAt: string;
  capabilities: OperationsCapabilities;
};
export type JobListItem = {
  id: string;
  jobType: string;
  payloadVersion: number;
  status: JobStatus;
  attemptCount: number;
  maxAttempts: number;
  runAfter: string;
  leaseExpiresAt: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
};
export type JobSummary = {
  counts: Record<JobStatus, number>;
  attention: Array<
    Pick<
      JobListItem,
      | "id"
      | "jobType"
      | "status"
      | "attemptCount"
      | "maxAttempts"
      | "leaseExpiresAt"
      | "errorCode"
      | "updatedAt"
    >
  >;
};
export type JobsPage = { rows: JobListItem[]; nextCursor: string | null; summary: JobSummary };
export type AuditRow = {
  id: string;
  actor_staff_id: string;
  permission: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  outcome: "success" | "failure" | "denied";
  request_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
};
export type AuditPage = { rows: AuditRow[]; nextCursor: string | null };
export type MigrationState = {
  id: string;
  checksum: string;
  dependencies: string[];
  summary: string;
  postconditions: Array<{ relation: string; column?: string }>;
  status: "pending" | "applied" | "drift";
  /** Only present on drift: the checksum recorded when the migration ran. */
  recordedChecksum?: string | null;
};
export type MigrationPlan = {
  migrationId: string;
  checksum: string;
  dependencies: string[];
  summary: string;
  schemaFingerprint: string;
  approvalToken: string;
};
