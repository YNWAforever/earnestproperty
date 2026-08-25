import { createFileRoute } from "@tanstack/react-router";

import { createYouTubeSyncHttpHandlers } from "@/lib/youtube-sync/youtube-http.server";

const handlers = createYouTubeSyncHttpHandlers();

export const Route = createFileRoute("/api/youtube-sync")({
  server: {
    handlers: {
      GET: ({ request }) => handlers.cron(request, "incremental"),
      POST: ({ request }) => handlers.staff(request),
    },
  },
});
