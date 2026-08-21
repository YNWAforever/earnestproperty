import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { buildRunArtifactObjects } from "./reporting.mjs";

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const OUTCOME_PATTERN = /^[a-z][a-z0-9_]{0,79}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MANUAL_ATTEMPT_SUFFIX_PATTERN = /^[a-z0-9][a-z0-9-]{7,63}$/;

const CONTEXT_KEYS = [
  "environment",
  "hkDate",
  "attemptId",
  "mode",
  "commitSha",
  "containerDeploymentId",
  "workflowInstanceId",
  "containerId",
];
const TERMINAL_KEYS = [
  "runId",
  "status",
  "terminalClassification",
  "exitCode",
  "startedAt",
  "completedAt",
  "durationMs",
  "neonRunId",
  "artifactObjects",
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
const ARTIFACT_KEYS = ["name", "key", "byteLength", "contentType", "sha256"];

function captureExactPlainRecord(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain record`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain record`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) {
    throw new TypeError(`${label} must contain exactly the required fields`);
  }
  const captured = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`${label}.${key} must be a plain data property`);
    }
    captured[key] = descriptor.value;
  }
  return Object.freeze(captured);
}

function capturePlainFields(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain record`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain record`);
  }
  const captured = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`${label}.${key} must be a plain data property`);
    }
    captured[key] = descriptor.value;
  }
  return Object.freeze(captured);
}

function isValidDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parts = value.split("-").map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.toISOString().slice(0, 10) === value;
}

