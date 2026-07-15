import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { listAuditLogs } from "../lib/control-plane/audit.server.ts";
import { errorResponse, successResponse } from "../lib/control-plane/errors.ts";
import { requireStaffPermission } from "../lib/control-plane/permissions.ts";
import { createOperationContext } from "../lib/control-plane/request-context.ts";

const auditQuerySchema = z
  .object({
    cursor: z.string().min(1).max(1_000).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    outcome: z.enum(["success", "failure", "denied"]).optional(),
    action: z.string().min(1).max(100).optional(),
    requestId: z.string().uuid().optional(),
  })
  .strict();

export const Route = createFileRoute("/api/admin/control-plane/audit")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const context = createOperationContext();
        try {
          await requireStaffPermission(request, "audit.read");
          const parsed = auditQuerySchema.safeParse(
            Object.fromEntries(new URL(request.url).searchParams.entries()),
          );
          if (!parsed.success) {
            return errorResponse({ code: "VALIDATION_ERROR" }, context.requestId, 400);
          }
          const page = await listAuditLogs(parsed.data);
          return successResponse(page, context.requestId);
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
          const status = error instanceof Response ? error.status : code === "VALIDATION_ERROR" ? 400 : 500;
          return errorResponse(error, context.requestId, status);
        }
      },
    },
  },
});
