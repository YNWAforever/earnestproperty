import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildShadowAcceptanceRecord,
  main,
  verifyShadowEvidence,
  verifyShadowPreflight,
} from "./verify-shadow.mjs";

function manualShadowReadinessSection(runbook) {
  const heading = "## 3. Manual shadow readiness verifier";
  const start = runbook.indexOf(heading);
  assert.notEqual(start, -1);
  const nextHeading = runbook.indexOf("\n## ", start + heading.length);
  return runbook.slice(start, nextHeading === -1 ? undefined : nextHeading);
}

function assertManualShadowReadinessSection(section) {
  for (const command of [
    "npm.cmd exec wrangler -- secret list --config workers/mls-container/wrangler.jsonc",
    "npm.cmd exec wrangler -- deploy --config workers/mls-container/wrangler.jsonc",
    "node scripts/mls/verify-shadow.mjs --preflight <path> --evidence <path> --output <path>",
  ]) {
    assert.equal(
      section.includes(command),
      true,
      `missing runbook command: ${command}`,
    );
  }

  for (const requiredTerm of [
    "shadow",
    "publishEnabled:false",
    "BLOB_READ_WRITE_TOKEN",
    "migration",
    "rollback",
  ]) {
    assert.equal(
      section.includes(requiredTerm),
      true,
      `missing runbook term: ${requiredTerm}`,
    );
  }

  assert.match(section, /separately approved secret-placement gate/i);

  for (const credentialPattern of [
    new RegExp("\\bBearer\\s+\\S+", "i"),
    new RegExp(
      "\\b(?:postgres(?:ql)?|https?):\\/\\/\\S*(?::[^@\\s]+@|[?&](?:token|key|secret|password|credential|access_token)=\\S+)",
      "i",
    ),
    new RegExp(
      "\\b[A-Za-z_][\\w-]*(?:token|key|secret|password|credential)[\\w-]*\\s*(?:=|:)\\s*[^\\s,;]+",
      "i",
    ),
  ]) {
    assert.doesNotMatch(
      section,
      credentialPattern,
      "the section must not contain a credential value",
    );
  }

  for (const automaticActivation of [
    new RegExp("\\bwrangler\\s+(?:schedule|schedules|publish)\\b", "i"),
    new RegExp(
      "\\b(?:cron|schedule)\\s+(?:activate|enable|create|install)\\b",
      "i",
    ),
    new RegExp(
      "\\b(?:workflows?\\s+trigger|workflow\\s+trigger)\\b[\\s\\S]*?\\bmode\\s*[=:]\\s*[^a-zA-Z]*publish\\b",
      "i",
    ),
    new RegExp(
      "\\b[A-Za-z_][\\w-]*publish[\\w-]*\\s*(?:=|:)\\s*(?:true|1|[^a-zA-Z]*publish\\b)",
      "i",
    ),
  ]) {
    assert.doesNotMatch(
      section,
      automaticActivation,
      "the section must not activate schedule or publication",
    );
  }
}

test("runbook manual shadow readiness verifier remains approval-gated", async () => {
  const runbook = await readFile(
    new URL("../../docs/mls-production-activation.md", import.meta.url),
    "utf8",
  );

  assertManualShadowReadinessSection(manualShadowReadinessSection(runbook));
});

test("runbook verifier rejects credential and automatic activation variants", async () => {
  const runbook = await readFile(
    new URL("../../docs/mls-production-activation.md", import.meta.url),
    "utf8",
  );
  const safeSection = [
    manualShadowReadinessSection(runbook),
    "After the separately approved secret-placement gate.",
  ].join("\n");

  for (const unsafeAddition of [
    "Authorization: Bearer example-token-value",
    "postgresql://operator:password@example.test/database",
    "https://example.test/hook?access_token=example-token-value",
    "serviceApiToken: example-token-value",
    "backup-key = example-key-value",
    "npm.cmd exec wrangler schedule create",
    "npm.cmd exec wrangler publish",
    "npm.cmd exec wrangler workflows trigger runner mode=publish",
    "cron activate now",
    "MLS_PUBLISH_ENABLED=true",
  ]) {
    assert.throws(
      () =>
        assertManualShadowReadinessSection(`${safeSection}\n${unsafeAddition}`),
      assert.AssertionError,
      unsafeAddition,
    );
  }
});

