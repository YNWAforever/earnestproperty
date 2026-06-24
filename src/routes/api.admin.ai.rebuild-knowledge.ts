import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { rebuildAdminAiKnowledge } from "@/lib/neon/admin-data.server";
import { requireStaffAccess } from "@/lib/neon/auth.server";

export const Route = createFileRoute("/api/admin/ai/rebuild-knowledge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const actor = await requireStaffAccess(request, ["admin", "manager"]);
        const result = await rebuildAdminAiKnowledge(actor);
        return Response.json(result);
      },
    },
  },
});
