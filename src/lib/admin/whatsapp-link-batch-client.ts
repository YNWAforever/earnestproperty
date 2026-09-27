import type { BatchRowDraft } from "../whatsapp-enquiries/link-batch-policy.ts";
import type {
  BatchPreview,
  BatchRowResult,
  CommitChunkResult,
} from "../neon/whatsapp-link-batches.types.ts";

export type LinkBatchProgress = {
  batchId: string;
  rows: BatchRowDraft[];
  chunkIds: string[];
  completed: CommitChunkResult[];
  nextChunk: number;
  preview: BatchPreview;
  uncertain: boolean;
};
export type LinkBatchApi = {
  preview: (input: { batchId: string; rows: BatchRowDraft[] }) => Promise<BatchPreview>;
  commit: (input: {
    batchId: string;
    chunkId: string;
    previewToken: string;
    rows: BatchRowDraft[];
  }) => Promise<CommitChunkResult>;
  read: (batchId: string) => Promise<{ operations: CommitChunkResult[] }>;
};

export const linkBatchProgressKey = "earnest:whatsapp-link-batch:v1";
export function batchRowsOf(progress: LinkBatchProgress): BatchRowResult[] {
  return progress.completed.flatMap((chunk) => chunk.rows);
}
export function reconcileLinkBatch(
  progress: LinkBatchProgress,
  operations: CommitChunkResult[],
): LinkBatchProgress {
  const byChunk = new Map(operations.map((operation) => [operation.chunkId, operation]));
  const completed: CommitChunkResult[] = [];
  for (const chunkId of progress.chunkIds) {
    const operation = byChunk.get(chunkId);
    if (!operation) break;
    completed.push(operation);
    if (operation.state === "rejected") break;
  }
  return { ...progress, completed, nextChunk: completed.length, uncertain: false };
}

/** Persist before every request. An ambiguous response is reconciled by operation ID. */
export async function runWhatsappLinkBatch(
  initial: LinkBatchProgress,
  api: LinkBatchApi,
  save: (progress: LinkBatchProgress) => void,
): Promise<LinkBatchProgress> {
  let progress = initial;
  const chunks = Array.from({ length: Math.ceil(progress.rows.length / 50) }, (_, index) =>
    progress.rows.slice(index * 50, index * 50 + 50),
  );
  if (chunks.length !== progress.chunkIds.length) throw new Error("BATCH_CHUNK_IDS_INVALID");
  while (progress.nextChunk < chunks.length) {
    const index = progress.nextChunk;
    const chunkId = progress.chunkIds[index];
    save(progress);
    try {
      const result = await api.commit({
        batchId: progress.batchId,
        chunkId,
        previewToken: progress.preview.previewToken,
        rows: chunks[index],
      });
      progress = {
        ...progress,
        completed: [...progress.completed, result],
        nextChunk: index + 1,
        uncertain: false,
      };
      save(progress);
      if (result.state === "rejected") return progress;
    } catch (error) {
      try {
        progress = reconcileLinkBatch(progress, (await api.read(progress.batchId)).operations);
        save(progress);
        if (progress.completed[index]) {
          if (progress.completed[index].state === "rejected") return progress;
          continue;
        }
      } catch {
        // Preserve the original failure and operation ID for explicit recovery.
      }
      progress = { ...progress, uncertain: true };
      save(progress);
      throw error;
    }
  }
  return progress;
}
