import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { withStaffAuthHeaders } from "@/auth";

const input = z
  .object({
    inquiryId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    propertyId: z.string().uuid().nullable().optional(),
    requestedStaffId: z.string().uuid().nullable().optional(),
    ownerStaffId: z.string().uuid().nullable().optional(),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();
const correct = createServerFn({ method: "POST" })
  .inputValidator(input)
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server.ts");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
    const { resolveEnquiry } = await import("../whatsapp-enquiries/enquiry-resolution.server.ts");
    return resolveEnquiry(data, actor);
  });
export const correctWhatsappEnquiry = async (data: z.infer<typeof input>) =>
  correct(await withStaffAuthHeaders({ data }));

const detail = createServerFn({ method: "GET" })
  .inputValidator(z.object({ inquiryId: z.string().uuid() }).strict())
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server.ts");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager", "agent"]);
    const { readEnquiryMessages, loadEnquiryAccess } =
      await import("../whatsapp-enquiries/enquiry-access.server.ts");
    const [access, messages] = await Promise.all([
      loadEnquiryAccess(actor, data.inquiryId),
      readEnquiryMessages(actor, data.inquiryId),
    ]);
    return { access, messages };
  });
export const fetchWhatsappEnquiryDetail = async (inquiryId: string) =>
  detail(await withStaffAuthHeaders({ data: { inquiryId } }));
