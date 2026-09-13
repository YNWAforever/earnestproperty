import "@tanstack/react-start/server-only";
import { queryRows } from "../neon/db.server.ts";
import { runClaimedJobs } from "./jobs.server.ts";
import { SERVICE_CAPABILITIES } from "./job-handlers.server.ts";
export async function runServiceJobs() {
  const [schema] = await queryRows(
    "SELECT to_regclass('whatsapp_service_worker_heartbeats') IS NOT NULL AS available",
  );
  if (!schema?.available) throw new Error("SERVICE_SCHEMA_REQUIRED");
  await queryRows(
    "INSERT INTO whatsapp_service_worker_heartbeats(worker_id,seen_at,capabilities) VALUES('service-v2',now(),$1::jsonb) ON CONFLICT(worker_id) DO UPDATE SET seen_at=EXCLUDED.seen_at,capabilities=EXCLUDED.capabilities",
    [JSON.stringify(SERVICE_CAPABILITIES)],
  );
  return await runClaimedJobs({
    workerId: `service:${crypto.randomUUID()}`,
    limit: 20,
    leaseSeconds: 60,
    lane: "service",
    capabilities: SERVICE_CAPABILITIES,
  });
}