function safeSegment(value, label) {
  if (
    typeof value !== "string" ||
    !SAFE_SEGMENT.test(value) ||
    value.includes("..")
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value.replaceAll(":", "-");
}

function requireOutcome(value, label) {
  if (typeof value !== "string" || !OUTCOME_PATTERN.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requireCanonicalUuid(value, label) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requireAttemptId({ environment, hkDate, attemptId }) {
  if (typeof attemptId !== "string")
    throw new TypeError("attemptId is invalid");
  const scheduledAttemptId = `scheduled:${environment}:${hkDate}`;
  const manualAttemptPrefix = `${scheduledAttemptId}:manual:`;
  const manualSuffix = attemptId.slice(manualAttemptPrefix.length);
  if (
    attemptId !== scheduledAttemptId &&
    (!attemptId.startsWith(manualAttemptPrefix) ||
      !MANUAL_ATTEMPT_SUFFIX_PATTERN.test(manualSuffix))
  ) {
    throw new TypeError("attemptId is invalid");
  }
  return attemptId;
}

function requireTimestamp(value, label) {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== value) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function captureContext(context) {
  const captured = captureExactPlainRecord(
    context,
    CONTEXT_KEYS,
    "R2 reporter context",
  );
  if (!/^(preview|production)$/.test(captured.environment)) {
    throw new TypeError("environment is invalid");
  }
  if (!isValidDate(captured.hkDate)) throw new TypeError("HK date is invalid");
  requireAttemptId(captured);
  if (!/^(shadow|publish)$/.test(captured.mode))
    throw new TypeError("mode is invalid");
  if (
    typeof captured.commitSha !== "string" ||
    !SHA_PATTERN.test(captured.commitSha)
  ) {
    throw new TypeError("commit SHA is invalid");
  }
  safeSegment(captured.containerDeploymentId, "containerDeploymentId");
  safeSegment(captured.workflowInstanceId, "workflowInstanceId");
  safeSegment(captured.containerId, "containerId");
  return captured;
}

function assertArtifactObjects(value, prefix) {
  if (!Array.isArray(value) || value.length !== ARTIFACT_SPECS.length) {
    throw new TypeError("artifactObjects must contain exactly four artifacts");
  }
  const artifacts = value.map((artifact, index) => {
    const captured = captureExactPlainRecord(
      artifact,
      ARTIFACT_KEYS,
      `artifactObjects[${index}]`,
    );
    const spec = ARTIFACT_SPECS[index];
    if (
      captured.name !== spec.name ||
      captured.contentType !== spec.contentType
    ) {
      throw new TypeError("artifactObjects are invalid");
    }
    if (captured.key !== `${prefix}/${spec.name}`)
      throw new TypeError("artifactObjects are invalid");
    if (!Number.isSafeInteger(captured.byteLength) || captured.byteLength < 0) {
      throw new TypeError("artifactObjects are invalid");
    }
    if (
      typeof captured.sha256 !== "string" ||
      !HASH_PATTERN.test(captured.sha256)
    ) {
      throw new TypeError("artifactObjects are invalid");
    }
    return Object.freeze(captured);
  });
  return Object.freeze(artifacts);
}

function sameArtifacts(expected, received) {
  return (
    expected.length === received.length &&
    expected.every((artifact, index) =>
      ARTIFACT_KEYS.every((key) => artifact[key] === received[index][key]),
    )
  );
}

export function buildEvidencePrefix(value) {
  const captured = capturePlainFields(
    value,
    ["environment", "hkDate", "runId", "attemptId"],
    "prefix",
  );
  if (!/^(preview|production)$/.test(captured.environment)) {
    throw new TypeError("environment is invalid");
  }
  if (!isValidDate(captured.hkDate)) throw new TypeError("HK date is invalid");
  requireAttemptId(captured);
  return [
    "mls-sync",
    captured.environment,
    captured.hkDate,
    requireCanonicalUuid(captured.runId, "runId"),
    safeSegment(captured.attemptId, "attemptId"),
  ].join("/");
}

export function createR2S3ObjectStore(
  { accountId, bucket, accessKeyId, secretAccessKey },
  { createClient = (config) => new S3Client(config) } = {},
) {
  for (const [name, value] of Object.entries({
    accountId,
    bucket,
    accessKeyId,
    secretAccessKey,
  })) {
    if (typeof value !== "string" || value.length === 0)
      throw new TypeError(`${name} is required`);
  }
  if (!SAFE_SEGMENT.test(accountId) || accountId.includes("..")) {
    throw new TypeError("accountId is invalid");
  }
  if (typeof createClient !== "function")
    throw new TypeError("createClient is invalid");
  const client = createClient({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  if (!client || typeof client.send !== "function")
    throw new TypeError("S3 client is invalid");
  return Object.freeze({
    async putIfAbsent({ key, body, contentType, metadata }) {
      if (
        typeof key !== "string" ||
        !key ||
        key.includes("..") ||
        key.startsWith("/")
      ) {
        throw new TypeError("key is invalid");
      }
      if (typeof body !== "string" || typeof contentType !== "string") {
        throw new TypeError("known-length body and contentType are required");
      }
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentLength: Buffer.byteLength(body),
          ContentType: contentType,
          Metadata: metadata,
          IfNoneMatch: "*",
        }),
      );
    },
  });
}

export function createR2Reporter({ objectStore, context }) {
  if (!objectStore || typeof objectStore.putIfAbsent !== "function") {
    throw new TypeError("R2 object store is required");
  }
  const capturedContext = captureContext(context);
  const artifactsByRunId = new Map();
  const finalizedRunIds = new Set();

  return Object.freeze({
    async writeRunArtifacts(run) {
      const runId = capturePlainFields(run, ["runId"], "run").runId;
      const prefix = buildEvidencePrefix({ ...capturedContext, runId });
      const artifacts = buildRunArtifactObjects(run);
      const artifactObjects = [];
      for (const artifact of artifacts) {
        const key = `${prefix}/${artifact.name}`;
        await objectStore.putIfAbsent({
          key,
          body: artifact.body,
          contentType: artifact.contentType,
          ifNoneMatch: "*",
          metadata: { sha256: artifact.sha256 },
        });
        artifactObjects.push(
          Object.freeze({
            name: artifact.name,
            key,
            byteLength: artifact.byteLength,
            contentType: artifact.contentType,
            sha256: artifact.sha256,
          }),
        );
      }
      const objects = Object.freeze(artifactObjects);
      artifactsByRunId.set(runId, objects);
      return Object.freeze({ prefix, objects });
    },

    async finalizeTerminal(input) {
      const terminal = captureExactPlainRecord(
        input,
        TERMINAL_KEYS,
        "terminal input",
      );
      const prefix = buildEvidencePrefix({
        ...capturedContext,
        runId: terminal.runId,
      });
      requireOutcome(terminal.status, "status");
      requireOutcome(terminal.terminalClassification, "terminalClassification");
      if (
        !Number.isInteger(terminal.exitCode) ||
        terminal.exitCode < 0 ||
        terminal.exitCode > 255
      ) {
        throw new TypeError("exitCode is invalid");
      }
      const startedAt = requireTimestamp(terminal.startedAt, "startedAt");
      const completedAt = requireTimestamp(terminal.completedAt, "completedAt");
      if (Date.parse(completedAt) < Date.parse(startedAt))
        throw new TypeError("completedAt is invalid");
      if (
        !Number.isSafeInteger(terminal.durationMs) ||
        terminal.durationMs < 0
      ) {
        throw new TypeError("durationMs is invalid");
      }
      if (
        terminal.durationMs !==
        Date.parse(completedAt) - Date.parse(startedAt)
      ) {
        throw new TypeError("durationMs is invalid");
      }
      if (
        terminal.neonRunId !== null &&
        (typeof terminal.neonRunId !== "string" ||
          !UUID_PATTERN.test(terminal.neonRunId))
      ) {
        throw new TypeError("neonRunId is invalid");
      }
      const artifactObjects = assertArtifactObjects(
        terminal.artifactObjects,
        prefix,
      );
      if (
        !sameArtifacts(
          artifactsByRunId.get(terminal.runId) ?? [],
          artifactObjects,
        )
      ) {
        throw new TypeError(
          "artifactObjects must be the complete successful artifact metadata",
        );
      }
      if (finalizedRunIds.has(terminal.runId)) {
        throw new Error("terminal manifest was already finalized for this run");
      }
      const manifest = {
        schemaVersion: 1,
        environment: capturedContext.environment,
        hkDate: capturedContext.hkDate,
        attemptId: capturedContext.attemptId,
        mode: capturedContext.mode,
        commitSha: capturedContext.commitSha,
        containerDeploymentId: capturedContext.containerDeploymentId,
        workflowInstanceId: capturedContext.workflowInstanceId,
        containerId: capturedContext.containerId,
        runId: terminal.runId,
        status: terminal.status,
        terminalClassification: terminal.terminalClassification,
        exitCode: terminal.exitCode,
        startedAt,
        completedAt,
        durationMs: terminal.durationMs,
        neonRunId: terminal.neonRunId,
        artifacts: artifactObjects.map(({ key, ...artifact }) => artifact),
      };
      const manifestKey = `${prefix}/manifest.json`;
      await objectStore.putIfAbsent({
        key: manifestKey,
        body: `${JSON.stringify(manifest, null, 2)}\n`,
        contentType: "application/json; charset=utf-8",
        ifNoneMatch: "*",
        metadata: { completion: "terminal" },
      });
      finalizedRunIds.add(terminal.runId);
      return Object.freeze({ manifestKey });
    },
  });
}
