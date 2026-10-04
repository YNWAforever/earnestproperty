import type { BatchRowDraft } from "../../../src/lib/whatsapp-enquiries/link-batch-policy";
import type {
  BatchPreview,
  CommitChunkResult,
} from "../../../src/lib/neon/whatsapp-link-batches.types";
export const id = (n: number) => `71000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const staff = id(100);
export const offers = Array.from({ length: 60 }, (_, index) => ({
  propertyId: id(index + 1),
  publicListingNo: `A${String(index + 1).padStart(6, "0")}`,
  dealType: index % 2 ? ("rent" as const) : ("sale" as const),
  title: `合成中文樓盤 ${index + 1}`,
  price: index % 2 ? 18000 : 8000000,
  agentId: staff,
  agentName: "合成同事甲",
}));
const stored = JSON.parse(sessionStorage.getItem("owned-link-bulk-server") ?? "null");
export const state = {
  calls: (stored?.calls ?? []) as { name: string; input: unknown }[],
  operations: (stored?.operations ?? []) as CommitChunkResult[],
  role: "manager",
  binding: staff,
  denied: false,
  changeMembership: async (_role = "manager", _binding = staff) => {},
  commitMode: "ok",
  readFailure: false,
  deniedReference: false,
  blockedTail: 0,
  releaseCommit: null as null | (() => void),
};
function persist() {
  sessionStorage.setItem(
    "owned-link-bulk-server",
    JSON.stringify({ calls: state.calls, operations: state.operations }),
  );
}
export function record(name: string, input: unknown) {
  state.calls.push({ name, input });
  persist();
}
Object.assign(window, { ownedLinkBulk: state });
export async function previewWhatsappLinkBatch(input: {
  batchId: string;
  rows: BatchRowDraft[];
}): Promise<BatchPreview> {
  record("preview", input);
  const rows = input.rows.map((row, index) => ({
    rowKey: row.rowKey,
    decision:
      index >= input.rows.length - state.blockedTail ? ("blocked" as const) : ("create" as const),
    existingLinkId: null,
    reasons:
      index >= input.rows.length - state.blockedTail
        ? [{ code: "WA_LINK_STAFF_NOT_READY", message: "指定同事缺少已核實 Inbox 映射" }]
        : [],
  }));
  return {
    batchId: input.batchId,
    previewToken: id(900),
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    rows,
    counts: {
      create: rows.filter((r) => r.decision === "create").length,
      reuse: 0,
      blocked: rows.filter((r) => r.decision === "blocked").length,
    },
  };
}
export async function commitWhatsappLinkChunk(input: {
  batchId: string;
  chunkId: string;
  previewToken: string;
  rows: BatchRowDraft[];
}): Promise<CommitChunkResult> {
  record("commit", input);
  if (state.commitMode === "pending")
    await new Promise<void>((done) => {
      state.releaseCommit = done;
    });
  const existing = state.operations.find(
    (o) => o.batchId === input.batchId && o.chunkId === input.chunkId,
  );
  if (existing) return existing;
  const rejected = state.commitMode === "atomic-reject";
  const result: CommitChunkResult = {
    batchId: input.batchId,
    chunkId: input.chunkId,
    state: rejected ? "rejected" : "committed",
    rows: input.rows.map((row, index) => ({
      rowKey: row.rowKey,
      outcome: rejected ? (index >= input.rows.length - 5 ? "blocked" : "failed") : "created",
      linkId: rejected ? null : id(Number(row.input.publicListingNo?.slice(1) ?? index + 1) + 1000),
      code: rejected
        ? null
        : `owned_${String(Number(row.input.publicListingNo?.slice(1) ?? index + 1)).padStart(26, "0")}`,
      version: rejected ? null : 1,
      reasonCode: rejected
        ? index >= input.rows.length - 5
          ? "WA_LINK_STAFF_NOT_READY"
          : "CHUNK_NOT_COMMITTED"
        : null,
    })),
  };
  state.operations.push(result);
  persist();
  if (state.commitMode === "lost") throw Error("Synthetic committed response unavailable");
  return result;
}
export async function getWhatsappLinkBatchResult(batchId: string) {
  record("read", { batchId });
  if (state.readFailure) throw Error("Synthetic result lookup unavailable");
  return { batchId, operations: state.operations.filter((o) => o.batchId === batchId) };
}
