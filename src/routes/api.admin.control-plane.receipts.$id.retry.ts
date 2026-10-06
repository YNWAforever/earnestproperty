import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAudit } from "../lib/control-plane/audit.server.ts";
import { errorResponse, successResponse } from "../lib/control-plane/errors.ts";
import { requireStaffPermission } from "../lib/control-plane/permissions.ts";
import { createOperationContext } from "../lib/control-plane/request-context.ts";
import type { StaffAccess } from "../lib/neon/auth.server.ts";
import { retryInboundReceipt } from "../lib/whatsapp-enquiries/inbound-receipts.server.ts";

const retrySchema = z.object({}).strict();
const idSchema = z.string().uuid();

const CONFLICT = { status: 409, code: "CONFLICT_DUPLICATE" } as const;

function conflictError() {
  return Object.assign(new Error("此訊息仍在處理中，請稍後再試。"), {
    code: CONFLICT.code,
  });
}

export const Route = createFileRoute("/api/admin/control-plane/receipts/$id/retry")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const context = createOperationContext();
        let actor: StaffAccess | null = null;
        try {
          actor = await requireStaffPermission(request, "system.jobs.retry");
          const id = idSchema.safeParse(params.id);
          const body = retrySchema.safeParse(await request.json().catch(() => null));
          if (!id.success || !body.success) {
            return errorResponse({ code: "VALIDATION_ERROR" }, context.requestId, 400);
          }
          const result = await retryInboundReceipt(id.data, actor, {
            requestId: context.requestId,
          });
          if (!result) throw conflictError();
          return successResponse(result, context.requestId);
        } catch (error) {
          if (actor) {
            // Never store arbitrary caller text as the audited resource.
            const auditedId = idSchema.safeParse(params.id).success ? params.id : "invalid";
            try {
              await writeAudit({
                actor,
                permission: "system.jobs.retry",
                action: "whatsapp.receipt.retry",
                resourceType: "whatsapp_inbound_receipt",
                resourceId: auditedId,
                outcome: "failure",
                context,
                metadata: { receiptId: auditedId },
              });
            } catch {
              // Preserve the command failure when audit storage is unavailable.
            }
          }
          const code =
            error && typeof error === "object" && "code" in error ? String(error.code) : "";
          const status =
            error instanceof Response
              ? error.status
              : code === CONFLICT.code
                ? CONFLICT.status
                : 500;
          return errorResponse(error, context.requestId, status);
        }
      },
    },
  },
});
