import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
const path = new URL("./sync-run-contract.mjs", import.meta.url);
async function module() {
  assert.ok(existsSync(path), "sync run contract missing");
  return import(path.href);
}
const now = Date.parse("2026-10-01T12:00:00Z");
test("health distinguishes never connected, thirty hour stale, blocked and unknown", async () => {
  const m = await module();
  assert.equal(m.deriveSyncHealth({ enabled: false }, now), "never_synced");
  assert.equal(
    m.deriveSyncHealth(
      { lastAcceptedFullAt: "2026-09-30T05:59:59Z", stages: { collection: { status: "running" } } },
      now,
    ),
    "stale",
  );
  assert.equal(
    m.deriveSyncHealth(
      { lastAcceptedFullAt: "2026-10-01T01:00:00Z", stages: { collection: { status: "blocked" } } },
      now,
    ),
    "blocked",
  );
  assert.equal(
    m.deriveSyncHealth({ stages: { ingestion: { status: "unknown" } } }, now),
    "unknown",
  );
  assert.equal(m.deriveSyncHealth({ readFailed: true }, now), "unknown");
});
test("terminal stage cannot regress, receipt and actual writes are mandatory", async () => {
  const m = await module();
  assert.throws(
    () => m.transitionStage({ status: "succeeded" }, { status: "running" }),
    /terminal/,
  );
  assert.throws(
    () => m.transitionStage({ status: "pending" }, { status: "succeeded", stage: "ingestion" }),
    /receipt/,
  );
  assert.throws(
    () => m.validateRunSummary({ dryRun: true, counts: { canonicalCreated: 1 } }),
    /dry_run/,
  );
  assert.equal(
    m.transitionStage({ status: "running" }, { status: "failed", errorCode: "blocked" }).status,
    "failed",
  );
});

test("duplicate terminal events cannot replace a committed receipt", () => {
  return import(path.href).then((m) =>
    assert.throws(
      () =>
        m.transitionStage(
          { status: "succeeded", receiptId: "one" },
          { status: "succeeded", receiptId: "two" },
        ),
      /terminal/,
    ),
  );
});
