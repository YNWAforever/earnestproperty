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

        const [{ supabaseAdmin }, { createMlsImporter, createSupabaseMlsDb, defaultFetchText }] =
          await Promise.all([
            import("@/integrations/supabase/client.server"),
            import("@/lib/mls/importer.mjs"),
          ]);

        const importer = createMlsImporter({
          fetchText: defaultFetchText,
          db: createSupabaseMlsDb(supabaseAdmin),
          now: () => new Date(),
        });

        const result = await importer.sync({ maxDetails: 200 });
        return Response.json({ ok: true, ...result });
      },
    },
  },
});
