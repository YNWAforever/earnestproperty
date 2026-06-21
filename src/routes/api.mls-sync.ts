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
        const hasSupabase = Boolean(
          process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
        );

        if (!hasNeon && !hasSupabase) {
          return Response.json(
            {
              ok: false,
              error: "Missing MLS database credentials",
              action:
                "Add DATABASE_URL for Neon or SUPABASE_SERVICE_ROLE_KEY for Supabase, then redeploy to enable MLS writes.",
            },
            { status: 503 },
          );
        }

        const [{ createMlsImporter, createSupabaseMlsDb, defaultFetchText }, neonDb] =
          await Promise.all([
            import("@/lib/mls/importer.mjs"),
            hasNeon ? import("@/lib/mls/neon-db.mjs") : Promise.resolve(null),
          ]);

        const db = neonDb
          ? neonDb.createNeonMlsDb(neonDb.createNeonSqlFromEnv())
          : createSupabaseMlsDb(
              (await import("@/integrations/supabase/client.server")).supabaseAdmin,
            );

        const importer = createMlsImporter({
          fetchText: defaultFetchText,
          db,
          now: () => new Date(),
        });

        const result = await importer.sync({ maxDetails: 200 });
        return Response.json({ ok: true, ...result });
      },
    },
  },
});
