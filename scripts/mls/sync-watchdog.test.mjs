import assert from "node:assert/strict";
import test from "node:test";
import { syncWatchdogReport, runSyncWatchdog } from "./sync-watchdog.mjs";
const now = Date.parse("2026-11-10T04:00:00Z");
const authority = {
  accepted_at: "2026-11-01T00:00:00Z",
  full_count: 500,
  last_incremental_accepted_at: "2026-11-10T03:50:00Z",
  incremental_receipt_id: "inc",
  incremental_summary: { candidate_count: 0, fresh_detail_count: 0, index_offer_count: 500 },
};
const enabled = { PROPERTY_SYNC_28HSE_INCREMENTAL_ENABLED: "true" };
test("incremental-enabled health uses separate accepted incremental time and retains full baseline", () => {
  const report = syncWatchdogReport(authority, { env: enabled, now });
  assert.equal(report.health, "healthy");
  assert.equal(report.lastAcceptedFullAt, authority.accepted_at);
  assert.equal(report.lastAcceptedIncrementalAt, authority.last_incremental_accepted_at);
  assert.equal(report.freshnessBasis, "accepted_incremental");
  assert.equal(report.incrementalSummary.fresh_detail_count, 0);
  assert.equal(syncWatchdogReport(authority, { env: {}, now }).health, "stale");
  assert.equal(
    syncWatchdogReport({ ...authority, last_incremental_accepted_at: null }, { env: enabled, now })
      .health,
    "never_synced",
  );
});
test("stale incremental cannot be hidden by a recent full receipt", () => {
  const report = syncWatchdogReport(
    {
      ...authority,
      accepted_at: "2026-11-10T03:59:00Z",
      last_incremental_accepted_at: "2026-11-08T22:00:00Z",
    },
    { env: enabled, now },
  );
  assert.equal(report.health, "stale");
  assert.equal(
    syncWatchdogReport(authority, {
      env: { ...enabled, PROPERTY_SYNC_28HSE_INCREMENTAL_STALE_HOURS: "invalid" },
      now,
    }).health,
    "unknown",
  );
});
test("watchdog does not convert DB read failure to healthy", async () => {
  await assert.rejects(
    () =>
      runSyncWatchdog({
        readAuthority: async () => {
          throw Error("unavailable");
        },
      }),
    /unavailable/,
  );
});
