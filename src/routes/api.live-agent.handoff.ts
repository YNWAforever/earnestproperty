import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { readPublicJsonBody } from "@/lib/ai/read-public-json-body";
import { leadBudgetError } from "@/lib/admin/lead-budget";

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
        let body: Record<string, unknown>;
        try {
          body = await readPublicJsonBody(request);
        } catch (error) {
          if (error instanceof Response) return error;
          throw error;
        }
        if (typeof body.sessionId !== "string" || typeof body.accessToken !== "string") {
          return Response.json({ error: "Invalid handoff session" }, { status: 400 });
        }

        const sessionId = body.sessionId.trim();
        const accessToken = body.accessToken.trim();
        if (!isLiveAgentSessionId(sessionId) || !accessToken) {
          return Response.json({ error: "Invalid handoff session" }, { status: 400 });
        }

        const rawBudgetMin = body.budget_min;
        const rawBudgetMax = body.budget_max;
        if (
          (rawBudgetMin != null && typeof rawBudgetMin !== "number") ||
          (rawBudgetMax != null && typeof rawBudgetMax !== "number")
        ) {
          return Response.json({ error: "Invalid handoff budget" }, { status: 400 });
        }
        const budgetMin = typeof rawBudgetMin === "number" ? rawBudgetMin : null;
        const budgetMax = typeof rawBudgetMax === "number" ? rawBudgetMax : null;
        if (leadBudgetError(budgetMin, budgetMax)) {
          return Response.json({ error: "Invalid handoff budget" }, { status: 400 });
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
            budget_min: budgetMin,
            budget_max: budgetMax,
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
