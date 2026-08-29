import { createHash } from "node:crypto";
import { mkdir, open, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const ATTEMPT =
  /^scheduled:(preview|production):\d{4}-\d{2}-\d{2}(?::manual:[a-z0-9][a-z0-9-]{7,63})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const FAILURE = /^[a-z][a-z0-9_-]{0,79}$/;
const SOURCE = /^[a-z0-9][a-z0-9_-]{0,79}$/;
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
const ALLOWED_RUNTIME_NAMES = [
  ...REQUIRED_SECRET_NAMES,
  "BLOB_READ_WRITE_TOKEN",
  "MLS_ENVIRONMENT",
  "MLS_SCHEDULED_MODE",
  "MLS_PUBLISH_ENABLED",
  "MLS_MEDIA_RIGHTS_CONFIRMED",
  "MLS_EVIDENCE_BACKEND",
  "MLS_EVIDENCE_RETENTION_DAYS",
  "MLS_GIT_COMMIT_SHA",
  "MLS_SCHEDULED_FOR",
  "MLS_ATTEMPT_ID",
  "MLS_WORKFLOW_INSTANCE_ID",
  "MLS_CONTAINER_ID",
  "MLS_ATTEMPT_STARTED_AT",
  "MLS_TERMINAL_STATUS_FILE",
  "MLS_ARTIFACT_DIR",
];

const PREFLIGHT_KEYS = [
  "account",
  "worker",
  "container",
  "workflow",
  "migration",
  "secrets",
  "r2",
  "flags",
];
const EVIDENCE_KEYS = [
  "identity",
  "workflow",
  "container",
  "run",
  "sources",
  "neon",
  "r2",
  "statusRoute",
  "sideEffects",
  "redaction",
];
const IDENTITY_KEYS = [
  "attemptId",
  "workflowId",
  "deploymentId",
  "commitSha",
  "runId",
  "evidencePrefix",
];
const PREFLIGHT_IDENTITY_KEYS = ["deploymentId", "commitSha"];
const REQUIRED_OBJECT_SUFFIXES = [
  "report.json",
  "listings.csv",
  "observations.csv",
  "diagnostics.json",
  "manifest.json",
];
const ARTIFACT_SPECS = Object.freeze([
  Object.freeze({
    name: "report.json",
    contentType: "application/json; charset=utf-8",
  }),
  Object.freeze({
    name: "listings.csv",
    contentType: "text/csv; charset=utf-8",
  }),
  Object.freeze({
    name: "observations.csv",
    contentType: "text/csv; charset=utf-8",
  }),
  Object.freeze({
    name: "diagnostics.json",
    contentType: "application/json; charset=utf-8",
  }),
]);
const ARTIFACT_KEYS = ["name", "byteLength", "contentType", "sha256"];
const ARTIFACT_OBJECT_KEYS = ["name", "key", "byteLength", "contentType", "sha256"];
const MANIFEST_KEYS = [
  "schemaVersion",
  "environment",
  "hkDate",
  "attemptId",
  "mode",
  "commitSha",
  "containerDeploymentId",
  "workflowInstanceId",
  "containerId",
  "runId",
  "status",
  "terminalClassification",
  "exitCode",
  "startedAt",
  "completedAt",
  "durationMs",
  "neonRunId",
  "artifacts",
];
const MANIFEST_EVIDENCE_KEYS = ["manifestSha256", ...MANIFEST_KEYS];
const PREFLIGHT_CHECK_KEYS = [
  "cloudflareCapability",
  "workersDevDisabled",
  "routesAbsent",
  "schedulesAbsent",
  "containerRegistered",
  "workflowRegistered",
  "deploymentIdentity",
  "commitIdentity",
  "migrationApplied",
  "shadowEnvironment",
  "publishDisabled",
  "mediaRightsDisabled",
  "requiredSecretsPresent",
  "secretNamesBounded",
  "r2Bucket",
  "r2Lock",
  "r2Lifecycle",
];
const EVIDENCE_CHECK_KEYS = [
  "shadowIdentity",
  "workflowAttempt",
  "workflowDeployment",
  "workflowSuccessful",
  "containerSuccessful",
  "runIdentity",
  "evidencePrefix",
  "manifestPresent",
  "sourceHealth",
  "neonShadowHealthy",
  "manifestValid",
  "statusRoute",
  "noBlobUploads",
  "noPublication",
  "redaction",
];

function inspectRecord(value, expectedKeys) {
  if (value === null || typeof value !== "object") return null;

  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }

  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(descriptors);
  if (
    ownKeys.length !== expectedKeys.length ||
    ownKeys.some((key) => typeof key !== "string") ||
    expectedKeys.some((key) => !Object.hasOwn(descriptors, key))
  ) {
    return null;
  }

  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || descriptor.enumerable !== true) return null;
  }

  return Object.fromEntries(expectedKeys.map((key) => [key, descriptors[key].value]));
}

