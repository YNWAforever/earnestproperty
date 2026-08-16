import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import {
  LiveAgentPublicError,
  isLiveAgentSessionId,
  requestLiveAgentHandoff,
} from "@/lib/ai/live-agent.server";
import { clientIpFromRequest, enforceRateLimit } from "@/lib/ratelimit.server";

const HANDOFF_RATE_LIMIT = 5;
const HANDOFF_RATE_WINDOW_SECONDS = 60;

export const Route = createFileRoute("/api/live-agent/handoff")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readJsonBody(request);
        if (typeof body.sessionId !== "string" || typeof body.accessToken !== "string") {
          return Response.json({ error: "Invalid handoff session" }, { status: 400 });
        }

        const sessionId = body.sessionId.trim();
        const accessToken = body.accessToken.trim();
        if (!isLiveAgentSessionId(sessionId) || !accessToken) {
          return Response.json({ error: "Invalid handoff session" }, { status: 400 });
        }

        try {
          await enforceRateLimit({
            key: `live-agent:handoff:ip:${clientIpFromRequest(request)}`,
            limit: HANDOFF_RATE_LIMIT,
            windowSeconds: HANDOFF_RATE_WINDOW_SECONDS,
          });

          const result = await requestLiveAgentHandoff({
            sessionId,
            accessToken,
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
          if (err instanceof Response) return err;
          if (err instanceof LiveAgentPublicError) {
            const status = err.status;
            return Response.json({ error: err.message }, { status });
          }
          // Log before swallowing. A 500 here means a real visitor asked for a
          // human and did not get one, and the cause was previously discarded
          // entirely -- nothing in this repo's 19 API routes recorded it, so the
          // only trace was a lost lead.
          console.error("[live-agent] handoff failed", { sessionId, error: err });
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
