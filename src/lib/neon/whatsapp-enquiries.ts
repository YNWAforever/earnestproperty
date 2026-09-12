import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
const optionalText = z.string().trim().min(1).max(160).nullable().optional();
export const trackingLinkSchema = z
  .object({
    referenceMappingId: z.string().uuid().nullable().optional(),
    placementSource: z.enum(["website", "28hse", "youtube", "other"]),
    entryPointType: z.enum(["sales", "reception"]),
    publicListingNo: optionalText,
    propertyId: z.string().uuid().nullable().optional(),
    dealType: z.enum(["sale", "rent"]).nullable().optional(),
    requestedStaffId: z.string().uuid().nullable().optional(),
    branchId: optionalText,
    externalListingId: optionalText,
    videoId: optionalText,
    placementVerified: z.boolean().optional(),
    enabled: z.boolean(),
  })
  .strict();
const offerSchema = z
  .object({
    publicListingNo: z.string().min(1).max(160),
    propertyId: z.string().uuid(),
    dealType: z.enum(["sale", "rent"]),
  })
  .strict();
export const getWhatsappTrackingLinks = createServerFn({ method: "GET" }).handler(async () => {
  const { requireStaffAccess } = await import("./auth.server");
  const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
  return (await import("./whatsapp-enquiries.server")).listTrackingLinks(actor);
});
export const saveWhatsappTrackingLink = createServerFn({ method: "POST" })
  .inputValidator(
    trackingLinkSchema
      .extend({
        id: z.string().uuid().optional(),
        expectedVersion: z.number().int().positive().optional(),
      })
      .strict(),
  )
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
    return (await import("./whatsapp-enquiries.server")).saveTrackingLink(data, actor);
  });
export const provisionWhatsappLinks = createServerFn({ method: "POST" })
  .inputValidator(z.object({ links: z.array(trackingLinkSchema).min(1).max(50) }).strict())
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
    return (await import("./whatsapp-enquiries.server")).provisionTrackingLinks(data.links, actor);
  });
export const resolveWhatsappLinks = createServerFn({ method: "GET" })
  .inputValidator(z.object({ offers: z.array(offerSchema).max(50) }).strict())
  .handler(async ({ data }) =>
    (await import("./whatsapp-enquiries.server")).resolveTrackingLinks(data.offers),
  );
export const getWhatsappEnquiries = createServerFn({ method: "GET" })
  .inputValidator(z.object({ conversationId: z.string().uuid() }).strict())
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager", "agent"]);
    return (await import("./whatsapp-enquiries.server")).listEnquiries(data.conversationId, actor);
  });

export const searchWhatsappLinkOffers = createServerFn({ method: "GET" })
  .inputValidator(z.object({ q: z.string().trim().max(100) }).strict())
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    await requireStaffAccess(getRequest(), ["admin", "manager"]);
    return (await import("./whatsapp-enquiries.server")).searchLinkOffers(data.q);
  });
