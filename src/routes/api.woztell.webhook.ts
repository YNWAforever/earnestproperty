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
          // Without this line a rejected webhook is completely invisible: the
          // customer's message is dropped, nothing is written, and WOZTELL's own
          // console still shows the message as delivered -- so the inbox just
          // quietly stops receiving and no one can tell why. Rotating the
          // channel's credentials does exactly this, and the failure looks
          // identical to "nobody messaged us today".
          //
          // The three states are separated because they have different fixes,
          // and guessing between them costs a day: a missing header means
          // something other than WOZTELL is posting (or signing is off), an
          // unset secret is a deploy/env problem, and both-present-but-invalid
          // is a stale WOZTELL_CHANNEL_SECRET. Neither the body nor the secret
          // is logged -- the body carries customer messages.
          const signatureHeader = request.headers.get("x-woztell-signature");
          console.warn(
            "[woztell] webhook REJECTED (401): signature did not verify. " +
              `signature header: ${signatureHeader ? "present" : "MISSING"}; ` +
              `WOZTELL_CHANNEL_SECRET: ${config.channelSecret ? "configured" : "NOT SET"}; ` +
              `body length: ${raw.length} chars. ` +
              "If both are present, the stored secret no longer matches the channel.",
          );
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