function inspectDynamicRecord(value) {
  if (value === null || typeof value !== "object") return null;

  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }

  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string")) return null;

  const record = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || descriptor.enumerable !== true) return null;
    record[key] = descriptor.value;
  }
  return record;
}

function inspectArray(value) {
  if (!Array.isArray(value)) return null;

  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  if (prototype !== Array.prototype) return null;

  const lengthDescriptor = descriptors.length;
  if (!lengthDescriptor || !("value" in lengthDescriptor)) return null;
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0) return null;

  const expectedKeys = Array.from({ length }, (_, index) => String(index));
  const ownKeys = Reflect.ownKeys(descriptors);
  if (
    ownKeys.length !== expectedKeys.length + 1 ||
    ownKeys.some((key) => typeof key !== "string") ||
    expectedKeys.some((key) => !Object.hasOwn(descriptors, key))
  ) {
    return null;
  }

  const values = [];
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || descriptor.enumerable !== true) return null;
    values.push(descriptor.value);
  }
  return values;
}

function frozenFailures(failures) {
  return Object.freeze([...new Set(failures)]);
}

function freezeResult(result) {
  return Object.freeze(result);
}

function addCheck(checks, failures, name, accepted, failureCode) {
  checks[name] = accepted;
  if (!accepted) failures.push(failureCode);
}

function makeChecks(entries) {
  return Object.freeze(Object.fromEntries(entries));
}

function isString(value, pattern) {
  return typeof value === "string" && pattern.test(value);
}

function validCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value;
}

function validAttempt(value) {
  if (typeof value !== "string") return false;
  const match = ATTEMPT.exec(value);
  return match !== null && validCalendarDate(value.split(":")[2]);
}

function expectedPrefix(attemptId, runId) {
  const match = validAttempt(attemptId) ? ATTEMPT.exec(attemptId) : null;
  if (!match) return null;
  const date = attemptId.split(":")[2];
  return `mls-sync/${match[1]}/${date}/${runId}/${attemptId.replaceAll(":", "-")}`;
}

function validIdentifier(value) {
  return isString(value, FAILURE);
}

function validStringArray(value, predicate) {
  const values = inspectArray(value);
  if (!values || !values.every(predicate)) return null;
  return values;
}

function validUtcTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function captureManifestArtifacts(value) {
  const values = inspectArray(value);
  if (!values || values.length !== ARTIFACT_SPECS.length) return null;
  const artifacts = [];
  for (let index = 0; index < values.length; index += 1) {
    const artifact = inspectRecord(values[index], ARTIFACT_KEYS);
    const spec = ARTIFACT_SPECS[index];
    if (
      !artifact ||
      artifact.name !== spec.name ||
      artifact.contentType !== spec.contentType ||
      !Number.isSafeInteger(artifact.byteLength) ||
      artifact.byteLength < 0 ||
      !isString(artifact.sha256, SHA256)
    ) {
      return null;
    }
    artifacts.push(Object.freeze({ ...artifact }));
  }
  return Object.freeze(artifacts);
}

