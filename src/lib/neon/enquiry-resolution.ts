import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { callStaffServerFn } from "./staff-server-fn";

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
  callStaffServerFn(correct, { data });

const detail = createServerFn({ method: "GET" })
  .inputValidator(z.object({ inquiryId: z.string().uuid() }).strict())
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server.ts");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager", "agent"]);
    const {
      readEnquiryMessages,
      loadEnquiryAccess,
      readEnquiryResolutionContext,
      toEnquiryResolutionView,
    } = await import("../whatsapp-enquiries/enquiry-access.server.ts");
    const [access, messages, context] = await Promise.all([
      loadEnquiryAccess(actor, data.inquiryId),
      readEnquiryMessages(actor, data.inquiryId),
      readEnquiryResolutionContext(actor, data.inquiryId),
    ]);
    // FX-17a: a reader who cannot correct gets no colleague staff ids.
    return { access, messages, context: toEnquiryResolutionView(context, access) };
  });
export const fetchWhatsappEnquiryDetail = async (inquiryId: string) =>
  callStaffServerFn(detail, { data: { inquiryId } });
