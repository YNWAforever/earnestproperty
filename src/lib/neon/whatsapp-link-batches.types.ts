import type { CanonicalBatchRow } from "../whatsapp-enquiries/link-batch-policy.ts";

export type BatchRow = CanonicalBatchRow;
export type BatchReason = { code: string; message: string };
export type BatchRowPreview = {
  rowKey: string;
  decision: "create" | "reuse" | "blocked";
  existingLinkId: string | null;
  reasons: BatchReason[];
};
export type BatchPreview = {
  batchId: string;
  previewToken: string;
  expiresAt: string;
  rows: BatchRowPreview[];
  counts: { create: number; reuse: number; blocked: number };
};
export type BatchRowResult = {
  rowKey: string;
  outcome: "created" | "reused" | "blocked" | "failed";
  linkId: string | null;
  code: string | null;
  version: number | null;
  reasonCode: string | null;
};
export type CommitChunkResult = {
  batchId: string;
  chunkId: string;
  state: "committed" | "rejected";
  rows: BatchRowResult[];
};
