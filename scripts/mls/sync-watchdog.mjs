import { pathToFileURL } from "node:url";
import { readSyncAuthority } from "./read-sync-authority.mjs";
import { deriveSyncHealth } from "../../src/lib/mls/sync-run-contract.mjs";
export function syncWatchdogReport(authority, { env = process.env, now = Date.now() } = {}) {
  const incrementalEnabled = env.PROPERTY_SYNC_28HSE_INCREMENTAL_ENABLED === "true";
  const rawHours = env.PROPERTY_SYNC_28HSE_INCREMENTAL_STALE_HOURS;
  const incrementalStaleHours = rawHours === undefined || rawHours === "" ? 30 : Number(rawHours);
  return {
    source: "28hse",
    health: deriveSyncHealth(
      {
        lastAcceptedFullAt: authority.accepted_at,
        lastAcceptedIncrementalAt: authority.last_incremental_accepted_at,
        incrementalEnabled,
        incrementalStaleHours,
      },
      now,
    ),
    incrementalEnabled,
    freshnessBasis: incrementalEnabled ? "accepted_incremental" : "accepted_full",
    staleAfterHours: incrementalEnabled ? incrementalStaleHours : 30,
    lastAcceptedFullAt: authority.accepted_at ?? null,
    lastAcceptedIncrementalAt: authority.last_incremental_accepted_at ?? null,
    incrementalReceiptId: authority.incremental_receipt_id ?? null,
    incrementalSummary: authority.incremental_summary ?? null,
    advertisements: authority.full_count,
    checkedAt: new Date(now).toISOString(),
    message: incrementalEnabled
      ? "增量同步健康按最近 accepted incremental ingestion 判斷；全量基準另列。"
      : "30 小時無 accepted full ingestion 顯示過期；保留現有資料。",
  };
}
export async function runSyncWatchdog({
  env = process.env,
  readAuthority = readSyncAuthority,
  now,
} = {}) {
  return syncWatchdogReport(await readAuthority({ env }), { env, now });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await runSyncWatchdog();
    console.log(JSON.stringify(report));
    if (report.health !== "healthy") process.exitCode = 1;
  } catch {
    console.error("SYNC_HEALTH_UNKNOWN");
    process.exitCode = 1;
  }
}
