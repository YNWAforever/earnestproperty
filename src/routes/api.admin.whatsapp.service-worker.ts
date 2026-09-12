import { createFileRoute } from "@tanstack/react-router";
import { runClaimedJobs } from "../lib/control-plane/jobs.server.ts";
import { SERVICE_CAPABILITIES } from "../lib/control-plane/job-handlers.server.ts";
import { queryRows } from "../lib/neon/db.server.ts";
export async function drainServiceJobs({ request }: { request: Request }) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`)
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const [schema] = await queryRows(
    "SELECT to_regclass('whatsapp_service_worker_heartbeats') IS NOT NULL AS available",
  );
  if (!schema?.available)
    return Response.json({ error: "SERVICE_SCHEMA_REQUIRED" }, { status: 503 });
  await queryRows(
    "INSERT INTO whatsapp_service_worker_heartbeats(worker_id,seen_at,capabilities) VALUES('service-v2',now(),$1::jsonb) ON CONFLICT(worker_id) DO UPDATE SET seen_at=EXCLUDED.seen_at,capabilities=EXCLUDED.capabilities",
    [JSON.stringify(SERVICE_CAPABILITIES)],
  );
  return Response.json(
    await runClaimedJobs({
      workerId: `service:${crypto.randomUUID()}`,
      limit: 5,
      leaseSeconds: 60,
      lane: "service",
      capabilities: SERVICE_CAPABILITIES,
    }),
  );
}
export const Route = createFileRoute("/api/admin/whatsapp/service-worker")({
  server: { handlers: { POST: drainServiceJobs } },
});
