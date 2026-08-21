import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MlsConfigurationError,
  createEvidenceReporter,
  main,
  readConfiguration,
  writeTerminalStatusRecord,
} from "./sync.mjs";

function r2Environment(overrides = {}) {
  return {
    DATABASE_URL_UNPOOLED:
      "postgresql://user:password@db.example.test/database",
    MLS_CRAWLER_CONTACT_URL: "https://earnestproperty.com/contact",
    MLS_MEDIA_ALLOWED_HOSTS: "images.example.test",
    MLS_MEDIA_RIGHTS_CONFIRMED: "false",
    MLS_PUBLISH_ENABLED: "false",
    MLS_EVIDENCE_BACKEND: "r2",
    MLS_ENVIRONMENT: "production",
    MLS_SCHEDULED_FOR: "2026-08-21",
    MLS_ATTEMPT_ID: "scheduled:production:2026-08-21",
    MLS_COMMIT_SHA: "a".repeat(40),
    CLOUDFLARE_DEPLOYMENT_ID: "deployment-1",
    MLS_WORKFLOW_INSTANCE_ID: "workflow-1",
    MLS_CONTAINER_ID: "container-1",
    MLS_ATTEMPT_STARTED_AT: "2026-08-21T02:00:00.000Z",
    MLS_TERMINAL_STATUS_FILE: "/tmp/earnest-mls-terminal.json",
    CLOUDFLARE_ACCOUNT_ID: "account-1",
    MLS_EVIDENCE_BUCKET: "earnest-mls-evidence",
    MLS_R2_ACCESS_KEY_ID: "r2-access-key",
    MLS_R2_SECRET_ACCESS_KEY: "r2-secret-key",
    ...overrides,
  };
}

test("reads an exact injected R2 run identity without process environment fallback", () => {
  const configuration = readConfiguration("shadow", r2Environment());

  assert.equal(configuration.evidenceBackend, "r2");
  assert.equal(configuration.scheduledFor, "2026-08-21");
  assert.equal(configuration.attemptId, "scheduled:production:2026-08-21");
  assert.equal(configuration.commitSha, "a".repeat(40));
  assert.equal(configuration.publishEnabled, false);
  assert.deepEqual(configuration.evidence, {
    accountId: "account-1",
    bucket: "earnest-mls-evidence",
    accessKeyId: "r2-access-key",
    secretAccessKey: "r2-secret-key",
  });
});

test("rejects missing R2 credentials by variable code without revealing their value", () => {
  const suppliedSecret = "sensitive-r2-secret";
  assert.throws(
    () =>
      readConfiguration(
        "shadow",
        r2Environment({ MLS_R2_SECRET_ACCESS_KEY: "" }),
      ),
    (error) =>
      error instanceof MlsConfigurationError &&
      error.code === "missing_mls_r2_secret_access_key" &&
      !error.message.includes(suppliedSecret),
  );
});

test("uses explicit local identity only when the evidence backend is absent", () => {
  const environment = r2Environment({
    MLS_EVIDENCE_BACKEND: undefined,
    MLS_ARTIFACT_DIR: "C:/safe/mls",
    MLS_ENVIRONMENT: undefined,
    MLS_SCHEDULED_FOR: undefined,
    MLS_ATTEMPT_ID: undefined,
    MLS_COMMIT_SHA: undefined,
  });
  const configuration = readConfiguration("shadow", environment);

  assert.equal(configuration.evidenceBackend, "filesystem");
  assert.equal(configuration.environment, "local");
  assert.equal(configuration.attemptId, "manual-local");
  assert.equal(configuration.commitSha, "0".repeat(40));
  assert.deepEqual(configuration.evidence, { artifactRoot: "C:/safe/mls" });
});

