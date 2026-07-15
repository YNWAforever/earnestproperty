import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { errorResponse, successResponse } from "../lib/control-plane/errors.ts";
import { applyMigration } from "../lib/control-plane/migrations.server.ts";
import { requireStaffPermission } from "../lib/control-plane/permissions.ts";
import { createOperationContext } from "../lib/control-plane/request-context.ts";

const applySchema = z.object({ approvalToken: z.string().min(20) }).strict();

function applyErrorStatus(error: unknown) {
  if (error instanceof Response) return error.status;
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return [
    "MIGRATION_APPROVAL_INVALID",
    "CONFLICT_DUPLICATE",
    "SCHEMA_RELATION_MISSING",
    "SCHEMA_COLUMN_MISSING",
    "VALIDATION_ERROR",
  ].includes(code)
    ? 409
    : 500;
}

export const Route = createFileRoute("/api/admin/control-plane/migrations/$id/apply")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const context = createOperationContext();
        try {
          const actor = await requireStaffPermission(request, "system.migrations.apply");
          const body = applySchema.safeParse(await request.json().catch(() => null));
          if (!body.success) {
            return errorResponse({ code: "VALIDATION_ERROR" }, context.requestId, 400);
          }
          const result = await applyMigration({
            migrationId: params.id,
            approvalToken: body.data.approvalToken,
            actor,
            context,
          });
          return successResponse(result, context.requestId);
        } catch (error) {
          return errorResponse(error, context.requestId, applyErrorStatus(error));
        }
      },
    },
  },
});