const VALID_ATTEMPT_ID = "scheduled:production:2026-08-23";
const VALID_RUN_ID = "00000000-0000-4000-8000-000000000001";
const VALID_WORKFLOW_ID = "workflow-20260823-01";
const VALID_DEPLOYMENT_ID = "deployment-20260823-01";
const VALID_PREFIX = `mls-sync/production/2026-08-23/${VALID_RUN_ID}/${VALID_ATTEMPT_ID}`;
const REQUIRED_SECRET_NAMES = [
  "DATABASE_URL_UNPOOLED",
  "MLS_R2_ACCESS_KEY_ID",
  "MLS_R2_SECRET_ACCESS_KEY",
  "MLS_CRAWLER_CONTACT_URL",
  "MLS_MEDIA_ALLOWED_HOSTS",
  "CLOUDFLARE_ACCOUNT_ID",
  "MLS_EVIDENCE_BUCKET",
  "CLOUDFLARE_DEPLOYMENT_ID",
];

function validPreflight() {
  return {
    account: { capability: true },
    worker: { workersDev: false, routes: [], schedules: [] },
    container: { registered: true, deploymentId: VALID_DEPLOYMENT_ID },
    workflow: { registered: true, deploymentId: VALID_DEPLOYMENT_ID },
    migration: { applied: true, version: "2026-08-22-mls-evidence" },
    secrets: { names: [...REQUIRED_SECRET_NAMES] },
    r2: {
      bucket: "earnest-mls-evidence",
      objectLock: "COMPLIANCE",
      retentionDays: 90,
      lifecycleDays: 90,
    },
    flags: {
      mode: "shadow",
      publishEnabled: false,
      mediaRightsConfirmed: false,
    },
  };
}

function validEvidence() {
  return {
    identity: {
      attemptId: VALID_ATTEMPT_ID,
      workflowId: VALID_WORKFLOW_ID,
      deploymentId: VALID_DEPLOYMENT_ID,
      runId: VALID_RUN_ID,
      evidencePrefix: VALID_PREFIX,
    },
    workflow: {
      attemptId: VALID_ATTEMPT_ID,
      deploymentId: VALID_DEPLOYMENT_ID,
      state: "succeeded",
    },
    container: {
      deploymentId: VALID_DEPLOYMENT_ID,
      state: "succeeded",
      exitCode: 0,
    },
    run: {
      attemptId: VALID_ATTEMPT_ID,
      workflowId: VALID_WORKFLOW_ID,
      deploymentId: VALID_DEPLOYMENT_ID,
      runId: VALID_RUN_ID,
      evidencePrefix: VALID_PREFIX,
    },
    sources: {
      configured: ["28hse", "internal"],
      health: { "28hse": "full", internal: "full" },
    },
    neon: { shadow: true, healthy: true, lockReleased: true },
    r2: {
      evidencePrefix: VALID_PREFIX,
      manifestPresent: true,
      manifestSha256: "a".repeat(64),
      objectKeys: [
        `${VALID_PREFIX}/run.json`,
        `${VALID_PREFIX}/diagnostics.json`,
        `${VALID_PREFIX}/summary.json`,
        `${VALID_PREFIX}/manifest.json`,
      ],
    },
    statusRoute: {
      attemptId: VALID_ATTEMPT_ID,
      state: "succeeded",
      exitCode: 0,
      manifestPresent: true,
    },
    sideEffects: { blobUploads: 0, publicationAttempts: 0 },
    redaction: { secretsAbsent: true, credentialPatternsAbsent: true },
  };
}

function clone(value) {
  return structuredClone(value);
}

function assertFailure(verifier, snapshot, expected) {
  const result = verifier(snapshot);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.failures, [expected]);
  assert.equal(Object.isFrozen(result.failures), true);
  assert.equal(Object.isFrozen(result.checks), true);
  return result;
}

test("accepts an exact fail-closed shadow preflight snapshot", () => {
  const result = verifyShadowPreflight(validPreflight());
  assert.equal(result.accepted, true);
  assert.deepEqual(result.failures, []);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.failures), true);
  assert.equal(Object.isFrozen(result.checks), true);
});

test("rejects unavailable Cloudflare capability", () => {
  const snapshot = validPreflight();
  snapshot.account.capability = false;
  assertFailure(
    verifyShadowPreflight,
    snapshot,
    "cloudflare_capability_unavailable",
  );
});