test("keeps Blob credentials out of shadow configuration and retains publish gates", () => {
  const shadow = readConfiguration(
    "shadow",
    r2Environment({ BLOB_READ_WRITE_TOKEN: undefined }),
  );
  assert.equal(Object.hasOwn(shadow, "blobToken"), false);
  assert.throws(
    () => readConfiguration("publish", r2Environment()),
    (error) =>
      error instanceof MlsConfigurationError &&
      error.code === "publication_disabled",
  );
  assert.throws(
    () =>
      readConfiguration(
        "publish",
        r2Environment({
          MLS_PUBLISH_ENABLED: "true",
          MLS_MEDIA_RIGHTS_CONFIRMED: "true",
        }),
      ),
    (error) =>
      error instanceof MlsConfigurationError &&
      error.code === "missing_blob_read_write_token",
  );
});

test("selects filesystem evidence without constructing R2 and prunes only its configured root", async () => {
  const calls = [];
  const selection = createEvidenceReporter({
    configuration: readConfiguration(
      "shadow",
      r2Environment({
        MLS_EVIDENCE_BACKEND: "filesystem",
        MLS_ARTIFACT_DIR: "C:/safe/mls",
      }),
    ),
    dependencies: {
      createFilesystemReporter: ({ root }) => ({
        root,
        writeRunArtifacts: async () => ({ directory: root }),
      }),
      createR2S3ObjectStore: () => {
        throw new Error("R2 must not be constructed in filesystem mode");
      },
      createR2Reporter: () => {
        throw new Error("R2 must not be constructed in filesystem mode");
      },
      pruneArtifacts: async (input) => calls.push(input),
    },
  });

  await selection.finalize({ exitCode: 0 });
  assert.equal(selection.reporter.root, "C:/safe/mls");
  assert.deepEqual(calls, [{ root: "C:/safe/mls", retentionDays: 90 }]);
});

test("selects R2 without local pruning and passes no Blob credential to the reporter", async () => {
  const calls = [];
  const configuration = readConfiguration("shadow", r2Environment());
  const selection = createEvidenceReporter({
    configuration,
    dependencies: {
      createFilesystemReporter: () => {
        throw new Error("filesystem must not be constructed in R2 mode");
      },
      createR2S3ObjectStore: (evidence) => {
        calls.push({ kind: "store", evidence });
        return { putIfAbsent: async () => {} };
      },
      createR2Reporter: (input) => {
        calls.push({ kind: "reporter", input });
        return { writeRunArtifacts: async () => ({}) };
      },
      pruneArtifacts: async () => {
        throw new Error("R2 evidence must not be pruned locally");
      },
    },
  });

  assert.equal(selection.reporter.writeRunArtifacts instanceof Function, true);
  assert.deepEqual(calls[0], {
    kind: "store",
    evidence: configuration.evidence,
  });
  assert.equal("blobToken" in calls[1].input.context, false);
});

