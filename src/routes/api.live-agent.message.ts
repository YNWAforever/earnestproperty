import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { answerLiveAgentMessage } from "@/lib/ai/live-agent.server";

export const Route = createFileRoute("/api/live-agent/message")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readJsonBody(request);
        if (typeof body.sessionId !== "string" || typeof body.message !== "string") {
          return Response.json({ error: "Invalid live-agent message" }, { status: 400 });
        }

        const message = body.message.trim();
        if (!message) {
          return Response.json({ error: "Invalid live-agent message" }, { status: 400 });
        }

        const result = await answerLiveAgentMessage({
          sessionId: body.sessionId,
          message,
        });

        return Response.json(result);
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
