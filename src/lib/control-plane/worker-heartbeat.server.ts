import "@tanstack/react-start/server-only";
import { queryRows } from "../neon/db.server.ts";

/**
 * One row per job lane. A row means "the scheduled worker reached an
 * authenticated drain route", so only those routes call this. The local
 * post-commit fallback must not, or a dead cron worker would look alive
 * (FX-07 Review Focus 4).
 */
export type WorkerHeartbeatId = "service-v2" | "general-v1";

/** Returns false when the heartbeat table is missing; never throws for that. */
export async function recordWorkerHeartbeat(
  id: WorkerHeartbeatId,
  capabilities: readonly string[],
  query: typeof queryRows = queryRows,
): Promise<boolean> {
  const [schema] = await query<{ available: unknown }>(
    "SELECT to_regclass('whatsapp_service_worker_heartbeats') IS NOT NULL AS available",
  );
  if (!schema?.available) return false;
  await query(
    `INSERT INTO whatsapp_service_worker_heartbeats(worker_id,seen_at,capabilities)
     VALUES($1,now(),$2::jsonb)
     ON CONFLICT(worker_id) DO UPDATE SET seen_at=EXCLUDED.seen_at,capabilities=EXCLUDED.capabilities`,
    [id, JSON.stringify(capabilities)],
  );
  return true;
}
