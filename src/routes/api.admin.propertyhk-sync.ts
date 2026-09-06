import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/admin/propertyhk-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handlePropertyhkRequest } = await import("@/lib/mls/propertyhk-http.mjs");
        return handlePropertyhkRequest(request, {
          secret: process.env.PROPERTYHK_SYNC_SECRET,
          connectionString: process.env.DATABASE_URL_UNPOOLED,
          maxBytes: process.env.PROPERTYHK_SYNC_MAX_BYTES
            ? Number(process.env.PROPERTYHK_SYNC_MAX_BYTES)
            : undefined,
          ingest: async (payload, options) => {
            const { ingestSnapshot } = await import("@/lib/mls/ingestion-service.mjs");
            return ingestSnapshot(payload, options);
          },
        });
      },
    },
  },
});
