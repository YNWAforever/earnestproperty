import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { errorResponse, successResponse } from "../lib/control-plane/errors.ts";
import { listRegisteredMigrations } from "../lib/control-plane/migration-registry.server.ts";
import { planMigration } from "../lib/control-plane/migrations.server.ts";
import { requireStaffPermission } from "../lib/control-plane/permissions.ts";
import { createOperationContext } from "../lib/control-plane/request-context.ts";

const planSchema = z.object({}).strict();

function planErrorStatus(error: unknown) {
  if (error instanceof Response) return error.status;
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return [
    "CONFLICT_DUPLICATE",
    "SCHEMA_RELATION_MISSING",
    "SCHEMA_COLUMN_MISSING",
    "VALIDATION_ERROR",
  ].includes(code)
    ? 409
    : 500;
}

export const Route = createFileRoute("/api/admin/control-plane/migrations/$id/plan")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const context = createOperationContext();
        try {
          const actor = await requireStaffPermission(request, "system.migrations.plan");
          const body = planSchema.safeParse(await request.json().catch(() => null));
          if (!body.success) {
            return errorResponse({ code: "VALIDATION_ERROR" }, context.requestId, 400);
          }
          const migrations = await listRegisteredMigrations();
          if (!migrations.some((migration) => migration.id === params.id)) {
            return errorResponse({ code: "VALIDATION_ERROR" }, context.requestId, 404);
          }
          const plan = await planMigration({ migrationId: params.id, actor });
          return successResponse(plan, context.requestId);
        } catch (error) {
          return errorResponse(error, context.requestId, planErrorStatus(error));
        }
      },
    },
  },
});
