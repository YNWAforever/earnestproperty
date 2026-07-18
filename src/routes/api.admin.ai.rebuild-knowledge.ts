import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { enqueueJob } from "@/lib/control-plane/jobs.server";
import { requireStaffPermission } from "@/lib/control-plane/permissions";

export const Route = createFileRoute("/api/admin/ai/rebuild-knowledge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const actor = await requireStaffPermission(request, "ai.knowledge.rebuild");
        const activeWindow = Math.floor(Date.now() / (5 * 60 * 1_000));
        const job = await enqueueJob({
          jobType: "ai.knowledge.rebuild",
          payloadVersion: 1,
          payload: { requestedByStaffId: actor.staffId },
          idempotencyKey: `ai.knowledge.rebuild:${activeWindow}`,
          actorStaffId: actor.staffId,
        });
        return Response.json({ jobId: job.id, status: job.status }, { status: 202 });
      },
    },
  },
});
