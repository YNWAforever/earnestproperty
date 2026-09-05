import "@tanstack/react-start/server-only";
import { createFileRoute } from "@tanstack/react-router";
import { requireStaffAccess } from "@/lib/neon/auth.server";
import { startHistoryImport } from "@/lib/woztell/history-import.server";
export const Route = createFileRoute("/api/admin/woztell/backfill")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const staff = await requireStaffAccess(request, ["admin"]);
        if (!process.env.WOZTELL_OPEN_API_TOKEN || !process.env.WOZTELL_CHANNEL_ID)
          return Response.json(
            {
              ok: false,
              error: "WOZTELL_HISTORY_CONFIGURATION_REQUIRED",
              hint: "WOZTELL_OPEN_API_TOKEN is separate from WOZTELL_BOT_ACCESS_TOKEN; configure api:admin scope and WOZTELL_CHANNEL_ID.",
            },
            { status: 503 },
          );
        const body = (await request.json().catch(() => null)) as { mode?: unknown } | null;
        if (body?.mode !== undefined && body.mode !== "forward" && body.mode !== "backward")
          return Response.json({ ok: false, error: "VALIDATION_ERROR" }, { status: 400 });
        const run = await startHistoryImport(
          staff.staffId,
          body?.mode === "backward" ? "backward" : "forward",
        );
        return Response.json(
          { ok: true, importId: run.id, reachedEnd: run.completed, queued: !run.completed },
          { status: 202 },
        );
      },
    },
  },
});
