import test from "node:test";
import assert from "node:assert/strict";
import { executionSummary } from "./record-sync-execution.mjs";
import { validateRunSummary } from "../../src/lib/mls/sync-run-contract.mjs";
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

test("native stage clocks are independent of recording time and old receipt acceptance", () => {
  const needs = {};
  const stages = {
    collect: "collection",
    ingest: "ingestion",
    publish: "publication",
    verify: "verification",
  };
  needs.preflight = {
    result: "success",
    outputs: { started_at: "2026-10-06T20:17:00.000Z", finished_at: "2026-10-06T20:18:00.000Z" },
  };
  for (const [index, job] of Object.keys(stages).entries()) {
    needs[job] = {
      result: "success",
      outputs: {
        started_at: `2026-10-06T20:${20 + index * 2}:00.000Z`,
        finished_at: `2026-10-06T20:${21 + index * 2}:00.000Z`,
        public_verified: "true",
      },
    };
  }
  const summary = executionSummary({
    ...base,
    needs,
    publication: { published: [] },
    receipt: { id: "old-receipt", accepted_at: "2026-10-05T20:00:00.000Z" },
  });
  assert.equal(summary.startedAt, needs.preflight.outputs.started_at);
  for (const [job, stage] of Object.entries(stages)) {
    assert.equal(summary.stages[stage].startedAt, needs[job].outputs.started_at);
    assert.equal(summary.stages[stage].finishedAt, needs[job].outputs.finished_at);
  }
  assert.equal(summary.stages.ingestion.receiptId, "old-receipt");
  assert.equal(summary.stages.ingestion.reconciled, true);
  assert.doesNotThrow(() => validateRunSummary(summary));
});

test("a skipped stage cannot supply the execution start from stale outputs", () => {
  const summary = executionSummary({
    ...base,
    needs: {
      preflight: { result: "success", outputs: { started_at: "2026-10-06T20:17:00.000Z" } },
      collect: { result: "skipped", outputs: { started_at: "2026-10-05T20:17:00.000Z" } },
    },
  });
  assert.equal(summary.startedAt, "2026-10-06T20:17:00.000Z");
  assert.equal(summary.stages.collection.status, "pending");
  assert.equal(summary.stages.collection.startedAt, undefined);
});

test("absent or skipped timing stays unknown rather than acquiring a recording timestamp", () => {
  const summary = executionSummary(base);
  assert.equal(summary.startedAt, undefined);
  for (const stage of Object.values(summary.stages)) {
    assert.equal(stage.startedAt, undefined);
    assert.equal(stage.finishedAt, undefined);
  }
});

test("invalid or backwards native clocks are rejected before execution metadata can be saved", () => {
  for (const outputs of [
    { started_at: "invalid", finished_at: "2026-10-07T20:21:00.000Z" },
    { started_at: "2026-10-07T20:22:00.000Z", finished_at: "2026-10-07T20:21:00.000Z" },
    { finished_at: "2026-10-07T20:21:00.000Z" },
  ]) {
    assert.throws(
      () => executionSummary({ ...base, needs: { collect: { result: "success", outputs } } }),
      /INVALID_EXECUTION_TIMING/,
    );
  }
});
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

test("executed stages retain measured clocks when their business proof is missing", () => {
  const outputs = {
    started_at: "2026-10-06T20:20:00.000Z",
    finished_at: "2026-10-06T20:21:00.000Z",
  };
  for (const mode of [undefined, "shadow", "replay-shadow"]) {
    const summary = executionSummary({
      ...base,
      mode,
      needs: { ingest: { result: "success", outputs } },
    });
    assert.equal(summary.stages.ingestion.startedAt, outputs.started_at);
    assert.equal(summary.stages.ingestion.finishedAt, outputs.finished_at);
    assert.equal(summary.stages.ingestion.status, mode ? "blocked" : "unknown");
  }
  for (const publication of [undefined, { unknown: [{ propertyId: "synthetic" }] }]) {
    const summary = executionSummary({
      ...base,
      publication,
      needs: { publish: { result: "success", outputs }, verify: { result: "success", outputs } },
    });
    assert.equal(summary.stages.publication.status, "unknown");
    assert.equal(summary.stages.publication.startedAt, outputs.started_at);
    assert.equal(summary.stages.publication.finishedAt, outputs.finished_at);
    assert.equal(summary.stages.verification.status, "pending");
    assert.equal(summary.stages.verification.startedAt, undefined);
    assert.equal(summary.stages.verification.finishedAt, undefined);
  }
  const verification = executionSummary({
    ...base,
    publication: { published: [] },
    needs: { publish: { result: "success", outputs }, verify: { result: "success", outputs } },
  });
  assert.equal(verification.stages.verification.status, "unknown");
  assert.equal(verification.stages.verification.startedAt, outputs.started_at);
  assert.equal(verification.stages.verification.finishedAt, outputs.finished_at);
});

test("clock validation refuses impossible calendar dates while accepting leap days and offsets", () => {
  for (const value of [
    "2026-02-30T20:20:00Z",
    "2026-02-29T20:20:00Z",
    "2026-04-31T20:20:00Z",
    "2026-10-07T24:00:00Z",
  ]) {
    assert.throws(() => validateRunSummary({ startedAt: value }), /invalid_execution_timing/);
    assert.throws(
      () => validateRunSummary({ stages: { collection: { finishedAt: value } } }),
      /invalid_execution_timing/,
    );
  }
  for (const value of [
    "2028-02-29T20:20:00Z",
    "2000-02-29T20:20:00.123+08:00",
    "2026-10-07T00:00:00-08:00",
  ]) {
    assert.doesNotThrow(() => validateRunSummary({ startedAt: value }));
  }
});