function captureArtifactObjects(value, prefix) {
  const values = inspectArray(value);
  if (!values || values.length !== ARTIFACT_SPECS.length) return null;
  const objects = [];
  for (let index = 0; index < values.length; index += 1) {
    const object = inspectRecord(values[index], ARTIFACT_OBJECT_KEYS);
    const spec = ARTIFACT_SPECS[index];
    if (
      !object ||
      object.name !== spec.name ||
      object.key !== `${prefix}/${spec.name}` ||
      object.contentType !== spec.contentType ||
      !Number.isSafeInteger(object.byteLength) ||
      object.byteLength < 0 ||
      !isString(object.sha256, SHA256)
    ) {
      return null;
    }
    objects.push(Object.freeze({ ...object }));
  }
  return Object.freeze(objects);
}

function sameArtifactMetadata(artifacts, objects) {
  return artifacts.every((artifact, index) =>
    ARTIFACT_KEYS.every((key) => artifact[key] === objects[index][key]),
  );
}

function captureRuntimeManifest(value, identity, manifestSha256) {
  const manifest = inspectRecord(value, MANIFEST_KEYS);
  if (!manifest || !identity || !isString(manifestSha256, SHA256)) return null;
  const attemptMatch = ATTEMPT.exec(identity.attemptId);
  const artifacts = captureManifestArtifacts(manifest.artifacts);
  if (!attemptMatch || !artifacts) return null;
  if (
    manifest.schemaVersion !== 1 ||
    manifest.environment !== attemptMatch[1] ||
    manifest.hkDate !== identity.attemptId.split(":")[2] ||
    manifest.attemptId !== identity.attemptId ||
    manifest.mode !== "shadow" ||
    manifest.commitSha !== identity.commitSha ||
    manifest.containerDeploymentId !== identity.deploymentId ||
    manifest.workflowInstanceId !== identity.workflowId ||
    !validIdentifier(manifest.containerId) ||
    manifest.runId !== identity.runId ||
    manifest.status !== "shadow_healthy" ||
    manifest.terminalClassification !== "healthy" ||
    manifest.exitCode !== 0 ||
    !validUtcTimestamp(manifest.startedAt) ||
    !validUtcTimestamp(manifest.completedAt) ||
    !Number.isSafeInteger(manifest.durationMs) ||
    manifest.durationMs < 0 ||
    Date.parse(manifest.completedAt) - Date.parse(manifest.startedAt) !== manifest.durationMs ||
    !isString(manifest.neonRunId, UUID)
  ) {
    return null;
  }
  const canonical = Object.freeze({
    schemaVersion: manifest.schemaVersion,
    environment: manifest.environment,
    hkDate: manifest.hkDate,
    attemptId: manifest.attemptId,
    mode: manifest.mode,
    commitSha: manifest.commitSha,
    containerDeploymentId: manifest.containerDeploymentId,
    workflowInstanceId: manifest.workflowInstanceId,
    containerId: manifest.containerId,
    runId: manifest.runId,
    status: manifest.status,
    terminalClassification: manifest.terminalClassification,
    exitCode: manifest.exitCode,
    startedAt: manifest.startedAt,
    completedAt: manifest.completedAt,
    durationMs: manifest.durationMs,
    neonRunId: manifest.neonRunId,
    artifacts,
  });
  const computedSha256 = createHash("sha256")
    .update(`${JSON.stringify(canonical, null, 2)}\\n`)
    .digest("hex");
  if (computedSha256 !== manifestSha256) return null;
  return Object.freeze({ manifestSha256, ...canonical });
}

function captureEvidenceManifest(r2, identity) {
  if (!r2 || !identity) return null;
  const manifest = captureRuntimeManifest(r2.manifest, identity, r2.manifestSha256);
  const objects = captureArtifactObjects(r2.objects, identity.evidencePrefix);
  const objectKeys = validStringArray(r2.objectKeys, (key) => typeof key === "string");
  if (!manifest || !objects || !objectKeys) return null;
  const expectedObjectKeys = [
    ...objects.map(({ key }) => key),
    `${identity.evidencePrefix}/manifest.json`,
  ];
  if (
    objectKeys.length !== expectedObjectKeys.length ||
    new Set(objectKeys).size !== expectedObjectKeys.length ||
    !expectedObjectKeys.every((key) => objectKeys.includes(key)) ||
    !sameArtifactMetadata(manifest.artifacts, objects)
  ) {
    return null;
  }
  return manifest;
}

