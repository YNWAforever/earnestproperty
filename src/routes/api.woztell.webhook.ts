import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { ingestWoztellEvent } from "@/lib/woztell/woztell-ingest.server";
import {
  normalizeWoztellEvent,
  verifyWoztellSignature,
  woztellConfig,
} from "@/lib/woztell/woztell.server";

export const Route = createFileRoute("/api/woztell/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const config = woztellConfig();
        const valid = verifyWoztellSignature(
          Buffer.from(raw),
          request.headers.get("x-woztell-signature"),
          config.channelSecret,
        );

        if (!valid) {
          return Response.json({ ok: false, error: "Invalid signature" }, { status: 401 });
        }

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(raw || "{}") as Record<string, unknown>;
        } catch {
          return Response.json({ ok: false, error: "INVALID_JSON" }, { status: 400 });
        }

        // The upsert itself lives in woztell-ingest.server.ts because the
        // history backfill has to write byte-identical rows -- see the comment
        // there.
        const outcome = await ingestWoztellEvent(normalizeWoztellEvent(payload));
        if (outcome.skipped) {
          return Response.json({ ok: true, skipped: outcome.skipped });
        }

        return Response.json({ ok: true });
      },
    },
  },
});
