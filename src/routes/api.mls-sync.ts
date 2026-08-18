import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";

function hasValidAuthorization(request: Request, expectedSecret: string) {
  const actual = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${expectedSecret}`;
  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

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

        if (!hasValidAuthorization(request, cronSecret)) {
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }

        const neonDb = await import("@/lib/mls/neon-db.mjs");
        const db = neonDb.createNeonMlsDb(neonDb.createNeonSqlFromEnv());
        const latestRun = await db.getLatestSyncRun();

        return Response.json({ ok: true, publisher: "vps", latestRun });
      },
    },
  },
});