function captureAcceptedManifest(value, identity) {
  const captured = inspectRecord(value, MANIFEST_EVIDENCE_KEYS);
  if (!captured) return null;
  const runtimeManifest = Object.fromEntries(MANIFEST_KEYS.map((key) => [key, captured[key]]));
  return captureRuntimeManifest(runtimeManifest, identity, captured.manifestSha256);
}

export function verifyShadowPreflight(snapshot) {
  const failures = [];
  const checks = {};
  const root = inspectRecord(snapshot, PREFLIGHT_KEYS);

  if (!root) {
    addCheck(checks, failures, "shadowEnvironment", false, "shadow_environment_invalid");
    return freezeResult({
      accepted: false,
      failures: frozenFailures(failures),
      checks: Object.freeze(checks),
      identity: null,
    });
  }

  const account = inspectRecord(root.account, ["capability"]);
  addCheck(
    checks,
    failures,
    "cloudflareCapability",
    account?.capability === true,
    "cloudflare_capability_unavailable",
  );

  const worker = inspectRecord(root.worker, ["workersDev", "routes", "schedules"]);
  const routes = worker ? inspectArray(worker.routes) : null;
  const schedules = worker ? inspectArray(worker.schedules) : null;
  addCheck(
    checks,
    failures,
    "workersDevDisabled",
    worker?.workersDev === false,
    "workers_dev_enabled",
  );
  addCheck(
    checks,
    failures,
    "routesAbsent",
    routes !== null && routes.length === 0,
    "routes_present",
  );
  addCheck(
    checks,
    failures,
    "schedulesAbsent",
    schedules !== null && schedules.length === 0,
    "schedules_present",
  );

  const container = inspectRecord(root.container, ["registered", "deploymentId"]);
  addCheck(
    checks,
    failures,
    "containerRegistered",
    container?.registered === true && validIdentifier(container.deploymentId),
    "container_not_registered",
  );

  const workflow = inspectRecord(root.workflow, ["registered", "deploymentId", "commitSha"]);
  addCheck(
    checks,
    failures,
    "workflowRegistered",
    workflow?.registered === true && validIdentifier(workflow.deploymentId),
    "workflow_not_registered",
  );
  const deploymentIdentity =
    container !== null && workflow !== null && container.deploymentId === workflow.deploymentId;
  addCheck(checks, failures, "deploymentIdentity", deploymentIdentity, "deployment_id_mismatch");
  const commitIdentity = isString(workflow?.commitSha, COMMIT_SHA);
  addCheck(checks, failures, "commitIdentity", commitIdentity, "commit_identity_invalid");

  const migration = inspectRecord(root.migration, ["applied", "version"]);
  addCheck(
    checks,
    failures,
    "migrationApplied",
    migration?.applied === true &&
      migration.version === "20260817120000_dual_source_listing_sync.sql",
    "migration_not_applied",
  );

  const flags = inspectRecord(root.flags, ["mode", "publishEnabled", "mediaRightsConfirmed"]);
  addCheck(
    checks,
    failures,
    "shadowEnvironment",
    flags?.mode === "shadow",
    "shadow_environment_invalid",
  );
  addCheck(
    checks,
    failures,
    "publishDisabled",
    flags?.publishEnabled === false,
    "publish_flag_enabled",
  );
  addCheck(
    checks,
    failures,
    "mediaRightsDisabled",
    flags?.mediaRightsConfirmed === false,
    "media_rights_flag_enabled",
  );

  const secrets = inspectRecord(root.secrets, ["names"]);
  const secretNames = secrets
    ? validStringArray(secrets.names, (name) => typeof name === "string")
    : null;
  const secretSet = secretNames ? new Set(secretNames) : new Set();
  let requiredSecretsPresent = true;
  for (const name of REQUIRED_SECRET_NAMES) {
    const present = secretSet.has(name);
    if (!present) {
      requiredSecretsPresent = false;
      failures.push(`missing_secret_name_${name.toLowerCase()}`);
    }
  }
  checks.requiredSecretsPresent = requiredSecretsPresent;
  const boundedSecretSet =
    secretNames !== null &&
    secretSet.size === secretNames.length &&
    secretNames.every((name) => ALLOWED_RUNTIME_NAMES.includes(name));
  addCheck(checks, failures, "secretNamesBounded", boundedSecretSet, "runtime_names_invalid");

  const r2 = inspectRecord(root.r2, ["bucket", "objectLock", "retentionDays", "lifecycleDays"]);
  addCheck(
    checks,
    failures,
    "r2Bucket",
    r2?.bucket === "earnest-mls-evidence",
    "r2_bucket_invalid",
  );
  addCheck(
    checks,
    failures,
    "r2Lock",
    r2?.objectLock === "COMPLIANCE" && r2.retentionDays === 90,
    "r2_lock_invalid",
  );
  addCheck(checks, failures, "r2Lifecycle", r2?.lifecycleDays === 90, "r2_lifecycle_invalid");

  const frozen = frozenFailures(failures);
  const identity =
    deploymentIdentity && commitIdentity
      ? Object.freeze({
          deploymentId: workflow.deploymentId,
          commitSha: workflow.commitSha,
        })
      : null;
  return freezeResult({
    accepted: frozen.length === 0,
    failures: frozen,
    checks: Object.freeze({ ...checks }),
    identity,
  });
}

