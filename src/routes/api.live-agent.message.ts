import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { readPublicJsonBody } from "@/lib/ai/read-public-json-body";

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
        let body: Record<string, unknown>;
        try {
          body = await readPublicJsonBody(request);
        } catch (error) {
          if (error instanceof Response) return error;
          throw error;
        }
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
          // See the handoff route: the real error was thrown away, so a broken
          // AI backend looked identical to a visitor asking something odd.
          console.error("[live-agent] message failed", { sessionId, error: err });
          return Response.json({ error: "Unable to answer live-agent message" }, { status: 500 });
        }
      },
    },
  },
});