test("finalizes complete R2 artifacts with manifest last for zero and nonzero exits", async () => {
  const terminalInputs = [];
  const runId = "00000000-0000-4000-8000-000000000001";
  const artifacts = Object.freeze(
    [
      ["report.json", "application/json; charset=utf-8"],
      ["listings.csv", "text/csv; charset=utf-8"],
      ["observations.csv", "text/csv; charset=utf-8"],
      ["diagnostics.json", "application/json; charset=utf-8"],
    ].map(([name, contentType]) =>
      Object.freeze({
        name,
        key: `evidence/${name}`,
        byteLength: 1,
        contentType,
        sha256: "a".repeat(64),
      }),
    ),
  );
  const selection = createEvidenceReporter({
    configuration: readConfiguration("shadow", r2Environment()),
    dependencies: {
      createFilesystemReporter: () => {
        throw new Error("filesystem must not be constructed in R2 mode");
      },
      createR2S3ObjectStore: () => ({ putIfAbsent: async () => {} }),
      createR2Reporter: () => ({
        writeRunArtifacts: async () => ({
          prefix: "evidence",
          objects: artifacts,
        }),
        finalizeTerminal: async (input) => {
          terminalInputs.push(input);
          return { manifestKey: "evidence/manifest.json" };
        },
      }),
      pruneArtifacts: async () => {
        throw new Error("R2 evidence must not be pruned locally");
      },
    },
  });

  await selection.reporter.writeRunArtifacts({
    runId,
    status: "shadow_healthy",
  });
  const success = await selection.finalize({
    outcome: { runId, status: "shadow_healthy" },
    exitCode: 0,
    completedAt: "2026-08-21T02:30:00.000Z",
  });
  assert.deepEqual(success, {
    manifestKey: "evidence/manifest.json",
    manifestPresent: true,
  });
  assert.deepEqual(terminalInputs[0], {
    runId,
    status: "shadow_healthy",
    terminalClassification: "healthy",
    exitCode: 0,
    startedAt: "2026-08-21T02:00:00.000Z",
    completedAt: "2026-08-21T02:30:00.000Z",
    durationMs: 1_800_000,
    neonRunId: runId,
    artifactObjects: artifacts,
  });

  const nonzero = createEvidenceReporter({
    configuration: readConfiguration(
      "shadow",
      r2Environment({
        MLS_ATTEMPT_ID: "scheduled:production:2026-08-21:manual:retry-0001",
      }),
    ),
    dependencies: {
      createFilesystemReporter: () => {
        throw new Error("filesystem must not be constructed in R2 mode");
      },
      createR2S3ObjectStore: () => ({ putIfAbsent: async () => {} }),
      createR2Reporter: () => ({
        writeRunArtifacts: async () => ({
          prefix: "evidence-2",
          objects: artifacts,
        }),
        finalizeTerminal: async (input) => {
          terminalInputs.push(input);
          return { manifestKey: "evidence-2/manifest.json" };
        },
      }),
      pruneArtifacts: async () => {
        throw new Error("R2 evidence must not be pruned locally");
      },
    },
  });
  await nonzero.reporter.writeRunArtifacts({ runId, status: "degraded" });
  await nonzero.finalize({
    outcome: { runId, status: "degraded" },
    exitCode: 2,
    completedAt: "2026-08-21T02:30:00.000Z",
  });
  assert.equal(terminalInputs[1].exitCode, 2);
  assert.equal(terminalInputs[1].terminalClassification, "degraded");
});

test("never claims an R2 manifest when artifact metadata is incomplete or finalization fails", async () => {
  let finalizeCalls = 0;
  const selection = createEvidenceReporter({
    configuration: readConfiguration("shadow", r2Environment()),
    dependencies: {
      createFilesystemReporter: () => {
        throw new Error("filesystem must not be constructed in R2 mode");
      },
      createR2S3ObjectStore: () => ({ putIfAbsent: async () => {} }),
      createR2Reporter: () => ({
        writeRunArtifacts: async () => ({ prefix: "evidence", objects: [] }),
        finalizeTerminal: async () => {
          finalizeCalls += 1;
          throw new Error("manifest collision");
        },
      }),
      pruneArtifacts: async () => {
        throw new Error("R2 evidence must not be pruned locally");
      },
    },
  });

  await assert.rejects(
    () =>
      selection.reporter.writeRunArtifacts({
        runId: "00000000-0000-4000-8000-000000000001",
      }),
    /artifact/i,
  );
  await assert.rejects(
    () =>
      selection.finalize({
        outcome: {
          runId: "00000000-0000-4000-8000-000000000001",
          status: "shadow_healthy",
        },
        exitCode: 0,
        completedAt: "2026-08-21T02:30:00.000Z",
      }),
    /artifact/i,
  );
  assert.equal(finalizeCalls, 0);
});

function terminalRecord(overrides = {}) {
  return {
    attemptId: "scheduled:production:2026-08-21",
    runId: "00000000-0000-4000-8000-000000000001",
    neonRunId: "00000000-0000-4000-8000-000000000001",
    status: "succeeded",
    exitCode: 0,
    failureCode: null,
    evidencePrefix: "mls-sync/production/2026-08-21/run/attempt",
    manifestKey: "mls-sync/production/2026-08-21/run/attempt/manifest.json",
    manifestPresent: true,
    ...overrides,
  };
}

