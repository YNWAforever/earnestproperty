import assert from "node:assert/strict";
import test from "node:test";
import { PERFORMANCE_CASES, evaluateCase, summarizeSamples } from "./final-remediation.mjs";

const context = {
  sha: "abc123",
  target: "earnest_audit_acceptance_20260928",
  targetVerified: true,
  branchId: "br-disposable-test",
  databaseName: "earnest_audit_acceptance_20260928",
};
function sample(caseId = "batch_preview_1000", ms = 4000) {
  return {
    caseId,
    fixtureId: "links_1000",
    branchId: context.branchId,
    databaseName: context.databaseName,
    rows: 1000,
    baseline: {
      coldMs: 7000,
      warmMs: Array(20).fill(6000),
      errors: 0,
      sqlPlan: "Index Scan baseline",
    },
    revised: { coldMs: 5000, warmMs: Array(20).fill(ms), errors: 0, sqlPlan: "Index Scan revised" },
  };
}
test("performance matrix includes bounded batches, sources, edge states and event scales", () => {
  assert.deepEqual(
    PERFORMANCE_CASES.filter((item) => item.caseId.startsWith("batch_preview")).map(
      (item) => item.rows,
    ),
    [1, 50, 300, 1000],
  );
  for (const id of [
    "batch_sources_20x3",
    "batch_duplicate",
    "batch_expired",
    "batch_revoked",
    "batch_disconnect",
    "report_90d_10k",
    "report_90d_100k",
    "mobile_public_lcp_cls",
  ])
    assert.ok(PERFORMANCE_CASES.some((item) => item.caseId === id));
});
test("missing isolated target is skipped, never passed", () => {
  const result = evaluateCase(PERFORMANCE_CASES[3], sample(), {
    sha: context.sha,
    target: "unconfigured",
    targetVerified: false,
  });
  assert.equal(result.passed, false);
  assert.equal(result.skipped, true);
  assert.equal(result.durationMs, null);
});
test("paired cold and 20 warm samples yield p50/p95 and enforce targets", () => {
  const spec = PERFORMANCE_CASES[3];
  const pass = evaluateCase(spec, sample(), context);
  assert.equal(pass.skipped, false);
  assert.equal(pass.passed, true);
  assert.equal(pass.baseline.p95Ms, 6000);
  assert.equal(pass.revised.p95Ms, 4000);
  assert.equal(evaluateCase(spec, sample(spec.caseId, 5100), context).passed, false);
  assert.equal(summarizeSamples([...Array(19).fill(1), 20]).p95Ms, 1);
});
test("fixture, database, samples and plan must match verified evidence", () => {
  const spec = PERFORMANCE_CASES[3];
  assert.throws(() => evaluateCase(spec, { ...sample(), rows: 999 }, context), /row count/);
  assert.throws(() => evaluateCase(spec, { ...sample(), branchId: "br-other" }, context), /target/);
  assert.throws(
    () =>
      evaluateCase(spec, { ...sample(), revised: { ...sample().revised, warmMs: [1] } }, context),
    /20/,
  );
  assert.throws(
    () =>
      evaluateCase(spec, { ...sample(), revised: { ...sample().revised, sqlPlan: "" } }, context),
    /SQL plan/,
  );
});
