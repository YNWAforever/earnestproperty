import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/mls-sync")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const expected = process.env.CRON_SECRET;
        const actual = request.headers.get("authorization");

        if (!expected || actual !== `Bearer ${expected}`) {
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }

        const hasNeon = Boolean(process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED);

        if (!hasNeon) {
          return Response.json(
            {
              ok: false,
              error: "Missing MLS database credentials",
              action: "Add DATABASE_URL for Neon, then redeploy to enable MLS writes.",
            },
            { status: 503 },
          );
        }

        const [{ createMlsImporter, defaultFetchText }, neonDb] = await Promise.all([
          import("@/lib/mls/importer.mjs"),
          import("@/lib/mls/neon-db.mjs"),
        ]);

        const db = neonDb.createNeonMlsDb(neonDb.createNeonSqlFromEnv());

        const importer = createMlsImporter({
          fetchText: defaultFetchText,
          db,
          now: () => new Date(),
        });

        // Nightly cron does full discovery across all pages, so it may
        // deactivate listings that disappeared from the source. Deactivation
        // compares against every discovered legacy id, not just the fetched subset.
        const result = await importer.sync({ maxDetails: 200, fullSync: true });

        // A refused sweep is a failure, not a quiet zero. Discovery degrades
        // silently (pager markup changes, page caps), and the DB layer blocks
        // the sweep rather than deactivating inventory it simply never saw --
        // but if this still answered ok:true, nobody would ever look. 5xx so
        // the cron run is visibly red in Vercel.
        if (result.deactivationBlocked) {
          return Response.json(
            {
              ok: false,
              error: result.deactivationBlocked,
              action:
                "Discovery covered too little of the live inventory to trust a deactivation sweep. " +
                "Check the source pager, then re-run once discovery looks complete.",
              ...result,
            },
            { status: 500 },
          );
        }

        return Response.json({ ok: true, ...result });
      },
    },
  },
});
