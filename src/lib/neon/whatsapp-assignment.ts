import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { withStaffAuthHeaders } from "@/auth";
const contextServer = createServerFn({ method: "GET" })
  .inputValidator(z.object({ conversationId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager", "agent"]);
    const api = await import("../whatsapp-enquiries/assignment.server");
    if (!(await api.assignmentSchemaAvailable())) return null;
    return api.readAssignmentContext(data.conversationId, actor);
  });
export async function getWhatsappAssignment(data: { conversationId: string }) {
  return contextServer(await withStaffAuthHeaders({ data }));
}
const settingsServer = createServerFn({ method: "GET" }).handler(async () => {
  const { requireStaffAccess } = await import("./auth.server");
  const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
  return (await import("../whatsapp-enquiries/assignment.server")).listStaffChannels(actor);
});
export async function getWhatsappStaffChannels() {
  return settingsServer(await withStaffAuthHeaders({}));
}
const saveServer = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      staffId: string;
      inboxUserId: string;
      folderId: string;
      routingNodeId: string;
      branchId: string | null;
      verificationRef: string;
      eligible: boolean;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
    return (await import("../whatsapp-enquiries/assignment.server")).saveStaffChannel(data, actor);
  });
export async function saveWhatsappStaffChannel(data: Parameters<typeof saveServer>[0]["data"]) {
  return saveServer(await withStaffAuthHeaders({ data }));
}
const queueServer = createServerFn({ method: "GET" }).handler(async () => {
  const { requireStaffAccess } = await import("./auth.server");
  const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
  const api = await import("../whatsapp-enquiries/assignment.server");
  if (!(await api.assignmentSchemaAvailable())) return [];
  return api.readEnquiryQueue(actor);
});
export async function getWhatsappEnquiryQueue() {
  return queueServer(await withStaffAuthHeaders({}));
}