test("rejects each public worker activation surface", () => {
  for (const [mutate, code] of [
    [(value) => (value.worker.workersDev = true), "workers_dev_enabled"],
    [(value) => value.worker.routes.push("example.com/*"), "routes_present"],
    [(value) => value.worker.schedules.push("0 * * * *"), "schedules_present"],
  ]) {
    const snapshot = validPreflight();
    mutate(snapshot);
    assertFailure(verifyShadowPreflight, snapshot, code);
  }
});

test("rejects missing container, workflow, and migration registrations", () => {
  for (const [mutate, code] of [
    [
      (value) => (value.container.registered = false),
      "container_not_registered",
    ],
    [(value) => (value.workflow.registered = false), "workflow_not_registered"],
    [(value) => (value.migration.applied = false), "migration_not_applied"],
  ]) {
    const snapshot = validPreflight();
    mutate(snapshot);
    assertFailure(verifyShadowPreflight, snapshot, code);
  }
});

test("rejects an invalid shadow environment and unsafe flags", () => {
  for (const [mutate, code] of [
    [
      (value) => (value.flags.mode = "production"),
      "shadow_environment_invalid",
    ],
    [(value) => (value.flags.publishEnabled = true), "publish_flag_enabled"],
    [
      (value) => (value.flags.mediaRightsConfirmed = true),
      "media_rights_flag_enabled",
    ],
  ]) {
    const snapshot = validPreflight();
    mutate(snapshot);
    assertFailure(verifyShadowPreflight, snapshot, code);
  }
});

test("reports each missing required secret name without reading values", () => {
  for (const secretName of REQUIRED_SECRET_NAMES) {
    const snapshot = validPreflight();
    snapshot.secrets.names = snapshot.secrets.names.filter(
      (name) => name !== secretName,
    );
    assertFailure(
      verifyShadowPreflight,
      snapshot,
      `missing_secret_name:${secretName}`,
    );
  }
});

test("rejects invalid R2 bucket, lock, and lifecycle configuration", () => {
  for (const [mutate, code] of [
    [(value) => (value.r2.bucket = "other"), "r2_bucket_invalid"],
    [(value) => (value.r2.objectLock = "GOVERNANCE"), "r2_lock_invalid"],
    [(value) => (value.r2.retentionDays = 89), "r2_lock_invalid"],
    [(value) => (value.r2.lifecycleDays = 91), "r2_lifecycle_invalid"],
  ]) {
    const snapshot = validPreflight();
    mutate(snapshot);
    assertFailure(verifyShadowPreflight, snapshot, code);
  }
});

test("accepts fully correlated shadow evidence", () => {
  const result = verifyShadowEvidence(validEvidence());
  assert.equal(result.accepted, true);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.identity, validEvidence().identity);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.checks), true);
  assert.equal(Object.isFrozen(result.identity), true);
});

test("rejects malformed identity values, UUIDs, traversal, and free text", () => {
  for (const [mutate, code] of [
    [
      (value) => (value.identity.attemptId = "manual:production:2026-08-23"),
      "attempt_id_invalid",
    ],
    [(value) => (value.identity.attemptId = 123), "attempt_id_invalid"],
    [
      (value) => (value.identity.runId = "not-a-uuid"),
      "shadow_identity_invalid",
    ],
    [
      (value) => (value.identity.evidencePrefix = `${VALID_PREFIX}/../secret`),
      "shadow_identity_invalid",
    ],
    [
      (value) => (value.identity.note = "Authorization: Bearer credential"),
      "shadow_identity_invalid",
    ],
  ]) {
    const snapshot = validEvidence();
    mutate(snapshot);
    assertFailure(verifyShadowEvidence, snapshot, code);
  }
});

test("rejects workflow attempt and deployment mismatches", () => {
  for (const [mutate, code] of [
    [
      (value) => (value.workflow.attemptId = "scheduled:preview:2026-08-23"),
      "workflow_attempt_mismatch",
    ],
    [
      (value) => (value.workflow.deploymentId = "deployment-other-01"),
      "workflow_deployment_mismatch",
    ],
  ]) {
    const snapshot = validEvidence();
    mutate(snapshot);
    assertFailure(verifyShadowEvidence, snapshot, code);
  }
});

test("rejects unsuccessful workflow and container outcomes", () => {
  for (const [mutate, code] of [
    [(value) => (value.workflow.state = "failed"), "workflow_not_successful"],
    [(value) => (value.container.state = "failed"), "container_not_successful"],
    [(value) => (value.container.exitCode = 1), "container_not_successful"],
  ]) {
    const snapshot = validEvidence();
    mutate(snapshot);
    assertFailure(verifyShadowEvidence, snapshot, code);
  }
});

