import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import {
  LiveAgentPublicError,
  isLiveAgentSessionId,
  requestLiveAgentHandoff,
} from "@/lib/ai/live-agent.server";

export const Route = createFileRoute("/api/live-agent/handoff")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readJsonBody(request);
        if (typeof body.sessionId !== "string") {
          return Response.json({ error: "Invalid handoff session" }, { status: 400 });
        }

        const sessionId = body.sessionId.trim();
        if (!isLiveAgentSessionId(sessionId)) {
          return Response.json({ error: "Invalid handoff session" }, { status: 400 });
        }

        try {
          const result = await requestLiveAgentHandoff({
            sessionId,
            name: typeof body.name === "string" ? body.name : null,
            phone: typeof body.phone === "string" ? body.phone : null,
            email: typeof body.email === "string" ? body.email : null,
            intent: typeof body.intent === "string" ? body.intent : null,
            budget_min: typeof body.budget_min === "number" ? body.budget_min : null,
            budget_max: typeof body.budget_max === "number" ? body.budget_max : null,
            preferred_estates: Array.isArray(body.preferred_estates)
              ? body.preferred_estates.map(String)
              : [],
            opt_in_whatsapp: body.opt_in_whatsapp === true,
          });

          return Response.json(result);
        } catch (err) {
          if (err instanceof LiveAgentPublicError) {
            const status = err.status === 404 ? 404 : 400;
            return Response.json({ error: err.message }, { status });
          }
          return Response.json({ error: "Unable to request handoff" }, { status: 500 });
        }
      },
    },
  },
});

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => ({}));
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}
