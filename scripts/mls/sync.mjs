import { randomUUID } from "node:crypto";
import { access, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { create28HseAgentSourceAdapter } from "../../src/lib/mls/sources/28hse-agent.mjs";
import { createOldSiteSourceAdapter } from "../../src/lib/mls/sources/old-site.mjs";
import {
  createFilesystemReporter,
  logRunEvent,
  pruneArtifacts,
  validateArtifactRoot,
} from "../../src/lib/mls/reporting.mjs";
import {
  createR2Reporter,
  createR2S3ObjectStore,
} from "../../src/lib/mls/r2-reporting.mjs";
import { createVercelBlobStore } from "../../src/lib/media/vercel-blob.mjs";
import { prepareListingMedia } from "../../src/lib/mls/media.mjs";
import { withMlsAdvisoryLock } from "../../src/lib/mls/neon-lock.mjs";
import { runDualSourceSync } from "../../src/lib/mls/orchestrator.mjs";
import { createSyncRepository } from "../../src/lib/mls/sync-repository.mjs";
import { MLS_PARSER_VERSION } from "../../src/lib/mls/source-contract.mjs";

export class MlsConfigurationError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "MlsConfigurationError";
    this.code = code;
  }
}

function literalTrue(value) {
  return value === "true";
}

function parseMode(argv = []) {
  let mode = "shadow";
  for (const argument of argv) {
    if (argument === "--mode=shadow") mode = "shadow";
    else if (argument === "--mode=publish") mode = "publish";
    else throw new MlsConfigurationError("invalid_mode");
  }
  return mode;
}

function environmentValue(environment, name) {
  if (
    !environment ||
    typeof environment !== "object" ||
    Array.isArray(environment)
  ) {
    throw new MlsConfigurationError("invalid_environment");
  }
  const descriptor = Object.getOwnPropertyDescriptor(environment, name);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw new MlsConfigurationError(`invalid_${name.toLowerCase()}`);
  }
  return descriptor.value;
}

function optionalEnvironment(environment, name) {
  const value = environmentValue(environment, name);
  if (value == null) return "";
  if (typeof value !== "string") {
    throw new MlsConfigurationError(`invalid_${name.toLowerCase()}`);
  }
  return value.trim();
}

function requiredEnvironment(environment, name) {
  const value = optionalEnvironment(environment, name);
  if (!value) throw new MlsConfigurationError(`missing_${name.toLowerCase()}`);
  return value;
}

function validateDatabaseUrl(value) {
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) {
      throw new Error("invalid protocol");
    }
  } catch {
    throw new MlsConfigurationError("invalid_database_url");
  }
  return value;
}

function validateContactUrl(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      throw new Error("invalid contact URL");
    }
  } catch {
    throw new MlsConfigurationError("invalid_crawler_contact_url");
  }
  return value;
}

function parseMediaHosts(value) {
  const hosts = value
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (hosts.length === 0 || new Set(hosts).size !== hosts.length) {
    throw new MlsConfigurationError("invalid_media_allowed_hosts");
  }
  for (const host of hosts) {
    if (host.includes("/") || host.includes("@") || host.includes(":")) {
      throw new MlsConfigurationError("invalid_media_allowed_hosts");
    }
    try {
      const parsed = new URL(`https://${host}`);
      if (parsed.hostname !== host || parsed.pathname !== "/") {
        throw new Error("invalid host");
      }
    } catch {
      throw new MlsConfigurationError("invalid_media_allowed_hosts");
    }
  }
  return Object.freeze(hosts);
}

export async function loadEnvironmentFiles({ cwd = process.cwd() } = {}) {
  if (typeof process.loadEnvFile !== "function") return;
  for (const filename of [".env", ".env.local"]) {
    const file = path.join(cwd, filename);
    try {
      await access(file);
    } catch {
      continue;
    }
    process.loadEnvFile(file);
  }
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

function safeIdentity(value, name) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) ||
    value.includes("..")
  ) {
    throw new MlsConfigurationError(`invalid_${name.toLowerCase()}`);
  }
  return value;
}

function requireTimestamp(value, name) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    new Date(value).toISOString() !== value
  ) {
    throw new MlsConfigurationError(`invalid_${name.toLowerCase()}`);
  }
  return value;
}