test("rejects run identity and evidence prefix mismatches", () => {
  for (const [mutate, code] of [
    [
      (value) => (value.run.runId = "00000000-0000-4000-8000-000000000002"),
      "run_identity_mismatch",
    ],
    [
      (value) =>
        (value.run.evidencePrefix = value.run.evidencePrefix.replace(
          "mls-sync/",
          "other/",
        )),
      "evidence_prefix_mismatch",
    ],
    [
      (value) =>
        (value.r2.evidencePrefix = value.r2.evidencePrefix.replace(
          "mls-sync/",
          "other/",
        )),
      "evidence_prefix_mismatch",
    ],
  ]) {
    const snapshot = validEvidence();
    mutate(snapshot);
    assertFailure(verifyShadowEvidence, snapshot, code);
  }
});

test("rejects absent workflow and status manifests", () => {
  for (const mutate of [
    (value) => (value.r2.manifestPresent = false),
    (value) => (value.statusRoute.manifestPresent = false),
  ]) {
    const snapshot = validEvidence();
    mutate(snapshot);
    assertFailure(verifyShadowEvidence, snapshot, "manifest_missing");
  }
});

test("requires full health for every configured source", () => {
  for (const mutate of [
    (value) => (value.sources.health["28hse"] = "partial"),
    (value) => value.sources.configured.push("missing"),
  ]) {
    const snapshot = validEvidence();
    mutate(snapshot);
    assertFailure(verifyShadowEvidence, snapshot, "source_health_not_full");
  }
});

test("requires healthy shadow Neon state with its lock released", () => {
  for (const key of ["shadow", "healthy", "lockReleased"]) {
    const snapshot = validEvidence();
    snapshot.neon[key] = false;
    assertFailure(verifyShadowEvidence, snapshot, "neon_shadow_not_healthy");
  }
});

test("rejects invalid SHA-256 and each missing exact-prefix R2 object", () => {
  const invalidSha = validEvidence();
  invalidSha.r2.manifestSha256 = "not-a-sha";
  assertFailure(verifyShadowEvidence, invalidSha, "manifest_invalid");

  for (const suffix of [
    "run.json",
    "diagnostics.json",
    "summary.json",
    "manifest.json",
  ]) {
    const snapshot = validEvidence();
    snapshot.r2.objectKeys = snapshot.r2.objectKeys.filter(
      (key) => key !== `${VALID_PREFIX}/${suffix}`,
    );
    assertFailure(verifyShadowEvidence, snapshot, "manifest_invalid");
  }
});

test("rejects every status-route correlation mismatch", () => {
  for (const mutate of [
    (value) => (value.statusRoute.attemptId = "scheduled:preview:2026-08-23"),
    (value) => (value.statusRoute.state = "running"),
    (value) => (value.statusRoute.exitCode = 1),
  ]) {
    const snapshot = validEvidence();
    mutate(snapshot);
    assertFailure(verifyShadowEvidence, snapshot, "status_route_mismatch");
  }
});

test("rejects Blob uploads and publication attempts above zero", () => {
  const blob = validEvidence();
  blob.sideEffects.blobUploads = 1;
  assertFailure(verifyShadowEvidence, blob, "blob_side_effect_detected");

  const publication = validEvidence();
  publication.sideEffects.publicationAttempts = 1;
  assertFailure(
    verifyShadowEvidence,
    publication,
    "publication_side_effect_detected",
  );
});

test("requires both redaction checks", () => {
  for (const key of ["secretsAbsent", "credentialPatternsAbsent"]) {
    const snapshot = validEvidence();
    snapshot.redaction[key] = false;
    assertFailure(verifyShadowEvidence, snapshot, "redaction_check_failed");
  }
});

test("fails closed on malformed, inherited, extra, and symbol-bearing records", () => {
  const cases = [];

  const malformed = validEvidence();
  malformed.identity = null;
  cases.push(malformed);

  const inherited = validEvidence();
  inherited.identity = Object.assign(
    Object.create({ note: "inherited" }),
    inherited.identity,
  );
  cases.push(inherited);

  const extra = validEvidence();
  extra.identity.extra = true;
  cases.push(extra);

  const symbol = validEvidence();
  symbol.identity[Symbol("extra")] = true;
  cases.push(symbol);

  for (const snapshot of cases) {
    assertFailure(verifyShadowEvidence, snapshot, "shadow_identity_invalid");
  }
});

