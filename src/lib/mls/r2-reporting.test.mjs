import assert from "node:assert/strict";
import { test } from "node:test";
import { S3Client } from "@aws-sdk/client-s3";

import {
  buildEvidencePrefix,
  createR2Reporter,
  createR2S3ObjectStore,
} from "./r2-reporting.mjs";

const context = Object.freeze({
  environment: "production",
  hkDate: "2026-08-21",
  attemptId: "scheduled:production:2026-08-21",
  mode: "shadow",
  commitSha: "a".repeat(40),
  containerDeploymentId: "deployment-1",
  workflowInstanceId: "workflow-1",
  containerId: "scheduled:production:2026-08-21",
});

function runFixture() {
  return {
    runId: "00000000-0000-4000-8000-000000000001",
    scheduledFor: "2026-08-21",
    mode: "shadow",
    status: "shadow_healthy",
    counts: {},
    proposals: [],
    observations: [],
    quarantines: [],
    diagnostics: [],
  };
}

function terminalInput(artifactObjects, overrides = {}) {
  return {
    runId: runFixture().runId,
    status: "shadow_healthy",
    terminalClassification: "shadow_healthy",
    exitCode: 0,
    startedAt: "2026-08-21T02:00:00.000Z",
    completedAt: "2026-08-21T02:30:00.000Z",
    durationMs: 1_800_000,
    neonRunId: "00000000-0000-4000-8000-000000000002",
    artifactObjects,
    ...overrides,
  };
}

function memoryObjectStore({ failOnKey, rejectCollisions = false } = {}) {
  const writes = [];
  const keys = new Set();
  return {
    writes,
    async putIfAbsent(object) {
      writes.push(object);
      if (object.key === failOnKey)
        throw new Error("simulated artifact failure");
      if (rejectCollisions && keys.has(object.key)) {
        const error = new Error("PreconditionFailed");
        error.statusCode = 412;
        throw error;
      }
      keys.add(object.key);
    },
  };
}

test("buildEvidencePrefix permits one valid safe prefix and rejects malformed segments", () => {
  assert.equal(
    buildEvidencePrefix({ ...context, runId: runFixture().runId }),
    "mls-sync/production/2026-08-21/00000000-0000-4000-8000-000000000001/scheduled-production-2026-08-21",
  );
  assert.throws(
    () =>
      buildEvidencePrefix({
        ...context,
        hkDate: "2026-02-30",
        runId: runFixture().runId,
      }),
    /HK date/i,
  );
  assert.throws(
    () => buildEvidencePrefix({ ...context, runId: "../escape" }),
    /runId/i,
  );
  assert.throws(
    () =>
      buildEvidencePrefix({
        ...context,
        runId: runFixture().runId,
        attemptId: "attempt/path",
      }),
    /attemptId/i,
  );
});

test("R2 provenance accepts only Task1 modes, attempts, and canonical UUID identities", async () => {
  const objectStore = memoryObjectStore();
  assert.throws(
    () =>
      createR2Reporter({
        objectStore,
        context: { ...context, mode: "emergency" },
      }),
    /mode/i,
  );
  assert.throws(
    () =>
      createR2Reporter({
        objectStore,
        context: { ...context, attemptId: "scheduled:preview:2026-08-21" },
      }),
    /attemptId/i,
  );
  assert.throws(
    () =>
      buildEvidencePrefix({
        ...context,
        runId: runFixture().runId,
        attemptId: "scheduled-production-2026-08-21",
      }),
    /attemptId/i,
  );
  assert.throws(
    () => buildEvidencePrefix({ ...context, runId: "run-1" }),
    /runId/i,
  );

  const mutableContext = { ...context };
  const reporter = createR2Reporter({ objectStore, context: mutableContext });
  mutableContext.mode = "publish";
  mutableContext.attemptId =
    "scheduled:production:2026-08-21:manual:operator-1234567";
  const artifacts = await reporter.writeRunArtifacts(runFixture());
  assert.match(artifacts.prefix, /\/scheduled-production-2026-08-21$/);

  await assert.rejects(
    () =>
      reporter.finalizeTerminal(
        terminalInput(artifacts.objects, { neonRunId: null }),
      ),
    /neonRunId/i,
  );
  assert.equal(objectStore.writes.length, 4);

  const accessorContext = { ...context };
  Object.defineProperty(accessorContext, "attemptId", {
    enumerable: true,
    get() {
      throw new Error("attempt accessor must not run");
    },
  });
  assert.throws(
    () => createR2Reporter({ objectStore, context: accessorContext }),
    /plain|data/i,
  );
});

