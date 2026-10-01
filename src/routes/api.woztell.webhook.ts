import "@tanstack/react-start/server-only";
import { createFileRoute } from "@tanstack/react-router";
import { handleWoztellWebhook } from "@/lib/whatsapp-enquiries/webhook.server";
// handleWoztellWebhook authenticates, commits a minimum receipt, then projects it.
export const Route = createFileRoute("/api/woztell/webhook")({
  server: { handlers: { POST: async ({ request }) => handleWoztellWebhook(request) } },
});