test("never invokes accessors or coercion hooks", () => {
  let getterCalls = 0;
  const accessor = validEvidence();
  Object.defineProperty(accessor.identity, "attemptId", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalls += 1;
      return VALID_ATTEMPT_ID;
    },
  });
  assertFailure(verifyShadowEvidence, accessor, "shadow_identity_invalid");
  assert.equal(getterCalls, 0);

  let coercionCalls = 0;
  const coercion = validEvidence();
  coercion.identity.runId = {
    [Symbol.toPrimitive]() {
      coercionCalls += 1;
      return VALID_RUN_ID;
    },
  };
  assertFailure(verifyShadowEvidence, coercion, "shadow_identity_invalid");
  assert.equal(coercionCalls, 0);
});

test("preflight results remain frozen snapshots after caller mutation", () => {
  const snapshot = validPreflight();
  const result = verifyShadowPreflight(snapshot);
  snapshot.worker.routes.push("later.example/*");
  snapshot.secrets.names.length = 0;
  assert.equal(result.accepted, true);
  assert.deepEqual(result.failures, []);
  assert.equal(Object.isFrozen(result.checks), true);
});

test("evidence identity remains a frozen snapshot after caller mutation", () => {
  const snapshot = validEvidence();
  const result = verifyShadowEvidence(snapshot);
  snapshot.identity.attemptId = "scheduled:preview:2026-08-23";
  snapshot.run.runId = "00000000-0000-4000-8000-000000000002";
  assert.equal(result.identity.attemptId, VALID_ATTEMPT_ID);
  assert.equal(result.identity.runId, VALID_RUN_ID);
  assert.equal(Object.isFrozen(result.identity), true);
});

test("builds a frozen JSON-safe acceptance record", () => {
  const preflight = verifyShadowPreflight(validPreflight());
  const evidence = verifyShadowEvidence(validEvidence());
  const checkedAt = "2026-08-23T01:02:03.456Z";
  const record = buildShadowAcceptanceRecord({
    preflight,
    evidence,
    checkedAt,
  });

  assert.deepEqual(Object.keys(record), [
    "accepted",
    "checkedAt",
    "preflightChecks",
    "evidenceChecks",
    "identity",
  ]);
  assert.equal(record.accepted, true);
  assert.equal(record.checkedAt, checkedAt);
  assert.doesNotThrow(() => JSON.stringify(record));
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.preflightChecks), true);
  assert.equal(Object.isFrozen(record.evidenceChecks), true);
  assert.equal(Object.isFrozen(record.identity), true);
  const serialized = JSON.stringify(record);
  assert.equal(serialized.includes("DATABASE_URL_UNPOOLED"), false);
  assert.equal(serialized.includes("MLS_R2_SECRET_ACCESS_KEY"), false);
  assert.equal(serialized.includes("snapshots"), false);
  assert.equal(serialized.includes("secrets"), false);
  assert.throws(() => {
    record.identity.runId = "00000000-0000-4000-8000-000000000002";
  }, TypeError);
  assert.equal(record.identity.runId, VALID_RUN_ID);
});

test("rejects unaccepted inputs and non-millisecond UTC checkedAt values", () => {
  const acceptedPreflight = verifyShadowPreflight(validPreflight());
  const acceptedEvidence = verifyShadowEvidence(validEvidence());
  const rejectedPreflight = verifyShadowPreflight({});
  const rejectedEvidence = verifyShadowEvidence({});
  const forgedEvidence = {
    ...acceptedEvidence,
    checks: {
      ...acceptedEvidence.checks,
      "Authorization: Bearer credential": true,
    },
  };

  for (const input of [
    {
      preflight: rejectedPreflight,
      evidence: acceptedEvidence,
      checkedAt: "2026-08-23T01:02:03.456Z",
    },
    {
      preflight: acceptedPreflight,
      evidence: rejectedEvidence,
      checkedAt: "2026-08-23T01:02:03.456Z",
    },
    {
      preflight: acceptedPreflight,
      evidence: forgedEvidence,
      checkedAt: "2026-08-23T01:02:03.456Z",
    },
    {
      preflight: acceptedPreflight,
      evidence: acceptedEvidence,
      checkedAt: "2026-08-23T01:02:03Z",
    },
    {
      preflight: acceptedPreflight,
      evidence: acceptedEvidence,
      checkedAt: "2026-08-23T09:02:03.456+08:00",
    },
  ]) {
    assert.throws(() => buildShadowAcceptanceRecord(input), TypeError);
  }
});

