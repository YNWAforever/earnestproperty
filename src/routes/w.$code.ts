import "@tanstack/react-start/server-only";
import { createFileRoute } from "@tanstack/react-router";
import { trackedRedirect } from "@/lib/neon/whatsapp-enquiries.server";
export const Route = createFileRoute("/w/$code")({
  server: {
    handlers: {
      GET: ({ request, params }) => trackedRedirect(request, params.code),
      HEAD: ({ request, params }) => trackedRedirect(request, params.code),
    },
  },
});
