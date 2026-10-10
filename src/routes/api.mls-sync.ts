import { createFileRoute } from "@tanstack/react-router";
import { hasBearerSecret } from "@/lib/http/bearer-secret";
import { latestRunPublisher } from "@/lib/mls/status-publisher.mjs";

export const Route = createFileRoute("/api/mls-sync")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const cronSecret = process.env.CRON_SECRET;
        const databaseUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;

        if (!cronSecret || !databaseUrl) {
          return Response.json(
            {
              ok: false,
              error: "MLS status is not configured",
            },
            { status: 503 },
          );
        }

        if (!hasBearerSecret(request, cronSecret)) {
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }

        const neonDb = await import("@/lib/mls/neon-db.mjs");
        const db = neonDb.createNeonMlsDb(neonDb.createNeonSqlFromEnv());
        const latestRun = await db.getLatestSyncRun();

        return Response.json({
          ok: true,
          publisher: latestRunPublisher(latestRun),
          latestRun,
        });
      },
    },
  },
});
