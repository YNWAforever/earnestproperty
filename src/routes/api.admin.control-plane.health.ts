import { createFileRoute } from "@tanstack/react-router";

import { errorResponse, successResponse } from "../lib/control-plane/errors.ts";
import { operationsCapabilitiesForRoles } from "../lib/control-plane/capabilities.ts";
import { runControlPlaneHealthChecks } from "../lib/control-plane/health.server.ts";
import { requireStaffPermission } from "../lib/control-plane/permissions.ts";
import { createOperationContext } from "../lib/control-plane/request-context.ts";

export const Route = createFileRoute("/api/admin/control-plane/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const context = createOperationContext();
        try {
          const actor = await requireStaffPermission(request, "system.health.read");
          const health = await runControlPlaneHealthChecks();
          return successResponse(
            {
              ...health,
              capabilities: operationsCapabilitiesForRoles(actor.roles),
            },
            context.requestId,
          );
        } catch (error) {
          const status = error instanceof Response ? error.status : 500;
          return errorResponse(error, context.requestId, status);
        }
      },
    },
  },
});