test("atomically writes the exact terminal IPC record and snapshots it before async I/O", async () => {
  const writes = [];
  let releaseWrite;
  const writeStarted = new Promise((resolve) => {
    releaseWrite = resolve;
  });
  const record = terminalRecord();
  const written = writeTerminalStatusRecord({
    statusFile: "/tmp/earnest-mls-terminal.json",
    record,
    evidenceBackend: "r2",
    dependencies: {
      writeFile: async (file, body, options) => {
        writes.push({ kind: "write", file, body, options });
        releaseWrite();
      },
      rename: async (from, to) => writes.push({ kind: "rename", from, to }),
      rm: async (file) => writes.push({ kind: "rm", file }),
      randomUUID: () => "00000000-0000-4000-8000-000000000003",
    },
  });
  await writeStarted;
  record.status = "failed";
  await written;

  assert.equal(writes[0].kind, "write");
  assert.match(writes[0].file, /^\/tmp\/\.earnest-mls-terminal\.json\./);
  assert.deepEqual(writes[0].options, { encoding: "utf8", flag: "wx" });
  assert.equal(JSON.parse(writes[0].body).status, "succeeded");
  assert.deepEqual(writes[1], {
    kind: "rename",
    from: writes[0].file,
    to: "/tmp/earnest-mls-terminal.json",
  });
});

test("rejects malformed terminal IPC input and never represents incomplete R2 evidence as success", async () => {
  const dependencies = {
    writeFile: async () => {
      throw new Error("write must not run");
    },
    rename: async () => {
      throw new Error("rename must not run");
    },
    rm: async () => {},
    randomUUID: () => "00000000-0000-4000-8000-000000000003",
  };
  await assert.rejects(
    () =>
      writeTerminalStatusRecord({
        statusFile: "/tmp/earnest-mls-terminal.json",
        record: { ...terminalRecord(), unexpected: true },
        evidenceBackend: "r2",
        dependencies,
      }),
    /terminal record/i,
  );
  const accessor = terminalRecord();
  Object.defineProperty(accessor, "status", {
    enumerable: true,
    get() {
      throw new Error("accessor must not run");
    },
  });
  await assert.rejects(
    () =>
      writeTerminalStatusRecord({
        statusFile: "/tmp/earnest-mls-terminal.json",
        record: accessor,
        evidenceBackend: "r2",
        dependencies,
      }),
    /terminal record/i,
  );
  const normalized = await writeTerminalStatusRecord({
    statusFile: "/tmp/earnest-mls-terminal.json",
    record: terminalRecord({ manifestKey: null, manifestPresent: false }),
    evidenceBackend: "r2",
    dependencies: {
      writeFile: async (_file, body) => {
        assert.equal(JSON.parse(body).status, "unknown");
        assert.equal(JSON.parse(body).failureCode, "terminal_manifest_missing");
      },
      rename: async () => {},
      rm: async () => {},
      randomUUID: () => "00000000-0000-4000-8000-000000000003",
    },
  });
  assert.equal(normalized.status, "unknown");
  assert.equal(normalized.manifestPresent, false);
});

