import { createFileRoute } from "@tanstack/react-router";

import { runClaimedJobs } from "../lib/control-plane/jobs.server.ts";
import { getNextJobDueAt } from "../lib/control-plane/jobs-next-due.ts";
import { hasBearerSecret } from "../lib/http/bearer-secret.ts";
import { queryRows } from "../lib/neon/db.server.ts";
import { recordWorkerHeartbeat } from "../lib/control-plane/worker-heartbeat.server.ts";

async function drainJobs({ request }: { request: Request }) {
  if (!hasBearerSecret(request, process.env.CRON_SECRET)) {
    return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  // The general lane's liveness: the scheduled worker reached this route.
  await recordWorkerHeartbeat("general-v1", []);

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
