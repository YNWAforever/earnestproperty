import "@tanstack/react-start/server-only";
import { queryRows } from "../neon/db.server.ts";
import { runClaimedJobs } from "./jobs.server.ts";
import { SERVICE_CAPABILITIES } from "./job-handlers.server.ts";
export async function runServiceJobs() {
  const { recoverPendingInboundReceipts } =
    await import("../whatsapp-enquiries/inbound-receipts.server.ts");
  await recoverPendingInboundReceipts({ limit: 20 });
  // whatsapp_service_actions ships in the service-workflow migration
  // (20260912150000) with the rest of the service schema. Lane liveness is
  // recorded by the authenticated drain route only, never here: the local
  // post-commit fallback also runs this function (FX-07 Review Focus 4).
  const [schema] = await queryRows(
    "SELECT to_regclass('whatsapp_service_actions') IS NOT NULL AS available",
  );
  if (!schema?.available) throw new Error("SERVICE_SCHEMA_REQUIRED");
  return await runClaimedJobs({
    workerId: `service:${crypto.randomUUID()}`,
    limit: 20,
    leaseSeconds: 60,
    lane: "service",
    capabilities: SERVICE_CAPABILITIES,
  });
}
