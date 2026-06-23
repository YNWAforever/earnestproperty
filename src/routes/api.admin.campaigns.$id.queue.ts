import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { requireStaffAccess } from "@/lib/neon/auth.server";

export const Route = createFileRoute("/api/admin/campaigns/$id/queue")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const staff = await requireStaffAccess(request, ["admin", "manager"]);
        const adminData = await import("@/lib/neon/admin-data.server");
        const materialization = await adminData.materializeCampaignRecipients(params.id, staff);
        if (!materialization.ok) {
          return Response.json(
            { ok: false, error: materialization.error, materialization },
            { status: 400 },
          );
        }

        const result = await adminData.queueAdminCampaign(params.id, staff);
        return Response.json({ ...result, materialization }, { status: result.ok ? 200 : 400 });
      },
    },
  },
});