function inspectIdentity(value) {
  const identity = inspectRecord(value, IDENTITY_KEYS);
  if (!identity) return null;
  if (
    !validAttempt(identity.attemptId) ||
    !validIdentifier(identity.workflowId) ||
    !validIdentifier(identity.deploymentId) ||
    !isString(identity.commitSha, COMMIT_SHA) ||
    !isString(identity.runId, UUID) ||
    typeof identity.evidencePrefix !== "string"
  ) {
    return null;
  }
  const prefix = expectedPrefix(identity.attemptId, identity.runId);
  if (identity.evidencePrefix !== prefix) return null;
  return identity;
}

export function verifyShadowEvidence(snapshot) {
  const failures = [];
  const checkEntries = [];
  const root = inspectRecord(snapshot, EVIDENCE_KEYS);
  const rawIdentity = root ? inspectRecord(root.identity, IDENTITY_KEYS) : null;
  const identity = root ? inspectIdentity(root.identity) : null;

  const identityValid = identity !== null;
  checkEntries.push(["shadowIdentity", identityValid]);
  if (!identityValid) {
    failures.push(
      rawIdentity !== null && !validAttempt(rawIdentity.attemptId)
        ? "attempt_id_invalid"
        : "shadow_identity_invalid",
    );
  }

  if (!root) {
    return freezeResult({
      accepted: false,
      failures: frozenFailures(failures),
      checks: makeChecks(checkEntries),
      identity: null,
      manifest: null,
    });
  }

  if (!identityValid) {
    return freezeResult({
      accepted: false,
      failures: frozenFailures(failures),
      checks: makeChecks(checkEntries),
      identity: null,
      manifest: null,
    });
  }

  const workflow = inspectRecord(root.workflow, ["attemptId", "deploymentId", "state"]);
  const workflowAttempt =
    identityValid && workflow !== null && workflow.attemptId === identity.attemptId;
  checkEntries.push(["workflowAttempt", workflowAttempt]);
  if (!workflowAttempt) failures.push("workflow_attempt_mismatch");

  const workflowDeployment =
    identityValid && workflow !== null && workflow.deploymentId === identity.deploymentId;
  checkEntries.push(["workflowDeployment", workflowDeployment]);
  if (!workflowDeployment) failures.push("workflow_deployment_mismatch");

  const workflowSuccessful = workflow !== null && workflow.state === "succeeded";
  checkEntries.push(["workflowSuccessful", workflowSuccessful]);
  if (!workflowSuccessful) failures.push("workflow_not_successful");

  const container = inspectRecord(root.container, ["deploymentId", "state", "exitCode"]);
  const containerSuccessful =
    identityValid &&
    container !== null &&
    container.deploymentId === identity.deploymentId &&
    container.state === "succeeded" &&
    container.exitCode === 0;
  checkEntries.push(["containerSuccessful", containerSuccessful]);
  if (!containerSuccessful) failures.push("container_not_successful");

  const run = inspectRecord(root.run, IDENTITY_KEYS);
  const runIdentity =
    identityValid &&
    run !== null &&
    run.attemptId === identity.attemptId &&
    run.workflowId === identity.workflowId &&
    run.deploymentId === identity.deploymentId &&
    run.commitSha === identity.commitSha &&
    run.runId === identity.runId;
  checkEntries.push(["runIdentity", runIdentity]);
  if (!runIdentity) failures.push("run_identity_mismatch");

  const r2 = inspectRecord(root.r2, [
    "evidencePrefix",
    "manifestPresent",
    "manifestSha256",
    "objectKeys",
    "objects",
    "manifest",
  ]);
  const evidencePrefix =
    identityValid &&
    run !== null &&
    r2 !== null &&
    run.evidencePrefix === identity.evidencePrefix &&
    r2.evidencePrefix === identity.evidencePrefix;
  checkEntries.push(["evidencePrefix", evidencePrefix]);
  if (!evidencePrefix) failures.push("evidence_prefix_mismatch");

  const statusRoute = inspectRecord(root.statusRoute, [
    "attemptId",
    "state",
    "exitCode",
    "manifestPresent",
  ]);
  const manifestPresent = r2?.manifestPresent === true && statusRoute?.manifestPresent === true;
  checkEntries.push(["manifestPresent", manifestPresent]);
  if (!manifestPresent) failures.push("manifest_missing");

  const sources = inspectRecord(root.sources, ["configured", "health"]);
  const configuredSources = sources
    ? validStringArray(sources.configured, (source) => isString(source, SOURCE))
    : null;
  const health = sources ? inspectDynamicRecord(sources.health) : null;
  const sourceHealth =
    configuredSources !== null &&
    configuredSources.length > 0 &&
    new Set(configuredSources).size === configuredSources.length &&
    health !== null &&
    Reflect.ownKeys(health).length === configuredSources.length &&
    configuredSources.every((source) => Object.hasOwn(health, source) && health[source] === "full");
  checkEntries.push(["sourceHealth", sourceHealth]);
  if (!sourceHealth) failures.push("source_health_not_full");

  const neon = inspectRecord(root.neon, ["shadow", "healthy", "lockReleased"]);
  const neonHealthy = neon?.shadow === true && neon.healthy === true && neon.lockReleased === true;
  checkEntries.push(["neonShadowHealthy", neonHealthy]);
  if (!neonHealthy) failures.push("neon_shadow_not_healthy");

  const manifestEvidence = captureEvidenceManifest(r2, identity);
  const manifestValid = manifestEvidence !== null;
  checkEntries.push(["manifestValid", manifestValid]);
  if (!manifestValid) failures.push("manifest_invalid");

  const statusMatches =
    identityValid &&
    statusRoute !== null &&
    statusRoute.attemptId === identity.attemptId &&
    statusRoute.state === "succeeded" &&
    statusRoute.exitCode === 0;
  checkEntries.push(["statusRoute", statusMatches]);
  if (!statusMatches) failures.push("status_route_mismatch");

  const sideEffects = inspectRecord(root.sideEffects, ["blobUploads", "publicationAttempts"]);
  const noBlobUploads = sideEffects?.blobUploads === 0;
  checkEntries.push(["noBlobUploads", noBlobUploads]);
  if (!noBlobUploads) failures.push("blob_side_effect_detected");
  const noPublication = sideEffects?.publicationAttempts === 0;
  checkEntries.push(["noPublication", noPublication]);
  if (!noPublication) failures.push("publication_side_effect_detected");

  const redaction = inspectRecord(root.redaction, ["secretsAbsent", "credentialPatternsAbsent"]);
  const redactionPassed =
    redaction?.secretsAbsent === true && redaction.credentialPatternsAbsent === true;
  checkEntries.push(["redaction", redactionPassed]);
  if (!redactionPassed) failures.push("redaction_check_failed");

  const frozen = frozenFailures(failures);
  const identitySnapshot = identityValid
    ? Object.freeze(Object.fromEntries(IDENTITY_KEYS.map((key) => [key, identity[key]])))
    : null;
  return freezeResult({
    accepted: frozen.length === 0,
    failures: frozen,
    checks: makeChecks(checkEntries),
    identity: identitySnapshot,
    manifest: manifestEvidence,
  });
}

