import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAudit } from "../lib/control-plane/audit.server.ts";
import { errorResponse, successResponse } from "../lib/control-plane/errors.ts";
import { cancelJob } from "../lib/control-plane/jobs.server.ts";
import { requireStaffPermission } from "../lib/control-plane/permissions.ts";
import { createOperationContext } from "../lib/control-plane/request-context.ts";
import type { StaffAccess } from "../lib/neon/auth.server.ts";

const cancelSchema = z.object({}).strict();
const idSchema = z.string().uuid();

function conflictError() {
  return Object.assign(new Error("The job cannot be cancelled from its current state."), {
    code: "CONFLICT_DUPLICATE",
  });
}

export const Route = createFileRoute("/api/admin/control-plane/jobs/$id/cancel")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const context = createOperationContext();
        let actor: StaffAccess | null = null;
        try {
          actor = await requireStaffPermission(request, "system.jobs.cancel");
          const id = idSchema.safeParse(params.id);
          const body = cancelSchema.safeParse(await request.json().catch(() => null));
          if (!id.success || !body.success) {
            return errorResponse({ code: "VALIDATION_ERROR" }, context.requestId, 400);
          }
          const job = await cancelJob({
            jobId: id.data,
            workerId: `manual:${actor.staffId}`,
            audit: {
              actorStaffId: actor.staffId,
              requestId: context.requestId,
            },
          });
          if (!job) throw conflictError();
          return successResponse({ id: id.data, status: job.status }, context.requestId);
        } catch (error) {
          if (actor) {
            try {
              await writeAudit({
                actor,
                permission: "system.jobs.cancel",
                action: "job.cancel",
                resourceType: "job",
                resourceId: params.id,
                outcome: "failure",
                context,
                metadata: { jobId: params.id },
              });
            } catch {
              // Preserve the command failure when audit storage is unavailable.
            }
          }
          const code =
            error && typeof error === "object" && "code" in error ? String(error.code) : "";
          const status =
            error instanceof Response ? error.status : code === "CONFLICT_DUPLICATE" ? 409 : 500;
          return errorResponse(error, context.requestId, status);
        }
      },
    },
  },
});
