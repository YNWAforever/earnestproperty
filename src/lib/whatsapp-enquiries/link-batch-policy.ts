import { createHash } from "node:crypto";
import { z } from "zod";
import type { TrackingLinkInput } from "../neon/whatsapp-enquiries.types.ts";

export const batchTrackingInput = z
  .object({
    referenceMappingId: z.string().uuid().nullable().optional(),
    placementSource: z.enum(["website", "28hse", "youtube", "other"]),
    entryPointType: z.enum(["sales", "reception"]),
    publicListingNo: z.string().trim().min(1).max(160).nullable().optional(),
    propertyId: z.string().uuid().nullable().optional(),
    dealType: z.enum(["sale", "rent"]).nullable().optional(),
    requestedStaffId: z.string().uuid().nullable().optional(),
    branchId: z.string().trim().min(1).max(160).nullable().optional(),
    externalListingId: z.string().trim().min(1).max(160).nullable().optional(),
    videoId: z.string().trim().min(1).max(160).nullable().optional(),
    placementVerified: z.boolean().optional(),
    enabled: z.boolean(),
  })
  .strict();
export const batchRowSchema = z
  .object({
    rowKey: z.string().uuid(),
    placementId: z.string().trim().min(1).max(160),
    input: batchTrackingInput,
  })
  .strict();
export type BatchRowDraft = z.infer<typeof batchRowSchema>;
export type CanonicalBatchRow = BatchRowDraft & { placementKey: string; rowHash: string };

export function canonicalBatchRow(value: unknown, channelId: string): CanonicalBatchRow {
  const row = batchRowSchema.parse(value);
  const input: TrackingLinkInput = {
    ...row.input,
    publicListingNo: row.input.publicListingNo?.trim().toUpperCase() || null,
    propertyId: row.input.propertyId ?? null,
    dealType: row.input.dealType ?? null,
    requestedStaffId: row.input.requestedStaffId ?? null,
    referenceMappingId: row.input.referenceMappingId ?? null,
    branchId: row.input.branchId?.trim() || null,
    externalListingId: row.input.externalListingId?.trim() || null,
    videoId: row.input.videoId?.trim() || null,
    placementVerified: row.input.placementVerified === true,
  };
  if (
    Boolean(input.propertyId) !== Boolean(input.publicListingNo) ||
    Boolean(input.propertyId) !== Boolean(input.dealType)
  )
    throw new Error("WA_LINK_OFFER_CONTEXT_REQUIRED");
  if (input.entryPointType === "sales" && !input.propertyId)
    throw new Error("WA_LINK_OFFER_CONTEXT_REQUIRED");
  if (input.entryPointType === "reception" && input.propertyId)
    throw new Error("WA_LINK_RECEPTION_CONTEXT_CONFLICT");
  if (input.placementSource === "28hse" && input.externalListingId !== row.placementId)
    throw new Error("WA_LINK_PLACEMENT_ID_MISMATCH");
  if (input.placementSource === "youtube" && input.videoId !== row.placementId)
    throw new Error("WA_LINK_PLACEMENT_ID_MISMATCH");
  if (
    (input.placementSource === "website" || input.placementSource === "other") &&
    (input.externalListingId || input.videoId)
  )
    throw new Error("WA_LINK_PLACEMENT_ID_MISMATCH");
  const placementId = row.placementId.trim();
  const identity = [
    channelId,
    input.publicListingNo,
    input.dealType,
    input.placementSource,
    input.entryPointType,
    placementId,
    input.requestedStaffId,
    input.referenceMappingId,
    input.branchId,
  ];
  const placementKey = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  const canonical = { rowKey: row.rowKey, placementId, input, placementKey };
  return {
    ...canonical,
    rowHash: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}

export function canonicalBatchRows(rows: unknown[], channelId: string, max: number) {
  if (rows.length < 1 || rows.length > max) throw new Error("WA_LINK_BATCH_LIMIT");
  const normalized = rows.map((row) => canonicalBatchRow(row, channelId));
  if (new Set(normalized.map((row) => row.rowKey)).size !== normalized.length)
    throw new Error("WA_LINK_DUPLICATE_ROW_KEY");
  if (new Set(normalized.map((row) => row.placementKey)).size !== normalized.length)
    throw new Error("WA_LINK_DUPLICATE_PLACEMENT");
  return normalized;
}

export function batchPayloadHash(rows: CanonicalBatchRow[]) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        [...rows].sort((a, b) => a.rowKey.localeCompare(b.rowKey)).map((row) => row.rowHash),
      ),
    )
    .digest("hex");
}
