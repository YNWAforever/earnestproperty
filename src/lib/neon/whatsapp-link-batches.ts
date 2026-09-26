import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { withStaffAuthHeaders } from "@/auth";
import { z } from "zod";
import { batchRowSchema } from "../whatsapp-enquiries/link-batch-policy";

const preview = createServerFn({ method: "POST" })
  .inputValidator(
    z
      .object({ batchId: z.string().uuid(), rows: z.array(batchRowSchema).min(1).max(1000) })
      .strict(),
  )
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    return (await import("./whatsapp-link-batches.server")).previewWhatsappLinkBatch(
      data,
      await requireStaffAccess(getRequest(), ["admin", "manager"]),
    );
  });
const commit = createServerFn({ method: "POST" })
  .inputValidator(
    z
      .object({
        batchId: z.string().uuid(),
        chunkId: z.string().uuid(),
        previewToken: z.string().uuid(),
        rows: z.array(batchRowSchema).min(1).max(50),
      })
      .strict(),
  )
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    return (await import("./whatsapp-link-batches.server")).commitWhatsappLinkChunk(
      data,
      await requireStaffAccess(getRequest(), ["admin", "manager"]),
    );
  });
const read = createServerFn({ method: "GET" })
  .inputValidator(z.object({ batchId: z.string().uuid() }).strict())
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    return (await import("./whatsapp-link-batches.server")).getWhatsappLinkBatchResult(
      data.batchId,
      await requireStaffAccess(getRequest(), ["admin", "manager"]),
    );
  });
export const previewWhatsappLinkBatch = async (data: {
  batchId: string;
  rows: z.infer<typeof batchRowSchema>[];
}) => preview(await withStaffAuthHeaders({ data }));
export const commitWhatsappLinkChunk = async (data: {
  batchId: string;
  chunkId: string;
  previewToken: string;
  rows: z.infer<typeof batchRowSchema>[];
}) => commit(await withStaffAuthHeaders({ data }));
export const getWhatsappLinkBatchResult = async (batchId: string) =>
  read(await withStaffAuthHeaders({ data: { batchId } }));