function requireTerminalStatusFile(value) {
  const pathApi =
    typeof value === "string" && value.startsWith("/") ? path.posix : path;
  if (
    typeof value !== "string" ||
    !pathApi.isAbsolute(value) ||
    value.includes("\0") ||
    value.split(/[\\/]+/).includes("..") ||
    pathApi.basename(value) !== "earnest-mls-terminal.json"
  ) {
    throw new MlsConfigurationError("invalid_mls_terminal_status_file");
  }
  return pathApi.normalize(value);
}

function requireR2RunIdentity(environment) {
  const scheduledFor = requiredEnvironment(environment, "MLS_SCHEDULED_FOR");
  if (!validDate(scheduledFor)) {
    throw new MlsConfigurationError("invalid_mls_scheduled_for");
  }
  const runEnvironment = requiredEnvironment(environment, "MLS_ENVIRONMENT");
  if (!/^(preview|production)$/.test(runEnvironment)) {
    throw new MlsConfigurationError("invalid_mls_environment");
  }
  const attemptId = requiredEnvironment(environment, "MLS_ATTEMPT_ID");
  const scheduledAttemptId = `scheduled:${runEnvironment}:${scheduledFor}`;
  const manualSuffix = attemptId.slice(`${scheduledAttemptId}:manual:`.length);
  if (
    attemptId !== scheduledAttemptId &&
    (!attemptId.startsWith(`${scheduledAttemptId}:manual:`) ||
      !/^[a-z0-9][a-z0-9-]{7,63}$/.test(manualSuffix))
  ) {
    throw new MlsConfigurationError("invalid_mls_attempt_id");
  }
  const commitSha = requiredEnvironment(environment, "MLS_COMMIT_SHA");
  if (!/^[0-9a-f]{40}$/.test(commitSha)) {
    throw new MlsConfigurationError("invalid_mls_commit_sha");
  }
  return Object.freeze({
    scheduledFor,
    environment: runEnvironment,
    attemptId,
    commitSha,
    containerDeploymentId: safeIdentity(
      requiredEnvironment(environment, "CLOUDFLARE_DEPLOYMENT_ID"),
      "CLOUDFLARE_DEPLOYMENT_ID",
    ),
    workflowInstanceId: safeIdentity(
      requiredEnvironment(environment, "MLS_WORKFLOW_INSTANCE_ID"),
      "MLS_WORKFLOW_INSTANCE_ID",
    ),
    containerId: safeIdentity(
      requiredEnvironment(environment, "MLS_CONTAINER_ID"),
      "MLS_CONTAINER_ID",
    ),
    attemptStartedAt: requireTimestamp(
      requiredEnvironment(environment, "MLS_ATTEMPT_STARTED_AT"),
      "MLS_ATTEMPT_STARTED_AT",
    ),
    terminalStatusFile: requireTerminalStatusFile(
      requiredEnvironment(environment, "MLS_TERMINAL_STATUS_FILE"),
    ),
  });
}