test("main finalizes R2 evidence and persists a successful bounded supervisor record without external calls", async () => {
  const runId = "00000000-0000-4000-8000-000000000001";
  const calls = [];
  const reporter = {
    writeRunArtifacts: async () => ({
      prefix: "mls-sync/production/2026-08-21/run/attempt",
      objects: [],
    }),
  };
  const code = await main(["--mode=shadow"], {
    environment: r2Environment(),
    loadEnvironmentFiles: async () => {},
    createEvidenceReporter: () => ({
      reporter,
      finalize: async (input) => {
        calls.push({ kind: "finalize", input });
        return {
          manifestKey:
            "mls-sync/production/2026-08-21/run/attempt/manifest.json",
          manifestPresent: true,
        };
      },
      getEvidenceState: () => ({
        evidencePrefix: "mls-sync/production/2026-08-21/run/attempt",
        manifestKey: "mls-sync/production/2026-08-21/run/attempt/manifest.json",
        manifestPresent: true,
      }),
    }),
    validateArtifactRoot: () => {
      throw new Error("filesystem validation must not run in R2 mode");
    },
    createVercelBlobStore: () => {
      throw new Error("Blob must not be constructed in shadow mode");
    },
    withMlsAdvisoryLock: async ({ work }) => work({}),
    createSyncRepository: () => ({}),
    createOldSiteSourceAdapter: () => ({}),
    create28HseAgentSourceAdapter: () => ({}),
    runDualSourceSync: async ({ reporter: selectedReporter }) => {
      assert.equal(selectedReporter, reporter);
      await selectedReporter.writeRunArtifacts({ runId });
      return { runId, status: "shadow_healthy", counts: {} };
    },
    prepareListingMedia: () => {
      throw new Error("media must not run in this fake");
    },
    logRunEvent: (event) => calls.push({ kind: "log", event }),
    writeTerminalStatusRecord: async (input) =>
      calls.push({ kind: "terminal", input }),
    now: () => new Date("2026-08-21T02:30:00.000Z"),
  });

  assert.equal(code, 0);
  assert.equal(calls[0].kind, "log");
  assert.equal(calls[1].kind, "finalize");
  assert.deepEqual(calls[2], {
    kind: "terminal",
    input: {
      statusFile: "/tmp/earnest-mls-terminal.json",
      evidenceBackend: "r2",
      record: terminalRecord({ runId, neonRunId: runId }),
    },
  });
});

test("main preserves the lock exit code while persisting a bounded non-success terminal record", async () => {
  const terminalRecords = [];
  const code = await main(["--mode=shadow"], {
    environment: r2Environment(),
    loadEnvironmentFiles: async () => {},
    createEvidenceReporter: () => ({
      reporter: { writeRunArtifacts: async () => ({}) },
      finalize: async () => {
        throw new Error("artifacts are unavailable for a lock outcome");
      },
      getEvidenceState: () => ({
        evidencePrefix: null,
        manifestKey: null,
        manifestPresent: false,
      }),
    }),
    createVercelBlobStore: () => {
      throw new Error("Blob must not be constructed in shadow mode");
    },
    withMlsAdvisoryLock: async () => ({ kind: "lock_unavailable" }),
    logRunEvent: () => {},
    writeTerminalStatusRecord: async ({ record }) =>
      terminalRecords.push(record),
    now: () => new Date("2026-08-21T02:30:00.000Z"),
  });

  assert.equal(code, 75);
  assert.deepEqual(terminalRecords, [
    terminalRecord({
      runId: null,
      neonRunId: null,
      status: "blocked",
      exitCode: 75,
      failureCode: "terminal_manifest_missing",
      evidencePrefix: null,
      manifestKey: null,
      manifestPresent: false,
    }),
  ]);
});

test("main persists a bounded terminal failure when R2 reporter construction is rejected", async () => {
  const terminalRecords = [];
  const code = await main(["--mode=shadow"], {
    environment: r2Environment(),
    loadEnvironmentFiles: async () => {},
    createEvidenceReporter: () => {
      throw new Error("R2 dependency rejected");
    },
    logRunEvent: () => {},
    writeTerminalStatusRecord: async ({ record }) =>
      terminalRecords.push(record),
  });

  assert.equal(code, 30);
  assert.deepEqual(terminalRecords, [
    terminalRecord({
      runId: null,
      neonRunId: null,
      status: "failed",
      exitCode: 30,
      failureCode: "invalid_evidence_configuration",
      evidencePrefix: null,
      manifestKey: null,
      manifestPresent: false,
    }),
  ]);
});