test("R2 S3 adapter configures one immutable conditional UTF-8 PutObject without network access", async () => {
  const accountId = "a".repeat(32);
  const credentials = {
    accessKeyId: "access-key",
    secretAccessKey: "secret-key",
  };
  let factoryConfig;
  let sentCommand;
  let fallbackCommand;
  const originalSend = S3Client.prototype.send;
  S3Client.prototype.send = async function sendWithoutNetwork(command) {
    fallbackCommand = command;
  };
  try {
    const objectStore = createR2S3ObjectStore(
      { accountId, bucket: "mls-evidence", ...credentials },
      {
        createClient(config) {
          factoryConfig = config;
          return {
            async send(command) {
              sentCommand = command;
            },
          };
        },
      },
    );
    const metadata = { sha256: "a".repeat(64) };
    await objectStore.putIfAbsent({
      key: "mls-sync/production/2026-08-21/run/report.json",
      body: "測試",
      contentType: "application/json; charset=utf-8",
      metadata,
    });

    assert.deepEqual(factoryConfig, {
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials,
    });
    assert.deepEqual(sentCommand.input, {
      Bucket: "mls-evidence",
      Key: "mls-sync/production/2026-08-21/run/report.json",
      Body: "測試",
      ContentLength: Buffer.byteLength("測試"),
      ContentType: "application/json; charset=utf-8",
      Metadata: metadata,
      IfNoneMatch: "*",
    });
    assert.equal(fallbackCommand, undefined);
    assert.deepEqual(Object.keys(objectStore), ["putIfAbsent"]);
    assert.equal(typeof objectStore.delete, "undefined");
  } finally {
    S3Client.prototype.send = originalSend;
  }
});

test("writeRunArtifacts writes exactly four immutable artifacts and no manifest", async () => {
  const objectStore = memoryObjectStore();
  const reporter = createR2Reporter({ objectStore, context });

  const result = await reporter.writeRunArtifacts(runFixture());

  assert.equal(objectStore.writes.length, 4);
  assert.ok(
    objectStore.writes.every((write) => !write.key.endsWith("manifest.json")),
  );
  assert.ok(objectStore.writes.every((write) => write.ifNoneMatch === "*"));
  assert.equal(result.objects.length, 4);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.objects));
  assert.ok(result.objects.every(Object.isFrozen));
  assert.throws(() => {
    result.objects[0].sha256 = "b".repeat(64);
  }, /read only|Cannot assign/i);
});

test("finalizeTerminal writes one complete manifest after all artifact objects", async () => {
  const objectStore = memoryObjectStore();
  const reporter = createR2Reporter({ objectStore, context });
  const artifacts = await reporter.writeRunArtifacts(runFixture());

  const result = await reporter.finalizeTerminal(
    terminalInput(artifacts.objects),
  );

  assert.equal(objectStore.writes.length, 5);
  assert.match(objectStore.writes.at(-1).key, /manifest\.json$/);
  assert.equal(result.manifestKey, objectStore.writes.at(-1).key);
  const manifest = JSON.parse(objectStore.writes.at(-1).body);
  assert.deepEqual(
    manifest.artifacts,
    artifacts.objects.map(({ key, ...artifact }) => artifact),
  );
  assert.equal(manifest.environment, context.environment);
  assert.equal(manifest.hkDate, context.hkDate);
  assert.equal(manifest.attemptId, context.attemptId);
  assert.equal(manifest.mode, context.mode);
  assert.equal(manifest.commitSha, context.commitSha);
  assert.equal(manifest.containerDeploymentId, context.containerDeploymentId);
  assert.equal(manifest.workflowInstanceId, context.workflowInstanceId);
  assert.equal(manifest.containerId, context.containerId);
  assert.equal(manifest.neonRunId, "00000000-0000-4000-8000-000000000002");
  assert.equal(manifest.terminalClassification, "shadow_healthy");
  assert.equal(manifest.exitCode, 0);
});

