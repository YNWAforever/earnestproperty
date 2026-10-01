import test from "node:test";
import assert from "node:assert/strict";
import { executionSummary } from "./record-sync-execution.mjs";
const base = {
  workflowRunId: "123",
  gitSha: "a".repeat(40),
  needs: {
    collect: { result: "success" },
    ingest: { result: "failure" },
    publish: { result: "skipped" },
    verify: { result: "skipped" },
  },
};
test("execution callback uses receipt to reconcile lost ingestion outcome and keeps independent stages", () => {
  const unknown = executionSummary(base);
  assert.equal(unknown.stages.ingestion.status, "failed");
  assert.deepEqual(unknown.counts, {});
  const r = executionSummary({
    ...base,
    receipt: {
      id: "receipt",
      accepted_at: new Date().toISOString(),
      response: {
        summary: { advertisement_count: 286, properties_created: 2, properties_changed: 3 },
      },
    },
  });
  assert.equal(r.stages.ingestion.status, "succeeded");
  assert.equal(r.stages.ingestion.reconciled, true);
  assert.equal(r.counts.canonicalCreated, 2);
  assert.equal(r.stages.publication.status, "pending");
});
test("cancelled incomplete evidence and successful job without receipt never become full business success", () => {
  assert.equal(
    executionSummary({ ...base, needs: { collect: { result: "cancelled" } } }).stages.collection
      .status,
    "cancelled",
  );
  const r = executionSummary({
    ...base,
    needs: { ingest: { result: "success" }, publish: { result: "success" } },
  });
  assert.equal(r.stages.ingestion.status, "unknown");
  assert.equal(r.stages.publication.status, "unknown");
});
