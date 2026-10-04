import { safeCsvCell } from "./csv-safe-cell.ts";
import type { BatchRowDraft } from "../whatsapp-enquiries/link-batch-policy.ts";
import type {
  BatchPreview,
  BatchRowResult,
  CommitChunkResult,
} from "../neon/whatsapp-link-batches.types.ts";

export type LinkBatchProgress = {
  batchId: string;
  draftId?: string;
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

export const linkBatchProgressKey = (actorScope: string) =>
  `earnest:whatsapp-link-batch:v2:${encodeURIComponent(actorScope)}`;
export function batchRowsOf(progress: LinkBatchProgress): BatchRowResult[] {
  return progress.completed.flatMap((chunk) => chunk.rows);
}
export function knownFailedBatchRows(progress: LinkBatchProgress): BatchRowDraft[] {
  if (progress.uncertain) return [];
  const failed = new Set(
    batchRowsOf(progress)
      .filter((row) => row.outcome === "blocked" || row.outcome === "failed")
      .map((row) => row.rowKey),
  );
  return progress.rows.filter((row) => failed.has(row.rowKey));
}

export function batchResultCsv(
  progress: LinkBatchProgress,
  source?: BatchRowDraft["input"]["placementSource"],
  category: "success" | "failure" = "success",
) {
  const byKey = new Map(progress.rows.map((row) => [row.rowKey, row]));
  const header =
    category === "failure"
      ? [
          "row_key",
          "public_listing_no",
          "deal_type",
          "source",
          "placement_id",
          "outcome",
          "reason_code",
        ]
      : ["public_listing_no", "deal_type", "source", "placement_id", "outcome", "link"];
  const lines = batchRowsOf(progress).flatMap((result) => {
    const row = byKey.get(result.rowKey);
    if (!row) return [];
    if (category === "failure") {
      if (!["blocked", "failed"].includes(result.outcome)) return [];
    } else if (!result.code || !["created", "reused"].includes(result.outcome)) return [];
    if (source && row.input.placementSource !== source) return [];
    const cells =
      category === "failure"
        ? [
            result.rowKey,
            row.input.publicListingNo,
            row.input.dealType,
            row.input.placementSource,
            row.placementId,
            result.outcome,
            result.reasonCode,
          ]
        : [
            row.input.publicListingNo,
            row.input.dealType,
            row.input.placementSource,
            row.placementId,
            result.outcome,
            `/w/${result.code}`,
          ];
    return [cells.map((cell) => safeCsvCell(cell)).join(",")];
  });
  return `\ufeff${header.map((cell) => safeCsvCell(cell)).join(",")}\r\n${lines.join("\r\n")}${lines.length ? "\r\n" : ""}`;
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
  return {
    ...progress,
    completed,
    nextChunk: completed.length,
    // A read can race an in-flight transaction. Only its committed operation resolves it.
    uncertain:
      progress.uncertain &&
      !completed.some((operation) => operation.chunkId === progress.chunkIds[progress.nextChunk]),
  };
}

/** Persist before every request. An ambiguous response is reconciled by operation ID. */
export async function runWhatsappLinkBatch(
  initial: LinkBatchProgress,
  api: LinkBatchApi,
  save: (progress: LinkBatchProgress) => void,
  isCurrent: () => boolean = () => true,
): Promise<LinkBatchProgress> {
  let progress = initial;
  const chunks = Array.from({ length: Math.ceil(progress.rows.length / 50) }, (_, index) =>
    progress.rows.slice(index * 50, index * 50 + 50),
  );
  if (chunks.length !== progress.chunkIds.length) throw new Error("BATCH_CHUNK_IDS_INVALID");
  while (progress.nextChunk < chunks.length) {
    if (!isCurrent()) return progress;
    const index = progress.nextChunk;
    const chunkId = progress.chunkIds[index];
    progress = { ...progress, uncertain: true };
    save(progress);
    try {
      const result = await api.commit({
        batchId: progress.batchId,
        chunkId,
        previewToken: progress.preview.previewToken,
        rows: chunks[index],
      });
      // The accepted receipt remains durable on the server. Leave the original
      // uncertain journal for current-workspace readback, never overwrite a newer journal.
      if (!isCurrent()) return progress;
      progress = {
        ...progress,
        completed: [...progress.completed, result],
        nextChunk: index + 1,
        uncertain: false,
      };
      save(progress);
      if (result.state === "rejected") return progress;
    } catch (error) {
      if (!isCurrent()) return progress;
      try {
        const readback = await api.read(progress.batchId);
        if (!isCurrent()) return progress;
        progress = reconcileLinkBatch(progress, readback.operations);
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
