import "@tanstack/react-start/server-only";
import { createFileRoute } from "@tanstack/react-router";
import { handleWoztellWebhook } from "@/lib/whatsapp-enquiries/webhook.server";
// handleWoztellWebhook authenticates then delegates to ingestWoztellEvent atomically.
export const Route = createFileRoute("/api/woztell/webhook")({
  server: { handlers: { POST: async ({ request }) => handleWoztellWebhook(request) } },
});
