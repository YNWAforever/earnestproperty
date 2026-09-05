import "@tanstack/react-start/server-only";
import { createFileRoute } from "@tanstack/react-router";
import { requireStaffAccess } from "@/lib/neon/auth.server";
import { agentScope } from "@/lib/neon/admin-data.server";
import { enqueueOutboundIntent, parseOutboundIntent } from "@/lib/woztell/outbound-intent.server";

export const Route = createFileRoute("/api/admin/woztell/send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const staff = await requireStaffAccess(request, ["admin", "manager", "agent"]);
        try {
          const raw = await request.text();
          if (raw.length > 8192)
            return Response.json({ ok: false, error: "VALIDATION_ERROR" }, { status: 400 });
          const body = JSON.parse(raw);
          if (!body || typeof body !== "object" || Array.isArray(body))
            return Response.json({ ok: false, error: "VALIDATION_ERROR" }, { status: 400 });
          const input = parseOutboundIntent({
            requestId: body.requestId,
            conversationId: body.conversationId,
            kind: "text",
            payload: { text: body.text },
          });
          const intent = await enqueueOutboundIntent(input, staff.staffId, agentScope(staff));
          return Response.json({ ok: true, intent }, { status: 202 });
        } catch (error) {
          const code =
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "OUTBOUND_PERSISTENCE_UNAVAILABLE";
          const status =
            code === "OUTBOUND_CONFLICT_OR_NOT_FOUND"
              ? 409
              : code === "VALIDATION_ERROR" || error instanceof SyntaxError
                ? 400
                : 503;
          return Response.json(
            { ok: false, error: status === 503 ? "OUTBOUND_PERSISTENCE_UNAVAILABLE" : code },
            { status },
          );
        }
      },
    },
  },
});
