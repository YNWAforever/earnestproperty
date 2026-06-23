import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { requireStaffAccess } from "@/lib/neon/auth.server";

export const Route = createFileRoute("/api/admin/campaigns/$id/queue")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const staff = await requireStaffAccess(request, ["admin", "manager"]);
        const adminData = await import("@/lib/neon/admin-data.server");
        const result = await adminData.sendAdminCampaignQueue(params.id, staff);
        return Response.json(result, { status: result.ok ? 200 : 400 });
      },
    },
  },
});
