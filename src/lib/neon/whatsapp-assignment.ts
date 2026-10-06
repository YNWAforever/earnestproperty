import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { callStaffServerFn } from "./staff-server-fn";
const contextServer = createServerFn({ method: "GET" })
  .inputValidator(z.object({ conversationId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const requestId = (await import("node:crypto")).randomUUID();
    try {
      const { requireStaffAccess } = await import("./auth.server");
      const actor = await requireStaffAccess(getRequest(), ["admin", "manager", "agent"]);
      const api = await import("../whatsapp-enquiries/assignment.server");
      if (!(await api.assignmentSchemaAvailable()))
        return {
          kind: "error" as const,
          code: "schema_unavailable" as const,
          statusCode: 503,
          requestId,
        };
      return {
        kind: "ok" as const,
        context: await api.readAssignmentContext(data.conversationId, actor),
      };
    } catch (error) {
      const dbCode =
        error && typeof error === "object" && "code" in error ? String(error.code) : "";
      const statusCode =
        error instanceof Response
          ? error.status
          : dbCode === "42P01" || dbCode === "42703"
            ? 503
            : 500;
      const code =
        statusCode === 401
          ? "unauthenticated"
          : statusCode === 403
            ? "forbidden"
            : statusCode === 404
              ? "not_found"
              : statusCode === 503
                ? "schema_unavailable"
                : "service_error";
      // A correlation ID is safe for the browser; raw SQL and credentials are not.
      if (statusCode >= 500)
        console.error("WA_ASSIGNMENT_CONTEXT_ERROR", { requestId, code, statusCode });
      return { kind: "error" as const, code, statusCode, requestId };
    }
  });
export async function getWhatsappAssignment(data: { conversationId: string }) {
  return callStaffServerFn(contextServer, { data });
}
const settingsServer = createServerFn({ method: "GET" }).handler(async () => {
  const { requireStaffAccess } = await import("./auth.server");
  const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
  return (await import("../whatsapp-enquiries/assignment.server")).listStaffChannels(actor);
});
export async function getWhatsappStaffChannels() {
  return callStaffServerFn(settingsServer, {});
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
      expectedVersion: number | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
    return (await import("../whatsapp-enquiries/assignment.server")).saveStaffChannel(data, actor);
  });
export async function saveWhatsappStaffChannel(data: Parameters<typeof saveServer>[0]["data"]) {
  return callStaffServerFn(saveServer, { data });
}
const queueServer = createServerFn({ method: "GET" }).handler(async () => {
  const { requireStaffAccess } = await import("./auth.server");
  const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
  const api = await import("../whatsapp-enquiries/assignment.server");
  if (!(await api.assignmentSchemaAvailable())) return [];
  return api.readEnquiryQueue(actor);
});
export async function getWhatsappEnquiryQueue() {
  return callStaffServerFn(queueServer, {});
}
const reviewedSaveServer = createServerFn({ method: "POST" })
  .inputValidator(
    z
      .object({
        staffId: z.string().uuid(),
        expectedVersion: z.number().int().positive().nullable(),
        evidenceId: z.string().uuid(),
        eligible: z.boolean(),
      })
      .strict(),
  )
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
    return (await import("./staff-mapping-review.server")).saveReviewedStaffChannel(data, actor);
  });
export async function saveReviewedWhatsappStaffChannel(
  data: Parameters<typeof reviewedSaveServer>[0]["data"],
  isWorkspaceCurrent?: () => boolean,
) {
  return callStaffServerFn(reviewedSaveServer, { data }, isWorkspaceCurrent);
}
const retireChannelServer = createServerFn({ method: "POST" })
  .inputValidator(
    z
      .object({
        mappingId: z.string().uuid(),
        expectedVersion: z.number().int().positive(),
        reason: z.string().trim().min(3).max(300),
      })
      .strict(),
  )
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
    return (await import("./staff-mapping-review.server")).retireStaffChannel(data, actor);
  });
export async function retireWhatsappStaffChannel(
  data: Parameters<typeof retireChannelServer>[0]["data"],
  isWorkspaceCurrent?: () => boolean,
) {
  return callStaffServerFn(retireChannelServer, { data }, isWorkspaceCurrent);
}
