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

test("shadow summary-only verification is not a completed public check", () => {
  for (const mode of ["shadow", "replay-shadow"]) {
    const summary = executionSummary({
      ...base,
      mode,
      needs: {
        collect: { result: "success" },
        ingest: { result: "success" },
        publish: { result: "skipped" },
        verify: { result: "success" },
      },
    });
    assert.equal(summary.stages.ingestion.status, "blocked");
    assert.equal(summary.stages.verification.status, "pending");
    assert.equal(summary.stages.verification.errorCode, "PUBLIC_VERIFICATION_NOT_RUN");
    assert.equal(summary.stages.verification.finishedAt, undefined);
  }
});

test("publication failure or unknown outcome cannot gain verification success from a summary job", () => {
  for (const result of ["failure", "cancelled", "skipped"]) {
    const summary = executionSummary({
      ...base,
      needs: {
        publish: { result },
        verify: { result: "success", outputs: { public_verified: "true" } },
      },
    });
    assert.equal(summary.stages.verification.status, "pending");
    assert.equal(summary.stages.verification.finishedAt, undefined);
  }
  const unknown = executionSummary({
    ...base,
    publication: { published: [], unknown: [{ propertyId: "unknown" }] },
    needs: {
      publish: { result: "success" },
      verify: { result: "success", outputs: { public_verified: "true" } },
    },
  });
  assert.equal(unknown.stages.publication.status, "unknown");
  assert.notEqual(unknown.stages.verification.status, "succeeded");
});

test("public verification requires its explicit native output and preserves failed checks", () => {
  const input = {
    ...base,
    publication: { published: [] },
    needs: { publish: { result: "success" }, verify: { result: "success" } },
  };
  for (const value of [undefined, "false", true]) {
    const summary = executionSummary({
      ...input,
      needs: { ...input.needs, verify: { result: "success", outputs: { public_verified: value } } },
    });
    assert.equal(summary.stages.verification.status, "unknown");
    assert.equal(summary.stages.verification.errorCode, "PUBLIC_VERIFICATION_PROOF_REQUIRED");
  }
  const succeeded = executionSummary({
    ...input,
    needs: { ...input.needs, verify: { result: "success", outputs: { public_verified: "true" } } },
  });
  assert.equal(succeeded.stages.verification.status, "succeeded");
  const failed = executionSummary({
    ...input,
    needs: { ...input.needs, verify: { result: "failure", outputs: { public_verified: "true" } } },
  });
  assert.equal(failed.stages.verification.status, "failed");
});
