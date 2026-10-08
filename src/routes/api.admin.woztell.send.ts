import "@tanstack/react-start/server-only";
import { createFileRoute } from "@tanstack/react-router";
import { requireStaffAccess } from "@/lib/neon/auth.server";
import { agentScope } from "@/lib/neon/admin-data.server";
import {
  enqueueOutboundIntent,
  parseOutboundIntent,
  readOutboundIntent,
  readOutboundReservation,
} from "@/lib/woztell/outbound-intent.server";

export const Route = createFileRoute("/api/admin/woztell/send")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const staff = await requireStaffAccess(request, ["admin", "manager", "agent"]);
        try {
          const params = new URL(request.url).searchParams;
          if (params.get("reconciliation") === "true") {
            const reservation = await readOutboundReservation(
              { conversationId: params.get("conversationId") ?? "" },
              staff.staffId,
              agentScope(staff),
            );
            return reservation
              ? Response.json(
                  { ok: true, reservation },
                  { headers: { "Cache-Control": "no-store" } },
                )
              : Response.json(
                  { ok: false, error: "OUTBOUND_NOT_FOUND_OR_FORBIDDEN" },
                  { status: 404, headers: { "Cache-Control": "no-store" } },
                );
          }
          const intent = await readOutboundIntent(
            {
              requestId: params.get("requestId") ?? "",
              conversationId: params.get("conversationId") ?? "",
            },
            staff.staffId,
            agentScope(staff),
          );
          return intent
            ? Response.json({ ok: true, intent }, { headers: { "Cache-Control": "no-store" } })
            : Response.json(
                { ok: false, error: "OUTBOUND_NOT_FOUND_OR_FORBIDDEN" },
                { status: 404, headers: { "Cache-Control": "no-store" } },
              );
        } catch (error) {
          const invalid =
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "VALIDATION_ERROR";
          return Response.json(
            { ok: false, error: invalid ? "VALIDATION_ERROR" : "OUTBOUND_READ_UNAVAILABLE" },
            { status: invalid ? 400 : 503, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
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
            enquiryId: body.enquiryId,
            conversationId: body.conversationId,
            kind: "text",
            payload: { text: body.text },
          });
          const intent = await enqueueOutboundIntent(input, staff.staffId, agentScope(staff));
          return Response.json({ ok: true, intent }, { status: 202 });
        } catch (error) {
          const associationError =
            error instanceof Error &&
            /ENQUIRY_(SELECTION_REQUIRED|ASSOCIATION_INVALID)|OUTBOUND_(RECONCILIATION_REQUIRED|CONFLICT_OR_NOT_FOUND)/.exec(
              error.message,
            )?.[0];
          const code =
            associationError ||
            (error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "OUTBOUND_PERSISTENCE_UNAVAILABLE");
          const status =
            code === "OUTBOUND_CONFLICT_OR_NOT_FOUND" ||
            code === "IDENTITY_REVIEW_REQUIRED" ||
            code === "ENQUIRY_SELECTION_REQUIRED" ||
            code === "ENQUIRY_ASSOCIATION_INVALID" ||
            code === "OUTBOUND_RECONCILIATION_REQUIRED"
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
