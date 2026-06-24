import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { createLiveAgentSession, toPublicLiveAgentSession } from "@/lib/ai/live-agent.server";

export const Route = createFileRoute("/api/live-agent/session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readJsonBody(request);
        const session = await createLiveAgentSession({
          anonymousId: typeof body.anonymousId === "string" ? body.anonymousId : null,
          sourcePath: typeof body.sourcePath === "string" ? body.sourcePath : null,
        });

        return Response.json(toPublicLiveAgentSession(session));
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
