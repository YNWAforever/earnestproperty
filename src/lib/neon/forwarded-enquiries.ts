import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { withStaffAuthHeaders } from "@/auth";
import type {
  ForwardedEnquiryInput,
  LeadContactUpdateInput,
} from "../whatsapp-enquiries/forwarded-enquiries";
const nullableText = (max: number) => z.string().max(max).nullable();
const captureInput = z
  .object({
    requestId: z.string().uuid(),
    text: z.string().min(1).max(4000),
    businessSource: z.string().min(2).max(80),
    sourceUrl: nullableText(1000),
    originalCustomerContact: nullableText(200),
    originalReceivedAt: nullableText(80),
    note: nullableText(1000),
    followUpTitle: nullableText(200),
    followUpDueAt: nullableText(80),
    responsibleStaffId: z.string().uuid().nullable(),
  })
  .strict();
const capture = createServerFn({ method: "POST" })
  .inputValidator(captureInput)
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server.ts");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager", "agent"]);
    const { captureForwardedEnquiry } =
      await import("../whatsapp-enquiries/forwarded-enquiries.server.ts");
    return captureForwardedEnquiry(data, actor);
  });
export const saveForwardedEnquiry = async (data: ForwardedEnquiryInput) =>
  capture(await withStaffAuthHeaders({ data }));
const read = createServerFn({ method: "GET" })
  .inputValidator(z.object({ leadId: z.string().uuid() }).strict())
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server.ts");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager", "agent"]);
    const { readForwardedEnquiry } =
      await import("../whatsapp-enquiries/forwarded-enquiries.server.ts");
    return readForwardedEnquiry(data.leadId, actor);
  });
export const fetchForwardedEnquiry = async (leadId: string) =>
  read(await withStaffAuthHeaders({ data: { leadId } }));
const links = createServerFn({ method: "GET" })
  .inputValidator(z.object({ leadId: z.string().uuid() }).strict())
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server.ts");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager", "agent"]);
    const { readLeadConversationLinks } =
      await import("../whatsapp-enquiries/forwarded-enquiries.server.ts");
    return readLeadConversationLinks(data.leadId, actor);
  });
export const fetchRelatedLeadConversations = async (leadId: string) =>
  links(await withStaffAuthHeaders({ data: { leadId } }));
const editContact = createServerFn({ method: "POST" })
  .inputValidator(
    z
      .object({
        leadId: z.string().uuid(),
        name: z.string().max(160).nullable(),
        email: z.string().max(254).nullable(),
        expectedContactId: z.string().uuid(),
        expectedName: z.string().max(160).nullable(),
        expectedEmail: z.string().max(254).nullable(),
      })
      .strict(),
  )
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server.ts");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager", "agent"]);
    const { updateLeadContact } =
      await import("../whatsapp-enquiries/forwarded-enquiries.server.ts");
    return updateLeadContact(data, actor);
  });
export const saveLeadContact = async (data: LeadContactUpdateInput) =>
  editContact(await withStaffAuthHeaders({ data }));
