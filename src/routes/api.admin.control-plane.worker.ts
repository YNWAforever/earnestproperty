import { createFileRoute } from "@tanstack/react-router";

import { runClaimedJobs } from "../lib/control-plane/jobs.server.ts";

async function drainJobs({ request }: { request: Request }) {
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
}

export const Route = createFileRoute("/api/admin/control-plane/worker")({
  server: {
    handlers: {
      // Vercel Cron issues GET, and this path is scheduled in vercel.ts. With
      // POST only, TanStack fell through to the SPA render instead of 405, so
      // the documented "if the Cloudflare Worker is down, jobs still drain
      // within 24h" backstop silently did not exist -- it had never run once.
      // The Bearer CRON_SECRET check applies to both verbs; a drain endpoint
      // reachable by GET is browser-navigable and prefetchable without it.
      GET: drainJobs,
      POST: drainJobs,
    },
  },
});
