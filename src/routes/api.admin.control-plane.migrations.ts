import { createFileRoute } from "@tanstack/react-router";

import { errorResponse, successResponse } from "../lib/control-plane/errors.ts";
import { listMigrationStates } from "../lib/control-plane/migrations.server.ts";
import { requireStaffPermission } from "../lib/control-plane/permissions.ts";
import { createOperationContext } from "../lib/control-plane/request-context.ts";

export const Route = createFileRoute("/api/admin/control-plane/migrations")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const context = createOperationContext();
        try {
          await requireStaffPermission(request, "system.migrations.plan");
          const migrations = await listMigrationStates();
          return successResponse(migrations, context.requestId);
        } catch (error) {
          const status = error instanceof Response ? error.status : 500;
          return errorResponse(error, context.requestId, status);
        }
      },
    },
  },
});
