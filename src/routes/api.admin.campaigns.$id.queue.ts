import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { requireStaffPermission } from "@/lib/control-plane/permissions";

export const Route = createFileRoute("/api/admin/campaigns/$id/queue")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const staff = await requireStaffPermission(request, "campaign.queue");
        const adminData = await import("@/lib/neon/admin-data.server");
        // FX-10b: the count the confirmation showed. For a campaign with
        // delivery history the server refuses with SEND_COUNT_CHANGED (409) if
        // it would queue a different number.
        const body = (await request.json().catch(() => null)) as { expectedCount?: unknown } | null;
        const expectedCount =
          typeof body?.expectedCount === "number" && Number.isSafeInteger(body.expectedCount)
            ? body.expectedCount
            : null;
        const result = await adminData.sendAdminCampaignQueue(params.id, staff, { expectedCount });
        if (!result.ok) {
          const status = result.error === "SEND_COUNT_CHANGED" ? 409 : 400;
          return Response.json(result, { status });
        }
        return Response.json(result, { status: 202 });
      },
    },
  },
});