function snapshotBooleanChecks(value, expectedKeys) {
  const record = inspectRecord(value, expectedKeys);
  if (!record) return null;
  if (expectedKeys.some((key) => record[key] !== true)) {
    return null;
  }
  return Object.freeze(Object.fromEntries(expectedKeys.map((key) => [key, record[key]])));
}

function acceptedPreflightResult(value) {
  const result = inspectRecord(value, ["accepted", "failures", "checks", "identity"]);
  if (!result || result.accepted !== true) return null;
  const failures = inspectArray(result.failures);
  const checks = snapshotBooleanChecks(result.checks, PREFLIGHT_CHECK_KEYS);
  const identity = inspectRecord(result.identity, PREFLIGHT_IDENTITY_KEYS);
  if (
    !failures ||
    failures.length !== 0 ||
    !checks ||
    !identity ||
    !validIdentifier(identity.deploymentId) ||
    !isString(identity.commitSha, COMMIT_SHA)
  ) {
    return null;
  }
  return { checks, identity: Object.freeze({ ...identity }) };
}

function acceptedEvidenceResult(value) {
  const result = inspectRecord(value, ["accepted", "failures", "checks", "identity", "manifest"]);
  if (!result || result.accepted !== true) return null;
  const failures = inspectArray(result.failures);
  const checks = snapshotBooleanChecks(result.checks, EVIDENCE_CHECK_KEYS);
  const identity = inspectIdentity(result.identity);
  const manifest = captureAcceptedManifest(result.manifest, identity);
  if (!failures || failures.length !== 0 || !checks || !identity || !manifest) {
    return null;
  }
  return { checks, identity, manifest };
}