test("rejects accepted records with any known failed check", () => {
  const acceptedPreflight = verifyShadowPreflight(validPreflight());
  const acceptedEvidence = verifyShadowEvidence(validEvidence());
  const falsePreflight = {
    ...acceptedPreflight,
    checks: { ...acceptedPreflight.checks, cloudflareCapability: false },
  };
  const falseEvidence = {
    ...acceptedEvidence,
    checks: { ...acceptedEvidence.checks, redaction: false },
  };
  const checkedAt = "2026-08-23T01:02:03.456Z";

  assert.throws(
    () =>
      buildShadowAcceptanceRecord({
        preflight: falsePreflight,
        evidence: acceptedEvidence,
        checkedAt,
      }),
    TypeError,
  );
  assert.throws(
    () =>
      buildShadowAcceptanceRecord({
        preflight: acceptedPreflight,
        evidence: falseEvidence,
        checkedAt,
      }),
    TypeError,
  );
});

async function withCliFiles(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "earnest-mls-shadow-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function cliDependencies(overrides = {}) {
  const stdout = [];
  const stderr = [];
  return {
    dependencies: {
      readFile,
      writeFile,
      mkdir,
      now: () => new Date("2026-08-23T01:02:03.456Z"),
      writeStdout: (value) => stdout.push(value),
      writeStderr: (value) => stderr.push(value),
      ...overrides,
    },
    stderr,
    stdout,
  };
}

test("CLI writes a bounded accepted shadow record", async () => {
  await withCliFiles(async (directory) => {
    const preflightPath = path.join(directory, "preflight.json");
    const evidencePath = path.join(directory, "evidence.json");
    const outputPath = path.join(directory, "acceptance.json");
    await writeFile(preflightPath, JSON.stringify(validPreflight()), "utf8");
    await writeFile(evidencePath, JSON.stringify(validEvidence()), "utf8");
    const { dependencies } = cliDependencies();

    const exitCode = await main(
      [
        "--preflight",
        preflightPath,
        "--evidence",
        evidencePath,
        "--output",
        outputPath,
      ],
      dependencies,
    );

    assert.equal(exitCode, 0);
    const output = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(output.accepted, true);
    assert.equal(output.checkedAt, "2026-08-23T01:02:03.456Z");
  });
});

test("CLI returns bounded evidence failures without accepting", async () => {
  await withCliFiles(async (directory) => {
    const preflightPath = path.join(directory, "preflight.json");
    const evidencePath = path.join(directory, "evidence.json");
    const outputPath = path.join(directory, "acceptance.json");
    const evidence = validEvidence();
    evidence.sideEffects.publicationAttempts = 1;
    await writeFile(preflightPath, JSON.stringify(validPreflight()), "utf8");
    await writeFile(evidencePath, JSON.stringify(evidence), "utf8");
    const { dependencies } = cliDependencies();

    const exitCode = await main(
      [
        "--preflight",
        preflightPath,
        "--evidence",
        evidencePath,
        "--output",
        outputPath,
      ],
      dependencies,
    );

    assert.equal(exitCode, 30);
    const output = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(output.accepted, false);
    assert.deepEqual(output.failures, ["publication_side_effect_detected"]);
    assert.equal(
      output.failures.every((code) => /^[a-z][a-z0-9_-]{0,79}$/.test(code)),
      true,
    );
  });
});

test("CLI rejects missing arguments without reading or writing files", async () => {
  const writes = [];
  const { dependencies } = cliDependencies({
    readFile: async () => assert.fail("readFile must not be called"),
    writeFile: async (...args) => writes.push(args),
    mkdir: async () => assert.fail("mkdir must not be called"),
  });

  const exitCode = await main(["--preflight", "preflight.json"], dependencies);

  assert.equal(exitCode, 2);
  assert.deepEqual(writes, []);
});

