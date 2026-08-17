import { createFileRoute } from "@tanstack/react-router";

import { createYouTubeSyncHttpHandlers } from "@/lib/youtube-sync/youtube-http.server";

const handlers = createYouTubeSyncHttpHandlers();

export const Route = createFileRoute("/api/youtube-sync/full")({
  server: {
    handlers: {
      GET: ({ request }) => handlers.cron(request, "full"),
    },
  },
});