function validCheckedAt(value) {
  return validUtcTimestamp(value);
}

export function buildShadowAcceptanceRecord(input) {
  const value = inspectRecord(input, ["preflight", "evidence", "checkedAt"]);
  if (!value) throw new TypeError("acceptance input must be an exact data record");

  const preflight = acceptedPreflightResult(value.preflight);
  const evidence = acceptedEvidenceResult(value.evidence);
  if (!preflight || !evidence) {
    throw new TypeError("accepted preflight and evidence are required");
  }
  if (!validCheckedAt(value.checkedAt)) {
    throw new TypeError("checkedAt must be a millisecond UTC timestamp");
  }

  if (
    preflight.identity.deploymentId !== evidence.manifest.containerDeploymentId ||
    preflight.identity.commitSha !== evidence.manifest.commitSha
  ) {
    throw new TypeError("preflight and manifest provenance must match");
  }
  const identity = Object.freeze(
    Object.fromEntries(IDENTITY_KEYS.map((key) => [key, evidence.identity[key]])),
  );
  return Object.freeze({
    accepted: true,
    checkedAt: value.checkedAt,
    preflightChecks: preflight.checks,
    evidenceChecks: evidence.checks,
    identity,
    manifest: evidence.manifest,
  });
}

const MAX_CLI_JSON_BYTES = 256 * 1024;
const CLI_FAILURE = /^[a-z][a-z0-9_-]{0,79}$/;

function exactCliArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 6) return null;
  const [preflightFlag, preflightPath, evidenceFlag, evidencePath, outputFlag, outputPath] = argv;
  if (
    preflightFlag !== "--preflight" ||
    evidenceFlag !== "--evidence" ||
    outputFlag !== "--output" ||
    [preflightPath, evidencePath, outputPath].some(
      (value) => typeof value !== "string" || value.length === 0,
    )
  ) {
    return null;
  }
  return { preflightPath, evidencePath, outputPath };
}

async function readBoundedJson(filePath, openFile) {
  const handle = await openFile(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(MAX_CLI_JSON_BYTES + 1);
    let totalBytes = 0;
    while (totalBytes < buffer.length) {
      const remainingBytes = buffer.length - totalBytes;
      const { bytesRead } = await handle.read(buffer, totalBytes, remainingBytes, totalBytes);
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > remainingBytes) {
        throw new TypeError("cli_input_invalid");
      }
      totalBytes += bytesRead;
      if (bytesRead === 0) break;
    }
    if (totalBytes > MAX_CLI_JSON_BYTES) {
      throw new TypeError("cli_input_invalid");
    }
    return JSON.parse(buffer.subarray(0, totalBytes).toString("utf8"));
  } finally {
    await handle.close();
  }
}

function boundedFailures(...results) {
  const failures = [];
  for (const result of results) {
    for (const failure of result.failures) {
      if (typeof failure === "string" && CLI_FAILURE.test(failure)) {
        failures.push(failure);
      }
    }
  }
  return [...new Set(failures)];
}

function writeDiagnostic(write, code) {
  try {
    write(`${code}\n`);
  } catch {
    // Diagnostics must not change the CLI result or disclose thrown error details.
  }
}

async function ensureOutputParent(outputPath, makeDirectory) {
  const parent = dirname(outputPath);
  try {
    await makeDirectory(parent);
  } catch (error) {
    if (error?.code !== "EEXIST") throw new TypeError("cli_output_invalid");
  }
}

export async function main(argv, dependencies = {}) {
  const {
    open: openFile = open,
    writeFile: write = writeFile,
    mkdir: makeDirectory = mkdir,
    now = () => new Date(),
    writeStderr = (value) => process.stderr.write(value),
  } = dependencies;
  const arguments_ = exactCliArguments(argv);
  if (!arguments_) {
    writeDiagnostic(writeStderr, "cli_input_invalid");
    return 2;
  }

  let preflight;
  let evidence;
  try {
    [preflight, evidence] = await Promise.all([
      readBoundedJson(arguments_.preflightPath, openFile),
      readBoundedJson(arguments_.evidencePath, openFile),
    ]);
  } catch {
    writeDiagnostic(writeStderr, "cli_input_invalid");
    return 2;
  }

  let record;
  let exitCode;
  try {
    const preflightResult = verifyShadowPreflight(preflight);
    const evidenceResult = verifyShadowEvidence(evidence);
    if (preflightResult.accepted && evidenceResult.accepted) {
      record = buildShadowAcceptanceRecord({
        preflight: preflightResult,
        evidence: evidenceResult,
        checkedAt: now().toISOString(),
      });
      exitCode = 0;
    } else {
      const failures = boundedFailures(preflightResult, evidenceResult);
      record = {
        accepted: false,
        failures: failures.length > 0 ? failures : ["shadow_verification_failed"],
      };
      exitCode = 30;
    }
  } catch {
    writeDiagnostic(writeStderr, "cli_input_invalid");
    return 2;
  }

  try {
    await ensureOutputParent(arguments_.outputPath, makeDirectory);
    await write(arguments_.outputPath, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    writeDiagnostic(writeStderr, "cli_output_invalid");
    return 2;
  }
  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const exitCode = await main(process.argv.slice(2));
  process.exitCode = exitCode;
}
