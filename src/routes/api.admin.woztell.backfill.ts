import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { requireStaffAccess } from "@/lib/neon/auth.server";
import { backfillWoztellHistory } from "@/lib/woztell/woztell-history.server";
import { WoztellHistoryError } from "@/lib/woztell/woztell-history.server";
import { ingestWoztellEvent } from "@/lib/woztell/woztell-ingest.server";

/**
 * Import historical WhatsApp messages from WOZTELL into the admin inbox.
 *
 * Runs here rather than as a CLI script for two reasons. The obvious one is
 * that production already holds DATABASE_URL and the WOZTELL credentials, so
 * nobody has to pull secrets onto a laptop to run it. The other is that
 * ingestion has to go through ingestWoztellEvent, which reaches the database
 * through the `@/lib/neon` aliases -- a plain `node scripts/...` process cannot
 * resolve those without a build step.
 *
 * Admin-only: this writes to crm_contacts, which is the CRM's source of truth.
 */

/**
 * Ten pages = up to 1,000 messages per call. Each row costs three or four Neon
 * round trips, so this is sized to finish well inside Vercel's 300s function
 * limit; the response carries a cursor for the next call rather than trying to
 * drain everything and dying halfway with nothing to show for it.
 */
const DEFAULT_MAX_PAGES = 10;
const MAX_PAGES_CEILING = 40;

function positiveIntOrNull(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.floor(numeric);
}

export const Route = createFileRoute("/api/admin/woztell/backfill")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        await requireStaffAccess(request, ["admin"]);

        const token = process.env.WOZTELL_OPEN_API_TOKEN;
        if (!token) {
          return Response.json(
            {
              ok: false,
              error: "WOZTELL_OPEN_API_TOKEN is not set",
              hint:
                "This is a SECOND token, separate from WOZTELL_BOT_ACCESS_TOKEN. The send " +
                "token carries bot:* scopes, which cannot read conversation history. Generate " +
                "one at Settings -> Access Tokens with the api:admin scope.",
            },
            { status: 503 },
          );
        }

        const body = (await request.json().catch(() => null)) as {
          maxPages?: unknown;
          after?: unknown;
          from?: unknown;
          to?: unknown;
          mode?: unknown;
        } | null;

        const requestedPages = positiveIntOrNull(body?.maxPages) ?? DEFAULT_MAX_PAGES;
        const maxPages = Math.min(requestedPages, MAX_PAGES_CEILING);
        const startCursor = typeof body?.after === "string" && body.after ? body.after : null;
        // Forward is WOZTELL's documented form; backward is the one their own
        // n8n node ships. If a forward run reports rows: 0 against a channel
        // that visibly has messages, retry with mode: "backward" before
        // concluding the history is empty.
        const mode = body?.mode === "backward" ? "backward" : "forward";

        try {
          const summary = await backfillWoztellHistory({
            token,
            // Scope to the configured channel so a multi-channel app cannot
            // pull another channel's conversations into this agency's inbox.
            channelId: process.env.WOZTELL_CHANNEL_ID ?? null,
            from: positiveIntOrNull(body?.from),
            to: positiveIntOrNull(body?.to),
            maxPages,
            startCursor,
            mode,
            ingest: ingestWoztellEvent,
          });

          return Response.json({ ok: true, mode, ...summary });
        } catch (error) {
          // A bad or wrongly-scoped token comes back as an HTTP 200 GraphQL
          // error ("User is not authenticated."), which fetchWoztellHistoryPage
          // raises rather than reporting as an empty inbox. Surface it as a
          // failure so the caller cannot mistake it for "there is no history".
          if (error instanceof WoztellHistoryError) {
            return Response.json(
              { ok: false, error: error.message, status: error.status ?? null },
              { status: 502 },
            );
          }
          throw error;
        }
      },
    },
  },
});
