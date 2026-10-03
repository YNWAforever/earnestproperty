import { z } from "zod";
import type { BatchRowDraft } from "../whatsapp-enquiries/link-batch-policy.ts";
import type { BatchPreview } from "../neon/whatsapp-link-batches.types.ts";

type DraftStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type WhatsappBatchDraft = { draftId: string; rows: BatchRowDraft[]; savedAt: string };
const draftVersion = 1;
const draftRowSchema = z
  .object({
    rowKey: z.string().uuid(),
    placementId: z.string().max(160),
    input: z
      .object({
        placementSource: z.enum(["website", "28hse", "youtube", "other"]),
        entryPointType: z.enum(["sales", "reception"]),
        publicListingNo: z.string().max(160).nullable().optional(),
        propertyId: z.string().uuid().nullable().optional(),
        dealType: z.enum(["sale", "rent"]).nullable().optional(),
        requestedStaffId: z.string().uuid().nullable().optional(),
        referenceMappingId: z.string().uuid().nullable().optional(),
        branchId: z.string().max(160).nullable().optional(),
        externalListingId: z.string().max(160).nullable().optional(),
        videoId: z.string().max(160).nullable().optional(),
        placementVerified: z.boolean().optional(),
        enabled: z.boolean(),
      })
      .strict(),
  })
  .strict();
const keyOf = (actorScope: string, draftId: string) =>
  `earnest:whatsapp-link-draft:v${draftVersion}:${encodeURIComponent(actorScope)}:${draftId}`;

function sanitizedRow(value: BatchRowDraft): BatchRowDraft {
  const input = value.input;
  return draftRowSchema.parse({
    rowKey: value.rowKey,
    placementId: value.placementId,
    input: {
      placementSource: input.placementSource,
      entryPointType: input.entryPointType,
      publicListingNo: input.publicListingNo,
      propertyId: input.propertyId,
      dealType: input.dealType,
      requestedStaffId: input.requestedStaffId,
      referenceMappingId: input.referenceMappingId,
      branchId: input.branchId,
      externalListingId: input.externalListingId,
      videoId: input.videoId,
      placementVerified: input.placementVerified,
      enabled: input.enabled,
    },
  });
}

export function prepareEligibleSubset(
  draft: BatchRowDraft[],
  preview: BatchPreview,
  selectedRowKeys: string[],
): { rows: BatchRowDraft[]; excludedRowKeys: string[] } {
  const decisions = new Map(preview.rows.map((row) => [row.rowKey, row.decision]));
  const chosen = new Set(selectedRowKeys);
  if (
    chosen.size !== selectedRowKeys.length ||
    [...chosen].some(
      (key) => decisions.get(key) === undefined || decisions.get(key) === "blocked",
    ) ||
    preview.rows.length !== draft.length ||
    draft.some((row) => !decisions.has(row.rowKey))
  )
    throw new Error("BATCH_ROW_NOT_ELIGIBLE");
  const rows = draft.filter((row) => chosen.has(row.rowKey));
  if (!rows.length) throw new Error("BATCH_SUBSET_EMPTY");
  return {
    rows,
    excludedRowKeys: draft.filter((row) => !chosen.has(row.rowKey)).map((row) => row.rowKey),
  };
}

export function saveDraft(
  actorScope: string,
  draft: Pick<WhatsappBatchDraft, "draftId" | "rows">,
  storage: DraftStore = localStorage,
): WhatsappBatchDraft {
  if (!actorScope.trim()) throw new Error("BATCH_ACTOR_REQUIRED");
  const draftId = z.string().uuid().parse(draft.draftId);
  const rows = z.array(draftRowSchema).max(1000).parse(draft.rows.map(sanitizedRow));
  const saved: WhatsappBatchDraft = { draftId, rows, savedAt: new Date().toISOString() };
  storage.setItem(keyOf(actorScope, draftId), JSON.stringify({ version: draftVersion, ...saved }));
  return saved;
}

export function loadDraft(
  actorScope: string,
  draftId: string,
  storage: DraftStore = localStorage,
): WhatsappBatchDraft | null {
  if (!actorScope.trim() || !z.string().uuid().safeParse(draftId).success) return null;
  const raw = storage.getItem(keyOf(actorScope, draftId));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (value.version !== draftVersion || value.draftId !== draftId) return null;
    return {
      draftId,
      rows: z.array(draftRowSchema).max(1000).parse(value.rows),
      savedAt: z.string().datetime().parse(value.savedAt),
    };
  } catch {
    return null;
  }
}

export function clearDraft(
  actorScope: string,
  draftId: string,
  storage: DraftStore = localStorage,
) {
  if (actorScope.trim() && z.string().uuid().safeParse(draftId).success)
    storage.removeItem(keyOf(actorScope, draftId));
}

export function listDrafts(
  actorScope: string,
  storage: DraftStore & Pick<Storage, "length" | "key"> = localStorage,
): WhatsappBatchDraft[] {
  if (!actorScope.trim()) return [];
  const prefix = `earnest:whatsapp-link-draft:v${draftVersion}:${encodeURIComponent(actorScope)}:`;
  const drafts: WhatsappBatchDraft[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const draft = loadDraft(actorScope, key.slice(prefix.length), storage);
    if (draft?.rows.length) drafts.push(draft);
  }
  return drafts.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
