import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";

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

const { createR2Reporter } = await import("../../src/lib/mls/r2-reporting.mjs");
const { createEvidenceReporter } = await import("./sync.mjs");

test("accepts evidence finalized by the runtime reporters", async () => {
  const attemptId = "scheduled:production:2026-08-23";
  const runId = "00000000-0000-4000-8000-000000000001";
  const workflowId = "workflow-20260823-01";
  const deploymentId = "deployment-20260823-01";
  const objectWrites = [];
  const evidenceReporter = createEvidenceReporter({
    configuration: {
      evidenceBackend: "r2",
      evidence: {},
      environment: "production",
      scheduledFor: "2026-08-23",
      attemptId,
      mode: "shadow",
      commitSha: "a".repeat(40),
      containerDeploymentId: deploymentId,
      workflowInstanceId: workflowId,
      containerId: "container-20260823-01",
      attemptStartedAt: "2026-08-23T01:00:00.000Z",
    },
    dependencies: {
      createFilesystemReporter: () => {
        throw new Error("filesystem reporter must not be used");
      },
      createR2S3ObjectStore: () => ({
        putIfAbsent: async (input) => objectWrites.push(input),
      }),
      createR2Reporter,
      pruneArtifacts: async () => {
        throw new Error("R2 evidence must not be pruned locally");
      },
    },
  });
  const artifactResult = await evidenceReporter.reporter.writeRunArtifacts({
    runId,
    scheduledFor: "2026-08-23",
    mode: "shadow",
    status: "shadow_healthy",
    counts: {},
    proposals: [],
    observations: [],
    quarantines: [],
  });
  await evidenceReporter.finalize({
    outcome: { runId, status: "shadow_healthy" },
    exitCode: 0,
    completedAt: "2026-08-23T01:02:00.000Z",
  });
  const evidencePrefix = artifactResult.prefix;
  const manifestWrite = objectWrites.find(({ key }) => key === `${evidencePrefix}/manifest.json`);
  assert.ok(manifestWrite);
  const manifest = JSON.parse(manifestWrite.body);
  assert.equal(manifest.status, "shadow_healthy");
  assert.equal(manifest.terminalClassification, "healthy");
  const objects = artifactResult.objects;
  const objectKeys = objectWrites.map(({ key }) => key);
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
