import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { errorResponse, successResponse } from "../lib/control-plane/errors.ts";
import { getJobSummary, listJobs } from "../lib/control-plane/jobs.server.ts";
import { requireStaffPermission } from "../lib/control-plane/permissions.ts";
import { createOperationContext } from "../lib/control-plane/request-context.ts";

const jobQuerySchema = z
  .object({
    status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]).optional(),
    jobType: z.string().min(1).max(100).optional(),
    cursor: z.string().min(1).max(1_000).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const Route = createFileRoute("/api/admin/control-plane/jobs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const context = createOperationContext();
        try {
          await requireStaffPermission(request, "system.jobs.read");
          const parsed = jobQuerySchema.safeParse(
            Object.fromEntries(new URL(request.url).searchParams.entries()),
          );
          if (!parsed.success) {
            return errorResponse({ code: "VALIDATION_ERROR" }, context.requestId, 400);
          }
          const [page, summary] = await Promise.all([listJobs(parsed.data), getJobSummary()]);
          return successResponse({ ...page, summary }, context.requestId);
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
          const status = error instanceof Response ? error.status : code === "VALIDATION_ERROR" ? 400 : 500;
          return errorResponse(error, context.requestId, status);
        }
      },
    },
  },
});