test("CLI rejects output paths whose parent would require nested creation", async () => {
  await withCliFiles(async (directory) => {
    const preflightPath = path.join(directory, "preflight.json");
    const evidencePath = path.join(directory, "evidence.json");
    const outputPath = path.join(
      directory,
      "missing",
      "nested",
      "acceptance.json",
    );
    await writeFile(preflightPath, JSON.stringify(validPreflight()), "utf8");
    await writeFile(evidencePath, JSON.stringify(validEvidence()), "utf8");
    const { dependencies } = cliDependencies();

    const exitCode = await main(
      [
        "--preflight",
        preflightPath,
        "--evidence",
        evidencePath,
        "--output",
        outputPath,
      ],
      dependencies,
    );

    assert.equal(exitCode, 2);
    await assert.rejects(readFile(outputPath, "utf8"));
  });
});

test("CLI never serializes credentials from rejected evidence", async () => {
  await withCliFiles(async (directory) => {
    const credential = "Authorization: Bearer super-secret-credential";
    const preflightPath = path.join(directory, "preflight.json");
    const evidencePath = path.join(directory, "evidence.json");
    const outputPath = path.join(directory, "acceptance.json");
    const evidence = validEvidence();
    evidence.credential = credential;
    await writeFile(preflightPath, JSON.stringify(validPreflight()), "utf8");
    await writeFile(evidencePath, JSON.stringify(evidence), "utf8");
    const { dependencies, stderr, stdout } = cliDependencies();

    const exitCode = await main(
      [
        "--preflight",
        preflightPath,
        "--evidence",
        evidencePath,
        "--output",
        outputPath,
      ],
      dependencies,
    );

    assert.equal(exitCode, 30);
    const output = await readFile(outputPath, "utf8");
    assert.equal(output.includes(credential), false);
    assert.equal(stdout.join("").includes(credential), false);
    assert.equal(stderr.join("").includes(credential), false);
  });
});

test("CLI bounds input reads before rejecting oversized JSON", async () => {
  const readFileCalls = [];
  const readLengths = [];
  const writes = [];
  let closes = 0;
  const requestedBytes = 256 * 1024 + 1;
  const { dependencies } = cliDependencies({
    readFile: async (...args) => {
      readFileCalls.push(args);
      throw new Error("unbounded readFile must not be called");
    },
    open: async () => ({
      read: async (_buffer, _offset, length) => {
        readLengths.push(length);
        return { bytesRead: length };
      },
      close: async () => {
        closes += 1;
      },
    }),
    writeFile: async (...args) => writes.push(args),
  });

  const exitCode = await main(
    [
      "--preflight",
      "preflight.json",
      "--evidence",
      "evidence.json",
      "--output",
      "output.json",
    ],
    dependencies,
  );

  assert.equal(exitCode, 2);
  assert.equal(readFileCalls.length, 0);
  assert.deepEqual(readLengths, [requestedBytes, requestedBytes]);
  assert.equal(closes, 2);
  assert.deepEqual(writes, []);
});

test("CLI drains short reads through the size sentinel before parsing", async () => {
  const preflightPath = "preflight.json";
  const evidencePath = "evidence.json";
  const prefixes = new Map([
    [preflightPath, Buffer.from(JSON.stringify(validPreflight()), "utf8")],
    [evidencePath, Buffer.from(JSON.stringify(validEvidence()), "utf8")],
  ]);
  const reads = new Map();
  const writes = [];
  let closes = 0;
  const { dependencies } = cliDependencies({
    open: async (filePath) => {
      const prefix = prefixes.get(filePath);
      assert.ok(prefix);
      const fileReads = [];
      reads.set(filePath, fileReads);
      let call = 0;
      return {
        read: async (buffer, offset, length, position) => {
          fileReads.push({ length, offset, position });
          if (call++ === 0) {
            prefix.copy(buffer, offset);
            return { bytesRead: prefix.length };
          }
          return { bytesRead: length };
        },
        close: async () => {
          closes += 1;
        },
      };
    },
    writeFile: async (...args) => writes.push(args),
  });

  const exitCode = await main(
    [
      "--preflight",
      preflightPath,
      "--evidence",
      evidencePath,
      "--output",
      "output.json",
    ],
    dependencies,
  );

  assert.equal(exitCode, 2);
  assert.equal(closes, 2);
  assert.deepEqual(writes, []);
  for (const [filePath, prefix] of prefixes) {
    const fileReads = reads.get(filePath);
    assert.deepEqual(fileReads, [
      { length: 256 * 1024 + 1, offset: 0, position: 0 },
      {
        length: 256 * 1024 + 1 - prefix.length,
        offset: prefix.length,
        position: prefix.length,
      },
    ]);
  }
});
