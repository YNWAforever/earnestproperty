import { createFileRoute } from "@tanstack/react-router";

import { runClaimedJobs } from "../lib/control-plane/jobs.server.ts";

export const Route = createFileRoute("/api/admin/control-plane/worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.CRON_SECRET;
        const actual = request.headers.get("authorization");
        if (!expected || actual !== `Bearer ${expected}`) {
          return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
        }

        const counts = await runClaimedJobs({
          workerId: `control-plane:${crypto.randomUUID()}`,
          limit: 10,
          leaseSeconds: 60,
        });
        return Response.json({
          claimed: counts.claimed,
          succeeded: counts.succeeded,
          retried: counts.retried,
          failed: counts.failed,
          cancelled: counts.cancelled,
        });
      },
    },
  },
});
