import { readSyncAuthority } from "./read-sync-authority.mjs";
import { deriveSyncHealth } from "../../src/lib/mls/sync-run-contract.mjs";
try {
  const authority = await readSyncAuthority();
  console.log(
    JSON.stringify({
      source: "28hse",
      health: deriveSyncHealth({ lastAcceptedFullAt: authority.accepted_at }),
      lastAcceptedFullAt: authority.accepted_at,
      advertisements: authority.full_count,
      checkedAt: new Date().toISOString(),
      message: "30 小時無 accepted full ingestion 顯示過期；保留現有資料。",
    }),
  );
} catch {
  console.error("SYNC_HEALTH_UNKNOWN");
  process.exitCode = 1;
}