test("artifact failure and key collision never add a manifest", async () => {
  const prefix = buildEvidencePrefix({ ...context, runId: runFixture().runId });
  const failedStore = memoryObjectStore({
    failOnKey: `${prefix}/observations.csv`,
  });
  const failedReporter = createR2Reporter({
    objectStore: failedStore,
    context,
  });
  await assert.rejects(
    () => failedReporter.writeRunArtifacts(runFixture()),
    /simulated artifact failure/,
  );
  assert.ok(
    failedStore.writes.every((write) => !write.key.endsWith("manifest.json")),
  );

  const collisionStore = memoryObjectStore({ rejectCollisions: true });
  const collisionReporter = createR2Reporter({
    objectStore: collisionStore,
    context,
  });
  const artifacts = await collisionReporter.writeRunArtifacts(runFixture());
  await collisionReporter.finalizeTerminal(terminalInput(artifacts.objects));
  await assert.rejects(
    () => collisionReporter.writeRunArtifacts(runFixture()),
    /PreconditionFailed/,
  );
  assert.equal(
    collisionStore.writes.filter((write) => write.key.endsWith("manifest.json"))
      .length,
    1,
  );
});

test("finalizeTerminal requires the complete successful artifact metadata for its run", async () => {
  const objectStore = memoryObjectStore();
  const reporter = createR2Reporter({ objectStore, context });
  const unrecordedArtifacts = [
    {
      name: "report.json",
      key: "mls-sync/production/2026-08-21/run/attempt/report.json",
      byteLength: 1,
      contentType: "application/json; charset=utf-8",
      sha256: "a".repeat(64),
    },
  ];

  await assert.rejects(
    () => reporter.finalizeTerminal(terminalInput(unrecordedArtifacts)),
    /artifact/i,
  );
  assert.equal(objectStore.writes.length, 0);
});

test("finalizeTerminal rejects a duration that contradicts its timestamps before writing a manifest", async () => {
  const objectStore = memoryObjectStore();
  const reporter = createR2Reporter({ objectStore, context });
  const artifacts = await reporter.writeRunArtifacts(runFixture());

  await assert.rejects(
    () =>
      reporter.finalizeTerminal(
        terminalInput(artifacts.objects, { durationMs: 1 }),
      ),
    /durationMs/i,
  );
  assert.equal(objectStore.writes.length, 4);
  assert.ok(
    objectStore.writes.every((write) => !write.key.endsWith("manifest.json")),
  );
});

test("finalizeTerminal rejects missing, malformed, accessor, and extra terminal fields before writing", async () => {
  const objectStore = memoryObjectStore();
  const reporter = createR2Reporter({ objectStore, context });
  const artifacts = await reporter.writeRunArtifacts(runFixture());
  const beforeFinalization = objectStore.writes.length;

  await assert.rejects(
    () =>
      reporter.finalizeTerminal(
        terminalInput(artifacts.objects, { terminalClassification: "" }),
      ),
    /terminalClassification/i,
  );
  await assert.rejects(
    () =>
      reporter.finalizeTerminal(
        terminalInput(artifacts.objects, {
          terminalClassification: "Unexpected-Outcome",
        }),
      ),
    /terminalClassification/i,
  );
  await assert.rejects(
    () =>
      reporter.finalizeTerminal({
        ...terminalInput(artifacts.objects),
        unexpected: true,
      }),
    /exactly|unexpected/i,
  );
  const accessorInput = terminalInput(artifacts.objects);
  Object.defineProperty(accessorInput, "terminalClassification", {
    enumerable: true,
    get() {
      throw new Error("accessor must not run");
    },
  });
  await assert.rejects(
    () => reporter.finalizeTerminal(accessorInput),
    /plain|accessor/i,
  );
  assert.equal(objectStore.writes.length, beforeFinalization);
  assert.ok(
    objectStore.writes.every((write) => !write.key.endsWith("manifest.json")),
  );
});