export function readConfiguration(mode, environment = process.env) {
  if (mode !== "shadow" && mode !== "publish") {
    throw new MlsConfigurationError("invalid_mode");
  }
  const databaseUrl = validateDatabaseUrl(
    requiredEnvironment(environment, "DATABASE_URL_UNPOOLED"),
  );
  const contactUrl = validateContactUrl(
    requiredEnvironment(environment, "MLS_CRAWLER_CONTACT_URL"),
  );
  const mediaAllowedHosts = parseMediaHosts(
    requiredEnvironment(environment, "MLS_MEDIA_ALLOWED_HOSTS"),
  );
  const publishEnabled = literalTrue(
    optionalEnvironment(environment, "MLS_PUBLISH_ENABLED"),
  );
  const mediaRightsConfirmed = literalTrue(
    optionalEnvironment(environment, "MLS_MEDIA_RIGHTS_CONFIRMED"),
  );
  if (mode === "publish" && !publishEnabled) {
    throw new MlsConfigurationError("publication_disabled");
  }
  if (mode === "publish" && !mediaRightsConfirmed) {
    throw new MlsConfigurationError("media_rights_not_confirmed");
  }
  const blobToken = optionalEnvironment(environment, "BLOB_READ_WRITE_TOKEN");
  if (mode === "publish" && !blobToken) {
    throw new MlsConfigurationError("missing_blob_read_write_token");
  }
  const evidenceBackend =
    optionalEnvironment(environment, "MLS_EVIDENCE_BACKEND") || "filesystem";
  if (!/^(filesystem|r2)$/.test(evidenceBackend)) {
    throw new MlsConfigurationError("invalid_mls_evidence_backend");
  }
  const identity =
    evidenceBackend === "r2"
      ? requireR2RunIdentity(environment)
      : Object.freeze({
          scheduledFor: scheduledForHongKong(),
          environment: "local",
          attemptId: "manual-local",
          commitSha: "0".repeat(40),
          containerDeploymentId: "local",
          workflowInstanceId: "manual-local",
          containerId: "local",
          attemptStartedAt: null,
          terminalStatusFile: null,
        });
  const evidence =
    evidenceBackend === "r2"
      ? Object.freeze({
          accountId: requiredEnvironment(environment, "CLOUDFLARE_ACCOUNT_ID"),
          bucket: requiredEnvironment(environment, "MLS_EVIDENCE_BUCKET"),
          accessKeyId: requiredEnvironment(environment, "MLS_R2_ACCESS_KEY_ID"),
          secretAccessKey: requiredEnvironment(
            environment,
            "MLS_R2_SECRET_ACCESS_KEY",
          ),
        })
      : Object.freeze({
          artifactRoot: requiredEnvironment(environment, "MLS_ARTIFACT_DIR"),
        });
  return Object.freeze({
    mode,
    databaseUrl,
    contactUrl,
    mediaAllowedHosts,
    publishEnabled,
    mediaRightsConfirmed,
    ...(mode === "publish" ? { blobToken } : {}),
    evidenceBackend,
    ...identity,
    evidence,
  });
}

export function scheduledForHongKong(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf()))
    throw new TypeError("now is invalid");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

const R2_ARTIFACT_NAMES = [
  "report.json",
  "listings.csv",
  "observations.csv",
  "diagnostics.json",
];
const R2_ARTIFACT_KEYS = ["name", "key", "byteLength", "contentType", "sha256"];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_RECORD_KEYS = [
  "attemptId",
  "runId",
  "neonRunId",
  "status",
  "exitCode",
  "failureCode",
  "evidencePrefix",
  "manifestKey",
  "manifestPresent",
];

function captureExactDataRecord(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  const captured = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`${label} is invalid`);
    }
    captured[key] = descriptor.value;
  }
  return Object.freeze(captured);
}

function captureDataField(value, key, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) {
    throw new TypeError(`${label} is invalid`);
  }
  return descriptor.value;
}

function captureArtifactResult(value) {
  const result = captureExactDataRecord(
    value,
    ["prefix", "objects"],
    "artifact result",
  );
  if (typeof result.prefix !== "string" || !result.prefix) {
    throw new TypeError("artifact result is invalid");
  }
  if (
    !Array.isArray(result.objects) ||
    result.objects.length !== R2_ARTIFACT_NAMES.length
  ) {
    throw new TypeError("artifact result is incomplete");
  }
  const objects = result.objects.map((artifact, index) => {
    const captured = captureExactDataRecord(
      artifact,
      R2_ARTIFACT_KEYS,
      `artifact result ${index}`,
    );
    if (captured.name !== R2_ARTIFACT_NAMES[index]) {
      throw new TypeError("artifact result is incomplete");
    }
    return captured;
  });
  return Object.freeze({
    prefix: result.prefix,
    objects: Object.freeze(objects),
  });
}

function boundedTerminalStatus(outcome, error) {
  const status =
    outcome && typeof outcome === "object" && typeof outcome.status === "string"
      ? outcome.status
      : "error";
  const terminalClassification =
    error?.code === "publication_outcome_unknown" || status === "unknown"
      ? "outcome-unknown"
      : outcome?.kind === "lock_unavailable" || status === "lock_unavailable"
        ? "lock"
        : status === "degraded"
          ? "degraded"
          : status === "blocked"
            ? "blocked"
            : status === "healthy" || status === "shadow_healthy"
              ? "healthy"
              : "error";
  return Object.freeze({ status, terminalClassification });
}

function safeTerminalAttemptId(value) {
  return (
    value === "manual-local" ||
    (typeof value === "string" &&
      /^scheduled:(preview|production):\d{4}-\d{2}-\d{2}(?::manual:[a-z0-9][a-z0-9-]{7,63})?$/.test(
        value,
      ))
  );
}

