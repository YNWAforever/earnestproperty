import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { campaignDeliveryIdempotencyKey } from "@/lib/control-plane/jobs";
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
          // Scoped to this queue run (campaigns.reviewed_at), not just the
          // campaign. A campaign-stable key meant that once its job reached a
          // terminal state, enqueueJob's ON CONFLICT no-op returned the dead
          // row forever: this route answered 202 {jobStatus:"succeeded"}, the
          // UI said 已排隊, and nothing was ever queued again.
          idempotencyKey: campaignDeliveryIdempotencyKey(params.id, result.queueRunAt),
          actorStaffId: staff.staffId,
        });
        return Response.json({ ...result, jobId: job.id, jobStatus: job.status }, { status: 202 });
      },
    },
  },
});
