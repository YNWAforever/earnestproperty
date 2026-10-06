import { createFileRoute } from "@tanstack/react-router";

import { errorResponse, successResponse } from "../lib/control-plane/errors.ts";
import { requireStaffPermission } from "../lib/control-plane/permissions.ts";
import { createOperationContext } from "../lib/control-plane/request-context.ts";
import { listInboundReceiptProblems } from "../lib/whatsapp-enquiries/inbound-receipts.server.ts";

export const Route = createFileRoute("/api/admin/control-plane/receipts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const context = createOperationContext();
        try {
          const actor = await requireStaffPermission(request, "system.jobs.read");
          return successResponse(await listInboundReceiptProblems(actor), context.requestId);
        } catch (error) {
          const status = error instanceof Response ? error.status : 500;
          return errorResponse(error, context.requestId, status);
        }
      },
    },
  },
});
