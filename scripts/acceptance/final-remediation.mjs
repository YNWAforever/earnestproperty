import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PERFORMANCE_CASES = Object.freeze([
  { caseId: "batch_preview_1", fixtureId: "links_1", rows: 1 },
  { caseId: "batch_preview_50", fixtureId: "links_50", rows: 50 },
  { caseId: "batch_preview_300", fixtureId: "links_300", rows: 300 },
  { caseId: "batch_preview_1000", fixtureId: "links_1000", rows: 1000, targetP95Ms: 5000 },
  { caseId: "batch_commit_50", fixtureId: "links_50", rows: 50, targetP95Ms: 3000 },
  { caseId: "batch_sources_20x3", fixtureId: "links_20_each_source", rows: 60 },
  { caseId: "batch_duplicate", fixtureId: "links_duplicate", rows: 50 },
  { caseId: "batch_expired", fixtureId: "links_expired", rows: 50 },
  { caseId: "batch_revoked", fixtureId: "links_revoked", rows: 50 },
  { caseId: "batch_disconnect", fixtureId: "links_disconnect", rows: 50 },
  { caseId: "report_90d_10k", fixtureId: "events_10000", rows: 10000, targetP95Ms: 2000 },
  { caseId: "report_90d_100k", fixtureId: "events_100000", rows: 100000, targetP95Ms: 2000 },
  { caseId: "mobile_public_lcp_cls", fixtureId: "public_mobile", rows: null },
]);

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.max(0, rank)];
}
export function summarizeSamples(samples) {
  if (
    !Array.isArray(samples) ||
    samples.length < 20 ||
    samples.some((value) => !Number.isFinite(value) || value < 0)
  )
    throw new TypeError("At least 20 finite nonnegative warm samples are required");
  return {
    count: samples.length,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
  };
}
export function evaluateCase(spec, measurement, context) {
  const base = {
    sha: context.sha,
    target: context.target,
    fixtureId: spec.fixtureId,
    caseId: spec.caseId,
    durationMs: null,
    passed: false,
    skipped: true,
    reason: context.reason ?? "isolated target and owned fixture evidence unavailable",
    evidencePath: context.evidencePath ?? null,
  };
  if (!context.targetVerified || !measurement) return base;
  if (measurement.fixtureId !== spec.fixtureId || measurement.caseId !== spec.caseId)
    throw new TypeError("Measurement case or fixture mismatch");
  if (
    measurement.branchId !== context.branchId ||
    measurement.databaseName !== context.databaseName
  )
    throw new TypeError("Measurement target differs from verified disposable database");
  if (spec.rows !== null && measurement.rows !== spec.rows)
    throw new TypeError("Measurement row count differs from fixture");
  const baseline = summarizeSamples(measurement.baseline?.warmMs);
  const revised = summarizeSamples(measurement.revised?.warmMs);
  for (const phase of [measurement.baseline, measurement.revised]) {
    if (!Number.isFinite(phase?.coldMs) || phase.coldMs < 0)
      throw new TypeError("Cold sample is required");
    if (!Number.isSafeInteger(phase.errors) || phase.errors < 0)
      throw new TypeError("Error count is required");
    if (spec.rows !== null && (!phase.sqlPlan || typeof phase.sqlPlan !== "string"))
      throw new TypeError("SQL plan evidence is required");
  }
  if (
    spec.caseId === "mobile_public_lcp_cls" &&
    (!Number.isFinite(measurement.revised.lcpMs) || !Number.isFinite(measurement.revised.cls))
  )
    throw new TypeError("Mobile LCP and CLS laboratory values are required");
  const errors = measurement.baseline.errors + measurement.revised.errors;
  const targetMet = spec.targetP95Ms === undefined || revised.p95Ms <= spec.targetP95Ms;
  return {
    ...base,
    skipped: false,
    passed:
      errors === 0 &&
      targetMet &&
      (spec.caseId !== "mobile_public_lcp_cls" ||
        (measurement.revised.lcpMs <= 2500 && measurement.revised.cls <= 0.1)),
    reason: errors
      ? "sample errors"
      : !targetMet
        ? "revised p95 exceeds target"
        : spec.caseId === "mobile_public_lcp_cls" &&
            (measurement.revised.lcpMs > 2500 || measurement.revised.cls > 0.1)
          ? "mobile laboratory target exceeded"
          : null,
    durationMs: measurement.revised.coldMs + measurement.revised.warmMs.reduce((a, b) => a + b, 0),
    rows: measurement.rows,
    targetP95Ms: spec.targetP95Ms ?? null,
    baseline: {
      coldMs: measurement.baseline.coldMs,
      ...baseline,
      errors: measurement.baseline.errors,
      sqlPlan: measurement.baseline.sqlPlan ?? null,
    },
    revised: {
      coldMs: measurement.revised.coldMs,
      ...revised,
      errors: measurement.revised.errors,
      sqlPlan: measurement.revised.sqlPlan ?? null,
      lcpMs: measurement.revised.lcpMs ?? null,
      cls: measurement.revised.cls ?? null,
    },
  };
}
function parseArgs(argv) {
  const value = (name) => argv.find((item) => item.startsWith(name + "="))?.slice(name.length + 1);
  if (argv.some((item) => !item.startsWith("--output=") && !item.startsWith("--evidence=")))
    throw new TypeError("Only --output and --evidence are supported");
  const output = value("--output") ?? "docs/reports/final-remediation-results.json";
  const evidence = value("--evidence") ?? null;
  for (const filename of [output, evidence].filter(Boolean)) {
    if (path.isAbsolute(filename) || filename.split(/[\\/]/).includes(".."))
      throw new TypeError("Evidence paths must stay within the workspace");
  }
  return { output, evidence };
}
async function verifyEvidenceTarget(payload) {
  const url = process.env.TEST_DATABASE_URL;
  const fixtureOwner = process.env.FINAL_REMEDIATION_FIXTURE_OWNER;
  if (!url || !fixtureOwner)
    throw new Error("TEST_DATABASE_URL and FINAL_REMEDIATION_FIXTURE_OWNER are required");
  const { assertDisposableNeonTestTarget } =
    await import("../../src/lib/neon/disposable-test-target.mjs");
  const identity = await assertDisposableNeonTestTarget(url);
  if (payload.branchId !== identity.branch_id || payload.databaseName !== identity.database_name)
    throw new TypeError("Evidence target identity mismatch");
  const { neon } = await import("@neondatabase/serverless");
  const query = neon(url);
  const rows = await query.query(
    "SELECT fixture_id, owner_label FROM acceptance_fixture_registry WHERE owner_label=$1",
    [fixtureOwner],
  );
  const owned = new Set(rows.map((row) => row.fixture_id));
  for (const spec of PERFORMANCE_CASES) {
    if (!owned.has(spec.fixtureId)) throw new Error("Missing owned fixture: " + spec.fixtureId);
  }
  return identity;
}
async function main() {
  const { output, evidence } = parseArgs(process.argv.slice(2));
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  let context = {
    sha,
    target: "unconfigured",
    targetVerified: false,
    reason: "No disposable staging target, owned fixtures or measurement evidence supplied",
  };
  let measurements = [];
  if (evidence) {
    const payload = JSON.parse(await readFile(evidence, "utf8"));
    const identity = await verifyEvidenceTarget(payload);
    context = {
      sha,
      target: identity.database_name,
      targetVerified: true,
      branchId: identity.branch_id,
      databaseName: identity.database_name,
      evidencePath: evidence,
    };
    if (!Array.isArray(payload.measurements)) throw new TypeError("Measurements array is required");
    measurements = payload.measurements;
  }
  const records = PERFORMANCE_CASES.map((spec) =>
    evaluateCase(
      spec,
      measurements.find((item) => item.caseId === spec.caseId),
      context,
    ),
  );
  const result = { sha, generatedAt: new Date().toISOString(), records };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(
    JSON.stringify({
      output,
      passed: records.filter((item) => item.passed).length,
      failed: records.filter((item) => !item.passed && !item.skipped).length,
      skipped: records.filter((item) => item.skipped).length,
    }) + "\n",
  );
  if (records.some((item) => !item.passed && !item.skipped)) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await main();
