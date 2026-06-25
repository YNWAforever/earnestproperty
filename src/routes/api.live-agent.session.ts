import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { createLiveAgentSession, toPublicLiveAgentSession } from "@/lib/ai/live-agent.server";
import { clientIpFromRequest, enforceRateLimit } from "@/lib/ratelimit.server";

const SESSION_RATE_LIMIT = 15;
const SESSION_RATE_WINDOW_SECONDS = 60;

export const Route = createFileRoute("/api/live-agent/session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await enforceRateLimit({
            key: `live-agent:session:ip:${clientIpFromRequest(request)}`,
            limit: SESSION_RATE_LIMIT,
            windowSeconds: SESSION_RATE_WINDOW_SECONDS,
          });
        } catch (err) {
          if (err instanceof Response) return err;
          throw err;
        }

        const body = await readJsonBody(request);
        const { session, accessToken } = await createLiveAgentSession({
          anonymousId: typeof body.anonymousId === "string" ? body.anonymousId : null,
          sourcePath: typeof body.sourcePath === "string" ? body.sourcePath : null,
          sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
          accessToken: typeof body.accessToken === "string" ? body.accessToken : null,
        });

        return Response.json({ ...toPublicLiveAgentSession(session), accessToken });
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