function safeTerminalText(
  value,
  label,
  { nullable = false, manifest = false } = {},
) {
  if (nullable && value === null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value.includes("..") ||
    value.startsWith("/") ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value) ||
    (manifest && !value.endsWith("/manifest.json"))
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function captureTerminalRecord(record, evidenceBackend) {
  const captured = captureExactDataRecord(
    record,
    TERMINAL_RECORD_KEYS,
    "terminal record",
  );
  if (!safeTerminalAttemptId(captured.attemptId)) {
    throw new TypeError("terminal record is invalid");
  }
  if (
    captured.runId !== null &&
    (typeof captured.runId !== "string" || !UUID_PATTERN.test(captured.runId))
  ) {
    throw new TypeError("terminal record is invalid");
  }
  if (
    captured.neonRunId !== null &&
    (typeof captured.neonRunId !== "string" ||
      !UUID_PATTERN.test(captured.neonRunId))
  ) {
    throw new TypeError("terminal record is invalid");
  }
  if (!/^(succeeded|failed|degraded|blocked|unknown)$/.test(captured.status)) {
    throw new TypeError("terminal record is invalid");
  }
  if (
    !Number.isInteger(captured.exitCode) ||
    captured.exitCode < 0 ||
    captured.exitCode > 255
  ) {
    throw new TypeError("terminal record is invalid");
  }
  if (
    captured.failureCode !== null &&
    (typeof captured.failureCode !== "string" ||
      !/^[a-z][a-z0-9_-]{0,79}$/.test(captured.failureCode))
  ) {
    throw new TypeError("terminal record is invalid");
  }
  safeTerminalText(captured.evidencePrefix, "evidencePrefix", {
    nullable: true,
  });
  safeTerminalText(captured.manifestKey, "manifestKey", {
    nullable: true,
    manifest: true,
  });
  if (typeof captured.manifestPresent !== "boolean") {
    throw new TypeError("terminal record is invalid");
  }
  if (
    evidenceBackend === "r2" &&
    (!captured.manifestPresent || !captured.manifestKey)
  ) {
    return Object.freeze({
      ...captured,
      status: captured.status === "succeeded" ? "unknown" : captured.status,
      failureCode: captured.failureCode ?? "terminal_manifest_missing",
      manifestKey: null,
      manifestPresent: false,
    });
  }
  return captured;
}

export async function writeTerminalStatusRecord({
  statusFile,
  record,
  evidenceBackend,
  dependencies = { writeFile, rename, rm, randomUUID },
}) {
  const target = requireTerminalStatusFile(statusFile);
  if (!/^(filesystem|r2)$/.test(evidenceBackend)) {
    throw new TypeError("evidence backend is invalid");
  }
  if (
    !dependencies ||
    typeof dependencies.writeFile !== "function" ||
    typeof dependencies.rename !== "function" ||
    typeof dependencies.rm !== "function" ||
    typeof dependencies.randomUUID !== "function"
  ) {
    throw new TypeError("terminal status dependencies are invalid");
  }
  const captured = captureTerminalRecord(record, evidenceBackend);
  const pathApi = target.startsWith("/") ? path.posix : path;
  const temporary = pathApi.join(
    pathApi.dirname(target),
    `.${pathApi.basename(target)}.${dependencies.randomUUID()}.tmp`,
  );
  try {
    await dependencies.writeFile(temporary, `${JSON.stringify(captured)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await dependencies.rename(temporary, target);
  } catch (error) {
    await dependencies.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return captured;
}

export function createEvidenceReporter({ configuration, dependencies }) {
  if (!configuration || typeof configuration !== "object") {
    throw new TypeError("configuration is required");
  }
  if (!dependencies || typeof dependencies !== "object") {
    throw new TypeError("dependencies are required");
  }
  if (configuration.evidenceBackend === "filesystem") {
    const root = configuration.evidence?.artifactRoot;
    const reporter = dependencies.createFilesystemReporter({ root });
    return Object.freeze({
      reporter,
      getEvidenceState() {
        return Object.freeze({
          evidencePrefix: null,
          manifestKey: null,
          manifestPresent: false,
        });
      },
      async finalize() {
        await dependencies.pruneArtifacts({ root, retentionDays: 90 });
        return Object.freeze({ manifestKey: null, manifestPresent: false });
      },
    });
  }
  if (configuration.evidenceBackend === "r2") {
    const objectStore = dependencies.createR2S3ObjectStore(
      configuration.evidence,
    );
    const r2Reporter = dependencies.createR2Reporter({
      objectStore,
      context: {
        environment: configuration.environment,
        hkDate: configuration.scheduledFor,
        attemptId: configuration.attemptId,
        mode: configuration.mode,
        commitSha: configuration.commitSha,
        containerDeploymentId: configuration.containerDeploymentId,
        workflowInstanceId: configuration.workflowInstanceId,
        containerId: configuration.containerId,
      },
    });
    let artifactResult = null;
    let artifactRunId = null;
    let manifestKey = null;
    let finalizeAttempted = false;
    const reporter = Object.freeze({
      async writeRunArtifacts(run) {
        const runId = captureDataField(run, "runId", "run");
        if (typeof runId !== "string" || !UUID_PATTERN.test(runId)) {
          throw new TypeError("run is invalid");
        }
        const result = captureArtifactResult(
          await r2Reporter.writeRunArtifacts(run),
        );
        artifactRunId = runId;
        artifactResult = result;
        return result;
      },
    });
    return Object.freeze({
      reporter,
      getEvidenceState() {
        return Object.freeze({
          evidencePrefix: artifactResult?.prefix ?? null,
          manifestKey,
          manifestPresent: manifestKey !== null,
        });
      },
      async finalize({ outcome, error, exitCode, completedAt } = {}) {
        if (finalizeAttempted) {
          throw new Error("R2 terminal finalization was already attempted");
        }
        if (!artifactResult || !artifactRunId) {
          throw new TypeError("R2 artifact result is incomplete");
        }
        if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
          throw new TypeError("exitCode is invalid");
        }
        const completed = requireTimestamp(completedAt, "completedAt");
        const started = configuration.attemptStartedAt;
        const durationMs = Date.parse(completed) - Date.parse(started);
        if (durationMs < 0) throw new TypeError("completedAt is invalid");
        const terminal = boundedTerminalStatus(outcome, error);
        finalizeAttempted = true;
        const result = await r2Reporter.finalizeTerminal({
          runId: artifactRunId,
          status: terminal.status,
          terminalClassification: terminal.terminalClassification,
          exitCode,
          startedAt: started,
          completedAt: completed,
          durationMs,
          neonRunId: UUID_PATTERN.test(artifactRunId) ? artifactRunId : null,
          artifactObjects: artifactResult.objects,
        });
        const manifest = captureExactDataRecord(
          result,
          ["manifestKey"],
          "manifest result",
        );
        if (typeof manifest.manifestKey !== "string" || !manifest.manifestKey) {
          throw new TypeError("manifest result is invalid");
        }
        manifestKey = manifest.manifestKey;
        return Object.freeze({
          manifestKey: manifest.manifestKey,
          manifestPresent: true,
        });
      },
    });
  }
  throw new TypeError("evidence backend is invalid");
}

function installSignalHandlers(controller) {
  let interrupted = false;
  const handle = () => {
    if (interrupted) {
      process.exit(130);
      return;
    }
    interrupted = true;
    controller.abort(new Error("process_interrupted"));
  };
  process.once("SIGINT", handle);
  process.once("SIGTERM", handle);
  return () => {
    process.removeListener("SIGINT", handle);
    process.removeListener("SIGTERM", handle);
  };
}

function exitCodeForOutcome(outcome) {
  if (outcome?.kind === "lock_unavailable") return 75;
  if (outcome?.status === "shadow_healthy" || outcome?.status === "healthy")
    return 0;
  if (outcome?.status === "degraded") return 2;
  if (outcome?.status === "blocked") {
    return outcome.gate?.mode === "blocked" ? 20 : 30;
  }
  return 40;
}

function terminalRecordFor({
  configuration,
  outcome,
  error,
  exitCode,
  evidence,
}) {
  const runId =
    outcome && typeof outcome === "object" && Object.hasOwn(outcome, "runId")
      ? captureDataField(outcome, "runId", "outcome")
      : null;
  const terminal = boundedTerminalStatus(outcome, error);
  const success =
    exitCode === 0 &&
    (terminal.terminalClassification === "healthy" ||
      terminal.terminalClassification === "degraded") &&
    (configuration.evidenceBackend !== "r2" ||
      evidence.manifestPresent === true);
  return {
    attemptId: configuration.attemptId,
    runId: typeof runId === "string" && UUID_PATTERN.test(runId) ? runId : null,
    neonRunId:
      typeof runId === "string" && UUID_PATTERN.test(runId) ? runId : null,
    status: success
      ? "succeeded"
      : terminal.terminalClassification === "degraded"
        ? "degraded"
        : terminal.terminalClassification === "blocked" ||
            terminal.terminalClassification === "lock"
          ? "blocked"
          : terminal.terminalClassification === "outcome-unknown" ||
              (configuration.evidenceBackend === "r2" &&
                !evidence.manifestPresent)
            ? "unknown"
            : "failed",
    exitCode,
    failureCode: success
      ? null
      : configuration.evidenceBackend === "r2" && !evidence.manifestPresent
        ? "terminal_manifest_missing"
        : terminal.terminalClassification === "lock"
          ? "lock_unavailable"
          : terminal.terminalClassification === "outcome-unknown"
            ? "publication_outcome_unknown"
            : error?.code && /^[a-z][a-z0-9_-]{0,79}$/.test(error.code)
              ? error.code
              : "mls_run_failed",
    evidencePrefix: evidence.evidencePrefix,
    manifestKey: evidence.manifestKey,
    manifestPresent: evidence.manifestPresent,
  };
}

export async function main(argv = process.argv.slice(2), overrides = {}) {
  const dependencies = {
    environment: process.env,
    loadEnvironmentFiles,
    createEvidenceReporter,
    createFilesystemReporter,
    createR2S3ObjectStore,
    createR2Reporter,
    pruneArtifacts,
    validateArtifactRoot,
    createVercelBlobStore,
    withMlsAdvisoryLock,
    createSyncRepository,
    createOldSiteSourceAdapter,
    create28HseAgentSourceAdapter,
    runDualSourceSync,
    prepareListingMedia,
    logRunEvent,
    writeTerminalStatusRecord,
    now: () => new Date(),
    ...overrides,
  };
  let mode;
  let configuration;
  try {
    mode = parseMode(argv);
    await dependencies.loadEnvironmentFiles();
    configuration = readConfiguration(mode, dependencies.environment);
  } catch (error) {
    dependencies.logRunEvent({
      level: "error",
      event: "mls_configuration_rejected",
      code: error.code ?? "invalid_configuration",
    });
    return 30;
  }

  const persistEarlyTerminalFailure = async (failureCode) => {
    if (!configuration.terminalStatusFile) return;
    try {
      await dependencies.writeTerminalStatusRecord({
        statusFile: configuration.terminalStatusFile,
        evidenceBackend: configuration.evidenceBackend,
        record: {
          attemptId: configuration.attemptId,
          runId: null,
          neonRunId: null,
          status: "failed",
          exitCode: 30,
          failureCode,
          evidencePrefix: null,
          manifestKey: null,
          manifestPresent: false,
        },
      });
    } catch {
      dependencies.logRunEvent({
        level: "error",
        event: "mls_terminal_status_failed",
        code: "terminal_status_failed",
      });
    }
  };

  if (configuration.evidenceBackend === "filesystem") {
    try {
      dependencies.validateArtifactRoot(configuration.evidence.artifactRoot);
    } catch {
      dependencies.logRunEvent({
        level: "error",
        event: "mls_configuration_rejected",
        code: "unsafe_artifact_root",
      });
      await persistEarlyTerminalFailure("unsafe_artifact_root");
      return 30;
    }
  }

  let evidenceReporter;
  try {
    evidenceReporter = dependencies.createEvidenceReporter({
      configuration,
      dependencies: {
        createFilesystemReporter: dependencies.createFilesystemReporter,
        createR2S3ObjectStore: dependencies.createR2S3ObjectStore,
        createR2Reporter: dependencies.createR2Reporter,
        pruneArtifacts: dependencies.pruneArtifacts,
      },
    });
  } catch (error) {
    dependencies.logRunEvent({
      level: "error",
      event: "mls_configuration_rejected",
      code: error.code ?? "invalid_evidence_configuration",
    });
    await persistEarlyTerminalFailure("invalid_evidence_configuration");
    return 30;
  }

  let blobStore;
  try {
    blobStore =
      configuration.mode === "publish"
        ? dependencies.createVercelBlobStore({ token: configuration.blobToken })
        : undefined;
  } catch {
    dependencies.logRunEvent({
      level: "error",
      event: "mls_configuration_rejected",
      code: "invalid_blob_read_write_token",
    });
    await persistEarlyTerminalFailure("invalid_blob_read_write_token");
    return 30;
  }
  const now = dependencies.now();
  const controller = new AbortController();
  const removeSignalHandlers = installSignalHandlers(controller);
  const complete = async ({ outcome = null, error = null, exitCode }) => {
    let finalError = error;
    let effectiveExitCode = exitCode;
    try {
      await evidenceReporter.finalize({
        outcome,
        error,
        exitCode: effectiveExitCode,
        completedAt: dependencies.now().toISOString(),
      });
    } catch (finalizationError) {
      finalError ??= finalizationError;
      if (effectiveExitCode === 0) effectiveExitCode = 40;
      dependencies.logRunEvent({
        level: "error",
        event: "mls_evidence_finalization_failed",
        code: "evidence_finalization_failed",
      });
    }
    const evidence = evidenceReporter.getEvidenceState();
    if (
      configuration.evidenceBackend === "r2" &&
      (!evidence.manifestPresent || !evidence.manifestKey) &&
      effectiveExitCode === 0
    ) {
      effectiveExitCode = 40;
    }
    if (configuration.terminalStatusFile) {
      try {
        await dependencies.writeTerminalStatusRecord({
          statusFile: configuration.terminalStatusFile,
          evidenceBackend: configuration.evidenceBackend,
          record: terminalRecordFor({
            configuration,
            outcome,
            error: finalError,
            exitCode: effectiveExitCode,
            evidence,
          }),
        });
      } catch {
        if (effectiveExitCode === 0) effectiveExitCode = 40;
        dependencies.logRunEvent({
          level: "error",
          event: "mls_terminal_status_failed",
          code: "terminal_status_failed",
        });
      }
    }
    return effectiveExitCode;
  };
  try {
    const locked = await dependencies.withMlsAdvisoryLock({
      connectionString: configuration.databaseUrl,
      work: async (client) => {
        const repository = dependencies.createSyncRepository({ client });
        const oldSite = dependencies.createOldSiteSourceAdapter({
          fetchImpl: globalThis.fetch,
          signal: controller.signal,
          now: () => now,
        });
        const hse28 = dependencies.create28HseAgentSourceAdapter({
          fetchImpl: globalThis.fetch,
          signal: controller.signal,
          now: () => now,
        });
        return dependencies.runDualSourceSync({
          scheduledFor: configuration.scheduledFor,
          mode: configuration.mode,
          publishEnabled: configuration.publishEnabled,
          mediaRightsConfirmed: configuration.mediaRightsConfirmed,
          mediaAllowedHosts: configuration.mediaAllowedHosts,
          blobStore,
          parserVersion: MLS_PARSER_VERSION,
          adapters: { oldSite, hse28 },
          repository,
          media: { prepareListingMedia: dependencies.prepareListingMedia },
          reporter: evidenceReporter.reporter,
          signal: controller.signal,
          now: () => now,
        });
      },
    });
    if (locked?.kind === "lock_unavailable") {
      dependencies.logRunEvent({
        level: "warn",
        event: "mls_lock_unavailable",
        code: "lock_unavailable",
      });
      return complete({ outcome: locked, exitCode: 75 });
    }
    dependencies.logRunEvent({
      level:
        locked?.status === "healthy" || locked?.status === "shadow_healthy"
          ? "info"
          : "warn",
      event: "mls_run_finished",
      code: locked?.status ?? "unknown_status",
      runId: locked?.runId ?? null,
      counts: locked?.counts ?? {},
    });
    return complete({ outcome: locked, exitCode: exitCodeForOutcome(locked) });
  } catch (error) {
    dependencies.logRunEvent({
      level: "error",
      event: "mls_run_failed",
      code: error?.code ?? "mls_run_failed",
    });
    return complete({ error, exitCode: 40 });
  } finally {
    removeSignalHandlers();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().then((code) => {
    process.exitCode = code;
  });
}
