import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { callStaffServerFn } from "./staff-server-fn";
import { z } from "zod";

const source = z.enum(["website", "28hse", "youtube", "other"]);
const input = z
  .object({
    offers: z
      .array(
        z
          .object({
            publicListingNo: z.string().trim().min(1).max(160),
            dealType: z.enum(["sale", "rent"]),
          })
          .strict(),
      )
      .max(1000),
    references: z
      .array(
        z
          .object({
            source,
            namespace: z.string().trim().min(1).max(160),
            externalReference: z.string().min(1).max(160),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();
const lookup = createServerFn({ method: "POST" })
  .inputValidator(input)
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    await requireStaffAccess(getRequest(), ["admin", "manager"]);
    return (await import("./whatsapp-link-import.server")).resolveLinkImportContext(data);
  });
export const resolveWhatsappLinkImport = async (data: z.infer<typeof input>) =>
  callStaffServerFn(lookup, { data });
