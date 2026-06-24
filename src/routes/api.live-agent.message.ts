import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import {
  LiveAgentPublicError,
  answerLiveAgentMessage,
  isLiveAgentSessionId,
} from "@/lib/ai/live-agent.server";

export const Route = createFileRoute("/api/live-agent/message")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readJsonBody(request);
        if (typeof body.sessionId !== "string" || typeof body.message !== "string") {
          return Response.json({ error: "Invalid live-agent message" }, { status: 400 });
        }

        const sessionId = body.sessionId.trim();
        const message = body.message.trim();
        if (!isLiveAgentSessionId(sessionId) || !message) {
          return Response.json({ error: "Invalid live-agent message" }, { status: 400 });
        }

        try {
          const result = await answerLiveAgentMessage({
            sessionId,
            message,
          });

          return Response.json(result);
        } catch (err) {
          if (err instanceof LiveAgentPublicError) {
            return Response.json({ error: err.message }, { status: err.status });
          }
          return Response.json({ error: "Unable to answer live-agent message" }, { status: 500 });
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
