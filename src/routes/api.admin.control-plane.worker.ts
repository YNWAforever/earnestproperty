import { createFileRoute } from "@tanstack/react-router";

import { runClaimedJobs } from "../lib/control-plane/jobs.server.ts";
import { getNextJobDueAt } from "../lib/control-plane/jobs-next-due.ts";
import { queryRows } from "../lib/neon/db.server.ts";

async function drainJobs({ request }: { request: Request }) {
  const expected = process.env.CRON_SECRET;
  const actual = request.headers.get("authorization");
  if (!expected || actual !== `Bearer ${expected}`) {
    return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const counts = await runClaimedJobs({
    workerId: `control-plane:${crypto.randomUUID()}`,
    lane: "general",
    limit: 10,
    leaseSeconds: 60,
  });
  const nextDueAt = await getNextJobDueAt({
    lane: "general",
    query: (sql, params) => queryRows<{ due_at: unknown }>(sql, params),
  });
  return Response.json({
    claimed: counts.claimed,
    succeeded: counts.succeeded,
    retried: counts.retried,
    failed: counts.failed,
    cancelled: counts.cancelled,
    nextDueAt,
  });
}

export const Route = createFileRoute("/api/admin/control-plane/worker")({
  server: {
    handlers: {
      // Both verbs keep the same Bearer check for manual recovery calls.
      GET: drainJobs,
      POST: drainJobs,
    },
  },
});
