import { runServiceJobs } from "../lib/control-plane/service-worker.server.ts";
import { getNextJobDueAt } from "../lib/control-plane/jobs-next-due.ts";
import { SERVICE_CAPABILITIES } from "../lib/control-plane/job-handlers.server.ts";
import { hasBearerSecret } from "../lib/http/bearer-secret.ts";
import { queryRows } from "../lib/neon/db.server.ts";
import { recordWorkerHeartbeat } from "../lib/control-plane/worker-heartbeat.server.ts";
import { createFileRoute } from "@tanstack/react-router";

export async function drainServiceJobs({ request }: { request: Request }) {
  if (!hasBearerSecret(request, process.env.CRON_SECRET))
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    await recordWorkerHeartbeat("service-v2", SERVICE_CAPABILITIES);
    const counts = await runServiceJobs();
    const nextDueAt = await getNextJobDueAt({
      lane: "service",
      capabilities: SERVICE_CAPABILITIES,
      query: (sql, params) => queryRows<{ due_at: unknown }>(sql, params),
    });
    return Response.json({ ...counts, nextDueAt });
  } catch (error) {
    if (error instanceof Error && error.message === "SERVICE_SCHEMA_REQUIRED")
      return Response.json({ error: "SERVICE_SCHEMA_REQUIRED" }, { status: 503 });
    throw error;
  }
}

export const Route = createFileRoute("/api/admin/whatsapp/service-worker")({
  server: { handlers: { POST: drainServiceJobs } },
});
