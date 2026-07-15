import { createFileRoute } from "@tanstack/react-router";

import { errorResponse, successResponse } from "../lib/control-plane/errors.ts";
import { listRegisteredMigrations } from "../lib/control-plane/migration-registry.server.ts";
import { requireStaffPermission } from "../lib/control-plane/permissions.ts";
import { createOperationContext } from "../lib/control-plane/request-context.ts";

export const Route = createFileRoute("/api/admin/control-plane/migrations")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const context = createOperationContext();
        try {
          await requireStaffPermission(request, "system.migrations.plan");
          const migrations = await listRegisteredMigrations();
          return successResponse(
            migrations.map((migration) => ({
              id: migration.id,
              checksum: migration.checksum,
              dependencies: [...migration.dependencies],
              summary: migration.summary,
              postconditions: migration.postconditions.map((postcondition) => ({ ...postcondition })),
            })),
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
