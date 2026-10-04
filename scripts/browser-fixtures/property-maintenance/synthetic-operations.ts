// Real route/state/permission policy; synthetic control-plane results only.
import { operationsCapabilitiesForRoles } from "../../../src/lib/control-plane/capabilities";
import { OperationsClientError } from "../../../src/lib/admin/operations/operations-client";
import type { JobListItem, AuditRow } from "../../../src/lib/admin/operations/operations-types";
export { OperationsClientError };
const key = "operations-fixture-jobs";
const job: JobListItem = {
  id: "40000000-0000-4000-8000-000000000001",
  jobType: "ai.knowledge.repair",
  payloadVersion: 1,
  status: "failed",
  attemptCount: 1,
  maxAttempts: 3,
  runAfter: "2026-10-03T01:00:00Z",
  leaseExpiresAt: null,
  errorCode: "AI_KNOWLEDGE_REPAIR_FAILED",
  createdAt: "2026-10-03T00:00:00Z",
  updatedAt: "2026-10-03T01:00:00Z",
};
const state = {
  mode: "ok",
  calls: [] as { name: string; id?: string }[],
  releaseOldRead: null as null | (() => void),
};
declare global {
  interface Window {
    operationsFixture: typeof state;
  }
}
window.operationsFixture = state;
const rows = (): JobListItem[] => JSON.parse(localStorage.getItem(key) ?? JSON.stringify([job]));
const call = (name: string, id?: string) => state.calls.push({ name, id });
export async function fetchOperationsHealth() {
  call("health");
  return {
    requestId: "synthetic-health",
    data: {
      status: "degraded",
      checkedAt: "2026-10-03T01:00:00Z",
      checks: [],
      capabilities: operationsCapabilitiesForRoles([window.propertyFixture.role]),
    },
  };
}
export async function fetchOperationsJobs() {
  call("jobs");
  if (state.mode === "read-fail")
    throw new OperationsClientError(
      "未能載入背景工作，請稍後核對。",
      503,
      "OWNED_READ_FAILED",
      "synthetic-read-ref",
      false,
    );
  const saved = rows();
  if (state.mode === "deferred")
    await new Promise<void>((done) => {
      state.releaseOldRead = done;
    });
  return {
    requestId: "synthetic-jobs",
    data: {
      rows: saved,
      nextCursor: null,
      summary: {
        counts: {
          queued: saved.filter((row) => row.status === "queued").length,
          failed: saved.filter((row) => row.status === "failed").length,
          running: 0,
          succeeded: 0,
          cancelled: 0,
        },
        attention: saved,
      },
    },
  };
}
export async function retryOperationsJob(id: string) {
  call("retry", id);
  if (state.mode === "denied")
    throw new OperationsClientError(
      "權限已撤回，未有執行重試。",
      403,
      "FORBIDDEN",
      "synthetic-denied-ref",
      false,
    );
  const saved = rows();
  saved[0].status = "queued";
  localStorage.setItem(key, JSON.stringify(saved));
  if (state.mode === "unknown")
    throw new OperationsClientError(
      "未能確認指令結果，請先讀回原工作。",
      502,
      "INVALID_RESPONSE",
      "synthetic-unknown-ref",
      false,
    );
  localStorage.setItem(
    "operations-fixture-audit",
    JSON.stringify([
      {
        id: "50000000-0000-4000-8000-000000000001",
        actor_staff_id: "20000000-0000-4000-8000-000000000001",
        permission: "system.jobs.retry",
        action: "job.retry",
        resource_type: "job",
        resource_id: id,
        outcome: "success",
        request_id: "synthetic-retry-ref",
        metadata: {},
        created_at: "2026-10-03T01:00:00Z",
      },
    ]),
  );
  if (state.mode === "deferred-command")
    await new Promise<void>((release) =>
      window.propertyFixture.pending.push({ kind: "job-retry", release }),
    );
  call("retry-return", id);
  return { requestId: "synthetic-retry-ref", data: { id, status: "queued" } };
}
export const cancelOperationsJob = async () => {
  throw Error("No cancel operation authorized by fixture");
};
export const fetchOperationsAudit = async (): Promise<{
  requestId: string;
  data: { rows: AuditRow[]; nextCursor: null };
}> => ({
  requestId: "synthetic-audit",
  data: {
    rows: JSON.parse(localStorage.getItem("operations-fixture-audit") ?? "[]"),
    nextCursor: null,
  },
});
export const fetchOperationsMigrations = async () => ({
  requestId: "synthetic-migrations",
  data: [],
});
export const planOperationsMigration = async () => {
  throw Error("Migration forbidden in owned UI fixture");
};
export const applyOperationsMigration = async () => {
  throw Error("Migration forbidden in owned UI fixture");
};
export const fetchWhatsappServiceHealth = async () => {
  throw Error("Provider/schema/revision intentionally unverified in this UI fixture");
};
