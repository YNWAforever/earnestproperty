import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { requireStaffPermission } from "@/lib/control-plane/permissions";

export const Route = createFileRoute("/api/admin/campaigns/$id/queue")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const staff = await requireStaffPermission(request, "campaign.queue");
        const adminData = await import("@/lib/neon/admin-data.server");
        const result = await adminData.sendAdminCampaignQueue(params.id, staff);
        if (!result.ok) return Response.json(result, { status: 400 });
        return Response.json(result, { status: 202 });
      },
    },
  },
});
