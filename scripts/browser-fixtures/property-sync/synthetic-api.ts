// Owned route model only. No JWT, database, provider, crawl or worker is exercised.
import { useSyncExternalStore } from "react";
import {
  syncOperationSchema,
  syncOperationResultSchema,
  withdrawalPreviewSchema,
  withdrawalApplySchema,
  type WithdrawalRow,
  type SyncWorkspace,
} from "../../../src/lib/neon/admin-property-sync.types";
const state = {
  actor: sessionStorage.getItem("sync-fixture-actor") ?? "actor-a",
  role: sessionStorage.getItem("sync-fixture-role") ?? "admin",
  calls: [] as { name: string; actor: string; input: unknown }[],
  readMode: "ok",
  applyMode: "ok",
  dispatchMode: "ok",
  reviewEnabled: true,
  releaseRead: null as null | (() => void),
  changeActor: async (_id: string, _role: string) => {},
};
declare global {
  interface Window {
    syncFixture: typeof state;
  }
}
window.syncFixture = state;
const listeners = new Set<() => void>();
let auth = { user: { id: state.actor }, loading: false, signOut: async () => {} };
export function changeActor(id: string, role: string) {
  state.actor = id;
  state.role = role;
  auth = { ...auth, user: { id } };
  for (const listener of listeners) listener();
}
export const useNeonAuth = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => auth,
    () => auth,
  );
export const withStaffAuthHeaders = async <T>(value: T) => value;
export const fetchStaffSession = async () => ({
  status: "ok",
  roles: [state.role],
  staffId: state.actor,
});
export const fetchAdminAttentionCounts = async () => ({
  unansweredConversations: 0,
  unassignedLeads: 0,
  staleNewLeads: 0,
  leadsNeedingAttention: 0,
});
// No route in this fixture polls; exported so every owned fixture serves the same API.
const noPolledRead = async (): Promise<never> => {
  throw Error("This fixture renders no polled view");
};
export const fetchAdminPageInBackground = noPolledRead;
export const fetchCommandCenterInBackground = noPolledRead;
const call = (name: string, input: unknown) =>
  state.calls.push({ name, actor: state.actor, input });
const runId = "70000000-0000-4000-8000-000000000001";
const receiptId = "70000000-0000-4000-8000-000000000002";
const row = (source: string, n: number): WithdrawalRow => ({
  candidateId: `80000000-0000-4000-8000-${String(n + (source === "propertyhk" ? 10 : 0)).padStart(12, "0")}`,
  propertyNo: `${source === "propertyhk" ? "HK" : "HSE"}-${n}`,
  title: `${source === "propertyhk" ? "Property.hk" : "28Hse"} 合成候選${n}`,
  dealType: "sale",
  version: "a".repeat(32),
  status: "active",
  decision: {
    allowed: n === 1,
    approval: n === 1 ? "REVIEW_REQUIRED" : "NOT_APPROVED",
    reason: n === 1 ? "confirmed_absence" : "active_source_conflict",
    ruleVersion: "review-withdrawal-v1",
  },
  evidence: {
    kind: "historical_absence",
    terminalReason: null,
    otherActiveSources: n === 1 ? [] : ["28hse_agent_540"],
  },
});
const rows = (source: string) => [row(source, 1), row(source, 2)];
const workspace = (): SyncWorkspace => ({
  cards: [
    {
      label: "28Hse",
      source: "28hse_agent_540",
      branch: null,
      health: "failed",
      message: "同步失敗，保留現有資料",
      connected: true,
      lastCollectionAt: "2026-10-03T00:17:00Z",
      lastAcceptedFullAt: "2026-10-03T00:30:00Z",
      lastPublishedAt: "2026-10-02T00:50:00Z",
      advertisements: 275,
      backlog: 74,
      publicCount: 201,
      stages: {},
      branchEvidence: null,
      capability: { enabled: true, reason: null },
    },
    ...["EPS", "EPT", "EPW"].map((branch) => ({
      label: branch,
      source: "propertyhk",
      branch,
      health: "blocked" as const,
      message: "同步失敗，保留現有資料",
      connected: false,
      lastCollectionAt: null,
      lastAcceptedFullAt: null,
      lastPublishedAt: null,
      advertisements: null,
      backlog: null,
      publicCount: null,
      stages: {},
      branchEvidence: null,
      capability: { enabled: false, reason: "未取得獲准的完整來源" },
    })),
  ],
  history: [
    {
      id: runId,
      source: "28hse_agent_540",
      scope_id: "agent:540",
      operation: "collect",
      workflow_run_id: "owned-1",
      git_sha: "a".repeat(40),
      request_asset: "owned-request.json",
      request_hash: "b".repeat(64),
      receipt_id: receiptId,
      stages: {
        collection: { status: "succeeded" },
        ingestion: { status: "succeeded" },
        publication: { status: "failed" },
        verification: { status: "pending" },
      },
      branches: {},
      counts: { canonicalCreated: 0, canonicalUpdated: 0, published: 0, held: 74 },
      dispatch_status: "accepted",
      error_code: "OWNED_MEDIA_FAILED",
      started_at: "2026-10-03T00:17:00Z",
      finished_at: "2026-10-03T01:00:00Z",
    },
  ],
  nextCursor: null,
  asOf: "2026-10-03T01:01:00Z",
});
export async function fetchAdminSyncWorkspace({ data }: { data: unknown }) {
  call("sync-read", data);
  return workspace();
}
export async function requestAdminSyncOperation({ data }: { data: unknown }) {
  const input = syncOperationSchema.parse(data);
  call("dispatch", input);
  if (state.dispatchMode === "unknown") throw Error("owned unknown dispatch");
  return { runId, status: "accepted" };
}
export async function fetchAdminSyncOperationResult({ data }: { data: unknown }) {
  const input = syncOperationResultSchema.parse(data);
  call("dispatch-reconcile", input);
  return { runId, state: "completed", reconciled: true };
}
export async function fetchWithdrawalCandidates({
  data,
}: {
  data: { source: string; cursor?: string | null };
}) {
  call("withdrawal-read", data);
  const mode = state.readMode;
  if (mode === "delayed" || mode === "delayed-failure")
    await new Promise<void>((done) => {
      state.releaseRead = done;
    });
  if (mode === "failure" || mode === "delayed-failure") throw Error("owned source read failure");
  return {
    enabled: state.reviewEnabled,
    reason: "撤盤 review 尚未啟用",
    rows: rows(data.source),
    nextCursor: null,
    ruleVersion: "review-withdrawal-v1",
  };
}
export async function requestWithdrawalPreview({ data }: { data: unknown }) {
  const input = withdrawalPreviewSchema.parse(data);
  call("preview", input);
  return {
    previewId: "90000000-0000-4000-8000-000000000001",
    expiresAt: new Date(Date.now() + 900000).toISOString(),
    rows: rows(input.source).filter((r) => input.candidateIds.includes(r.candidateId)),
  };
}
export async function applyAdminWithdrawalPreview({ data }: { data: unknown }) {
  const input = withdrawalApplySchema.parse(data);
  call("apply", input);
  if (state.applyMode === "unknown") throw Error("owned unknown commit");
  return {
    status: "confirmed",
    results: [{ candidateId: input.selectedIds[0], propertyNo: "HSE-1", status: "applied" }],
  };
}
export async function fetchWithdrawalResult({ data }: { data: { idempotencyKey: string } }) {
  call("withdrawal-reconcile", data);
  return {
    status: "confirmed",
    results: [
      {
        candidateId: row("28hse_agent_540", 1).candidateId,
        propertyNo: "HSE-1",
        status: "applied",
      },
    ],
  };
}
