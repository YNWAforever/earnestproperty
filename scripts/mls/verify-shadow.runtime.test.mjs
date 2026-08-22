import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";

import { buildRunArtifactObjects } from "../../src/lib/mls/reporting.mjs";
import { verifyShadowEvidence } from "./verify-shadow.mjs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@aws-sdk/client-s3") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export class PutObjectCommand {}; export class S3Client {};",
      };
    }
    return nextResolve(specifier, context);
  },
});

const { buildEvidencePrefix } =
  await import("../../src/lib/mls/r2-reporting.mjs");

test("accepts evidence shaped by the runtime prefix and artifact builders", () => {
  const attemptId = "scheduled:production:2026-08-23";
  const runId = "00000000-0000-4000-8000-000000000001";
  const workflowId = "workflow-20260823-01";
  const deploymentId = "deployment-20260823-01";
  const evidencePrefix = buildEvidencePrefix({
    environment: "production",
    hkDate: "2026-08-23",
    runId,
    attemptId,
  });
  const artifacts = buildRunArtifactObjects({
    runId,
    scheduledFor: "2026-08-23",
    mode: "shadow",
    status: "shadow_healthy",
    counts: {},
    proposals: [],
    observations: [],
    quarantines: [],
  });
  const objects = artifacts.map(
    ({ name, byteLength, contentType, sha256 }) => ({
      name,
      key: `${evidencePrefix}/${name}`,
      byteLength,
      contentType,
      sha256,
    }),
  );
  const manifest = {
    schemaVersion: 1,
    environment: "production",
    hkDate: "2026-08-23",
    attemptId,
    mode: "shadow",
    commitSha: "a".repeat(40),
    containerDeploymentId: deploymentId,
    workflowInstanceId: workflowId,
    containerId: "container-20260823-01",
    runId,
    status: "shadow_healthy",
    terminalClassification: "shadow_healthy",
    exitCode: 0,
    startedAt: "2026-08-23T01:00:00.000Z",
    completedAt: "2026-08-23T01:02:00.000Z",
    durationMs: 120_000,
    neonRunId: runId,
    artifacts: objects.map(({ key: _key, ...artifact }) => artifact),
  };
  const objectKeys = [
    ...objects.map(({ key }) => key),
    `${evidencePrefix}/manifest.json`,
  ];
  const manifestSha256 = createHash("sha256")
    .update(`${JSON.stringify(manifest, null, 2)}\\n`)
    .digest("hex");

  const result = verifyShadowEvidence({
    identity: {
      attemptId,
      workflowId,
      deploymentId,
      commitSha: "a".repeat(40),
      runId,
      evidencePrefix,
    },
    workflow: { attemptId, deploymentId, state: "succeeded" },
    container: { deploymentId, state: "succeeded", exitCode: 0 },
    run: {
      attemptId,
      workflowId,
      deploymentId,
      commitSha: "a".repeat(40),
      runId,
      evidencePrefix,
    },
    sources: {
      configured: ["28hse", "internal"],
      health: { "28hse": "full", internal: "full" },
    },
    neon: { shadow: true, healthy: true, lockReleased: true },
    r2: {
      evidencePrefix,
      manifestPresent: true,
      manifestSha256,
      objectKeys,
      objects,
      manifest,
    },
    statusRoute: {
      attemptId,
      state: "succeeded",
      exitCode: 0,
      manifestPresent: true,
    },
    sideEffects: { blobUploads: 0, publicationAttempts: 0 },
    redaction: { secretsAbsent: true, credentialPatternsAbsent: true },
  });

  assert.deepEqual(result.failures, []);
  assert.equal(result.accepted, true);
});
