import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import {
  LiveAgentPublicError,
  answerLiveAgentMessage,
  isLiveAgentSessionId,
} from "@/lib/ai/live-agent.server";
import { clientIpFromRequest, enforceRateLimit } from "@/lib/ratelimit.server";

const MESSAGE_RATE_LIMIT_PER_IP = 30;
const MESSAGE_RATE_LIMIT_PER_SESSION = 20;
const MESSAGE_RATE_WINDOW_SECONDS = 60;

export const Route = createFileRoute("/api/live-agent/message")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readJsonBody(request);
        if (
          typeof body.sessionId !== "string" ||
          typeof body.accessToken !== "string" ||
          typeof body.message !== "string"
        ) {
          return Response.json({ error: "Invalid live-agent message" }, { status: 400 });
        }

        const sessionId = body.sessionId.trim();
        const accessToken = body.accessToken.trim();
        const message = body.message.trim();
        if (!isLiveAgentSessionId(sessionId) || !accessToken || !message) {
          return Response.json({ error: "Invalid live-agent message" }, { status: 400 });
        }

        try {
          await enforceRateLimit({
            key: `live-agent:message:ip:${clientIpFromRequest(request)}`,
            limit: MESSAGE_RATE_LIMIT_PER_IP,
            windowSeconds: MESSAGE_RATE_WINDOW_SECONDS,
          });
          await enforceRateLimit({
            key: `live-agent:message:session:${sessionId}`,
            limit: MESSAGE_RATE_LIMIT_PER_SESSION,
            windowSeconds: MESSAGE_RATE_WINDOW_SECONDS,
          });

          const result = await answerLiveAgentMessage({
            sessionId,
            accessToken,
            message,
          });

          return Response.json(result);
        } catch (err) {
          if (err instanceof Response) return err;
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
