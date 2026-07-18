import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { enqueueJob } from "@/lib/control-plane/jobs.server";
import { requireStaffPermission } from "@/lib/control-plane/permissions";

export const Route = createFileRoute("/api/admin/campaigns/$id/queue")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const staff = await requireStaffPermission(request, "campaign.queue");
        const adminData = await import("@/lib/neon/admin-data.server");
        const result = await adminData.sendAdminCampaignQueue(params.id, staff);
        if (!result.ok) return Response.json(result, { status: 400 });
        const job = await enqueueJob({
          jobType: "woztell.campaign.deliver",
          payloadVersion: 1,
          payload: { campaignId: params.id },
          idempotencyKey: `woztell.campaign.deliver:${params.id}`,
          actorStaffId: staff.staffId,
        });
        return Response.json({ ...result, jobId: job.id, jobStatus: job.status }, { status: 202 });
      },
    },
  },
});
