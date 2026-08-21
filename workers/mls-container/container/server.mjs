import { spawn } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { open } from "node:fs/promises";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const RUN_ENVELOPE_KEYS = [
  "environment",
  "hkDate",
  "attemptId",
  "kind",
  "mode",
  "scheduledTime",
  "manualReason",
  "commitSha",
];
const TERMINAL_FILE = "/tmp/earnest-mls-terminal.json";
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
const PUBLIC_STATUS_KEYS = [
  "attemptId",
  "state",
  "startedAt",
  "heartbeatAt",
  "completedAt",
  "exitCode",
  "failureCode",
  "runId",
  "neonRunId",
  "evidencePrefix",
  "manifestKey",
  "manifestPresent",
];
const MANUAL_SUFFIX_PATTERN = /^[a-z0-9][a-z0-9-]{7,63}$/;
const ATTEMPT_ID_PATTERN =
  /^scheduled:(preview|production):(\d{4}-\d{2}-\d{2})(?::manual:[a-z0-9][a-z0-9-]{7,63})?$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXACT_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function fixedError(code) {
  const error = new Error(code);
  error.name = "MlsSupervisorError";
  Object.defineProperty(error, "code", {
    configurable: false,
    enumerable: true,
    writable: false,
    value: code,
  });
  return error;
}

function failEnvelope() {
  throw fixedError("invalid_run_envelope");
}

function exactOwnDataRecord(value, keys) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    failEnvelope();
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) {
    failEnvelope();
  }
  const captured = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) failEnvelope();
    captured[key] = descriptor.value;
  }
  return captured;
}

function exactTimestamp(value) {
  const date =
    value instanceof Date ? new Date(value.valueOf()) : new Date(value);
  if (
    Number.isNaN(date.valueOf()) ||
    !EXACT_TIMESTAMP_PATTERN.test(date.toISOString())
  ) {
    throw fixedError("invalid_supervisor_clock");
  }
  return date.toISOString();
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

function validExactTimestamp(value) {
  if (typeof value !== "string" || !EXACT_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function hongKongDate(scheduledTime) {
  const date = new Date(scheduledTime);
  if (Number.isNaN(date.valueOf())) failEnvelope();
  return new Date(date.valueOf() + 8 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
}

function captureRunEnvelope(input) {
  const value = exactOwnDataRecord(input, RUN_ENVELOPE_KEYS);
  if (value.environment !== "preview" && value.environment !== "production")
    failEnvelope();
  if (!validDate(value.hkDate)) failEnvelope();
  if (value.kind !== "scheduled" && value.kind !== "manual") failEnvelope();
  if (value.mode !== "shadow" && value.mode !== "publish") failEnvelope();
  if (
    !validExactTimestamp(value.scheduledTime) ||
    hongKongDate(value.scheduledTime) !== value.hkDate
  ) {
    failEnvelope();
  }
  if (
    typeof value.commitSha !== "string" ||
    !/^[0-9a-f]{40}$/.test(value.commitSha)
  ) {
    failEnvelope();
  }
  const scheduledAttempt = `scheduled:${value.environment}:${value.hkDate}`;
  if (value.kind === "scheduled") {
    if (value.attemptId !== scheduledAttempt || value.manualReason !== null) {
      failEnvelope();
    }
  } else {
    const prefix = `${scheduledAttempt}:manual:`;
    const suffix =
      typeof value.attemptId === "string" && value.attemptId.startsWith(prefix)
        ? value.attemptId.slice(prefix.length)
        : "";
    if (
      !MANUAL_SUFFIX_PATTERN.test(suffix) ||
      typeof value.manualReason !== "string" ||
      value.manualReason !== value.manualReason.trim() ||
      value.manualReason.length < 8 ||
      value.manualReason.length > 240
    ) {
      failEnvelope();
    }
  }
  return Object.freeze({ ...value });
}

function sameEnvelope(left, right) {
  return RUN_ENVELOPE_KEYS.every((key) => left[key] === right[key]);
}

function snapshotEnvironment(environment) {
  if (
    !environment ||
    typeof environment !== "object" ||
    Array.isArray(environment)
  ) {
    throw fixedError("invalid_supervisor_environment");
  }
  const captured = {};
  for (const key of Reflect.ownKeys(environment)) {
    if (typeof key !== "string") {
      throw fixedError("invalid_supervisor_environment");
    }
    const descriptor = Object.getOwnPropertyDescriptor(environment, key);
    if (!descriptor || !("value" in descriptor)) {
      throw fixedError("invalid_supervisor_environment");
    }
    if (
      descriptor.value !== undefined &&
      typeof descriptor.value !== "string"
    ) {
      throw fixedError("invalid_supervisor_environment");
    }
    if (descriptor.value !== undefined) captured[key] = descriptor.value;
  }
  delete captured.MLS_SUPERVISOR_TOKEN;
  return Object.freeze(captured);
}

function publicStatus(state) {
  return Object.freeze({
    attemptId: state.envelope?.attemptId ?? null,
    state: state.state,
    startedAt: state.startedAt,
    heartbeatAt: state.heartbeatAt,
    completedAt: state.completedAt,
    exitCode: state.exitCode,
    failureCode: state.failureCode,
    runId: state.runId,
    neonRunId: state.neonRunId,
    evidencePrefix: state.evidencePrefix,
    manifestKey: state.manifestKey,
    manifestPresent: state.manifestPresent,
  });
}

async function readBoundedTerminalStatus(openTerminalFile, file, maxBytes) {
  if (file !== TERMINAL_FILE || maxBytes !== 32 * 1024)
    throw fixedError("terminal_status_missing");
  const handle = await openTerminalFile(file, "r");
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset === 0 || offset > maxBytes)
      throw fixedError("terminal_status_missing");
    return JSON.parse(buffer.subarray(0, offset).toString("utf8"));
  } finally {
    await handle.close();
  }
}

function captureTerminalRecord(record, envelope, operatingSystemExitCode) {
  if (
    !record ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    Object.getPrototypeOf(record) !== Object.prototype
  )
    throw fixedError("terminal_status_missing");
  const ownKeys = Reflect.ownKeys(record);
  if (
    ownKeys.length !== TERMINAL_RECORD_KEYS.length ||
    ownKeys.some(
      (key) => typeof key !== "string" || !TERMINAL_RECORD_KEYS.includes(key),
    )
  )
    throw fixedError("terminal_status_missing");
  const captured = {};
  for (const key of TERMINAL_RECORD_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !("value" in descriptor))
      throw fixedError("terminal_status_missing");
    captured[key] = descriptor.value;
  }
  if (captured.attemptId !== envelope.attemptId)
    throw fixedError("terminal_status_missing");
  for (const key of ["runId", "neonRunId"]) {
    if (
      captured[key] !== null &&
      (typeof captured[key] !== "string" || !UUID_PATTERN.test(captured[key]))
    )
      throw fixedError("terminal_status_missing");
  }
  if (captured.neonRunId !== null && captured.neonRunId !== captured.runId)
    throw fixedError("terminal_status_missing");
  if (
    typeof captured.status !== "string" ||
    !/^(succeeded|failed|degraded|blocked|unknown)$/.test(captured.status)
  )
    throw fixedError("terminal_status_missing");
  if (
    !Number.isInteger(captured.exitCode) ||
    captured.exitCode < 0 ||
    captured.exitCode > 255 ||
    captured.exitCode !== operatingSystemExitCode
  )
    throw fixedError("terminal_status_missing");
  if (
    captured.failureCode !== null &&
    (typeof captured.failureCode !== "string" ||
      !/^[a-z][a-z0-9_-]{0,79}$/.test(captured.failureCode))
  )
    throw fixedError("terminal_status_missing");
  if (
    (captured.status === "succeeded" && captured.failureCode !== null) ||
    (captured.status !== "succeeded" && captured.failureCode === null)
  )
    throw fixedError("terminal_status_missing");
  if (typeof captured.manifestPresent !== "boolean")
    throw fixedError("terminal_status_missing");
  if (captured.evidencePrefix !== null) {
    if (captured.runId === null) throw fixedError("terminal_status_missing");
    const expectedPrefix = `mls-sync/${envelope.environment}/${envelope.hkDate}/${captured.runId}/${envelope.attemptId}`;
    if (
      captured.evidencePrefix !== expectedPrefix ||
      expectedPrefix.length > 512
    )
      throw fixedError("terminal_status_missing");
  }
  if (captured.manifestPresent) {
    if (
      captured.evidencePrefix === null ||
      captured.manifestKey !== `${captured.evidencePrefix}/manifest.json`
    )
      throw fixedError("terminal_status_missing");
  } else if (captured.manifestKey !== null) {
    throw fixedError("terminal_status_missing");
  }
  if (
    captured.status === "succeeded" &&
    (captured.exitCode !== 0 || !captured.manifestPresent)
  )
    throw fixedError("terminal_status_missing");
  return Object.freeze({ ...captured });
}

export function createSupervisor({
  spawnChild = spawn,
  openTerminalFile = open,
  readTerminalStatus = (file, maxBytes) =>
    readBoundedTerminalStatus(openTerminalFile, file, maxBytes),
  now = () => new Date(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  heartbeatMs = 30_000,
  timeoutMs = 4 * 60 * 60 * 1_000,
  environment = process.env,
  terminalStatusFile = TERMINAL_FILE,
} = {}) {
  if (
    typeof spawnChild !== "function" ||
    typeof openTerminalFile !== "function" ||
    typeof readTerminalStatus !== "function" ||
    typeof now !== "function" ||
    typeof setTimer !== "function" ||
    typeof clearTimer !== "function" ||
    !Number.isInteger(heartbeatMs) ||
    heartbeatMs <= 0 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    terminalStatusFile !== TERMINAL_FILE
  ) {
    throw fixedError("invalid_supervisor_configuration");
  }
  const inheritedEnvironment = snapshotEnvironment(environment);
  const state = {
    envelope: null,
    state: "pending",
    startedAt: null,
    heartbeatAt: null,
    completedAt: null,
    exitCode: null,
    failureCode: null,
    runId: null,
    neonRunId: null,
    evidencePrefix: null,
    manifestKey: null,
    manifestPresent: false,
    child: null,
    heartbeatTimer: null,
    timeoutTimer: null,
  };
  let terminalClaimed = false;
  let terminalFinalized = false;
  let timeoutForced = false;
  let timeoutSignalSent = false;
  let supervisorFailureCode = null;
  let completionPromise = null;
  let resolveCompletion = null;
  const forwardedSignals = new Set();
  const deliveredSignals = new Set();

  function clearRunTimers() {
    if (state.heartbeatTimer !== null) {
      clearTimer(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
    if (state.timeoutTimer !== null) {
      clearTimer(state.timeoutTimer);
      state.timeoutTimer = null;
    }
  }

  function claimTerminal() {
    if (terminalClaimed) return false;
    terminalClaimed = true;
    clearRunTimers();
    return true;
  }

  function completeTerminal(patch) {
    if (terminalFinalized) return publicStatus(state);
    let completedAt;
    let terminalPatch = patch;
    try {
      completedAt = exactTimestamp(now());
    } catch {
      completedAt = validExactTimestamp(state.heartbeatAt)
        ? state.heartbeatAt
        : state.startedAt;
      terminalPatch = {
        ...patch,
        state: "unknown",
        failureCode: "supervisor_clock_failed",
      };
    }
    const nextState = {
      ...state,
      state: terminalPatch.state,
      completedAt,
      exitCode: terminalPatch.exitCode,
      failureCode: terminalPatch.failureCode,
      runId: terminalPatch.runId ?? null,
      neonRunId: terminalPatch.neonRunId ?? null,
      evidencePrefix: terminalPatch.evidencePrefix ?? null,
      manifestKey: terminalPatch.manifestKey ?? null,
      manifestPresent: terminalPatch.manifestPresent === true,
    };
    const status = publicStatus(nextState);
    terminalFinalized = true;
    Object.assign(state, nextState);
    resolveCompletion?.(status);
    return status;
  }

  function childStartFailed() {
    if (!claimTerminal()) return publicStatus(state);
    return completeTerminal({
      state: "unknown",
      exitCode: null,
      failureCode: "child_start_failed",
    });
  }

  function scheduleHeartbeat() {
    state.heartbeatTimer = setTimer(() => {
      state.heartbeatTimer = null;
      if (state.state !== "running" || terminalClaimed) return;
      try {
        state.heartbeatAt = exactTimestamp(now());
        scheduleHeartbeat();
      } catch {
        supervisorFailureCode = "supervisor_clock_failed";
        if (!timeoutSignalSent) {
          timeoutSignalSent = true;
          sendChildSignal("SIGTERM");
        }
      }
    }, heartbeatMs);
  }

  function sendChildSignal(signal) {
    if (!state.child || typeof state.child.kill !== "function") return false;
    try {
      state.child.kill(signal);
      return true;
    } catch {
      return false;
    }
  }

  function scheduleTimeout() {
    state.timeoutTimer = setTimer(() => {
      if (state.state !== "running" || terminalClaimed) return;
      timeoutForced = true;
      if (!timeoutSignalSent) {
        timeoutSignalSent = true;
        sendChildSignal("SIGTERM");
      }
    }, timeoutMs);
  }

  function fieldsFromRecord(record) {
    return {
      runId: record.runId,
      neonRunId: record.neonRunId,
      evidencePrefix: record.evidencePrefix,
      manifestKey: record.manifestKey,
      manifestPresent: record.manifestPresent,
    };
  }

  async function settleExit(code) {
    if (!claimTerminal()) return;
    const operatingSystemExitCode =
      Number.isInteger(code) && code >= 0 && code <= 255 ? code : null;
    let record = null;
    try {
      const untrusted = await readTerminalStatus(terminalStatusFile, 32 * 1024);
      record = captureTerminalRecord(
        untrusted,
        state.envelope,
        operatingSystemExitCode,
      );
    } catch {
      record = null;
    }
    const fields = record
      ? fieldsFromRecord(record)
      : {
          runId: null,
          neonRunId: null,
          evidencePrefix: null,
          manifestKey: null,
          manifestPresent: false,
        };
    if (timeoutForced) {
      completeTerminal({
        ...fields,
        state: "failed",
        exitCode: operatingSystemExitCode,
        failureCode: "run_timeout",
      });
      return;
    }
    if (supervisorFailureCode !== null) {
      completeTerminal({
        ...fields,
        state: "unknown",
        exitCode: operatingSystemExitCode,
        failureCode: supervisorFailureCode,
      });
      return;
    }
    if (!record) {
      completeTerminal({
        state: "unknown",
        exitCode: operatingSystemExitCode,
        failureCode: "terminal_status_missing",
      });
      return;
    }
    const stateForRecord =
      record.status === "succeeded" &&
      operatingSystemExitCode === 0 &&
      record.manifestPresent === true
        ? "succeeded"
        : record.status === "unknown"
          ? "unknown"
          : "failed";
    completeTerminal({
      ...fields,
      state: stateForRecord,
      exitCode: operatingSystemExitCode,
      failureCode:
        stateForRecord === "succeeded"
          ? null
          : typeof record.failureCode === "string"
            ? record.failureCode
            : "terminal_status_missing",
    });
  }

  function attachChild(child) {
    if (
      !child ||
      typeof child !== "object" ||
      typeof child.on !== "function" ||
      typeof child.kill !== "function"
    ) {
      childStartFailed();
      return false;
    }
    state.child = child;
    child.on("error", () => {
      if (terminalClaimed) return;
      if (timeoutForced || supervisorFailureCode !== null) return;
      childStartFailed();
    });
    child.on("exit", (code) => {
      void settleExit(code);
    });
    for (const signal of forwardedSignals) {
      if (!deliveredSignals.has(signal) && sendChildSignal(signal))
        deliveredSignals.add(signal);
    }
    scheduleHeartbeat();
    scheduleTimeout();
    return true;
  }

  async function start(input) {
    const captured = captureRunEnvelope(input);
    if (state.envelope) {
      if (!sameEnvelope(state.envelope, captured))
        throw fixedError("run_conflict");
      return publicStatus(state);
    }
    const startedAt = exactTimestamp(now());
    const childEnvironment = Object.freeze({
      ...inheritedEnvironment,
      MLS_ENVIRONMENT: captured.environment,
      MLS_SCHEDULED_FOR: captured.hkDate,
      MLS_ATTEMPT_ID: captured.attemptId,
      MLS_COMMIT_SHA: captured.commitSha,
      MLS_ATTEMPT_STARTED_AT: startedAt,
      MLS_TERMINAL_STATUS_FILE: terminalStatusFile,
    });
    state.envelope = captured;
    state.state = "running";
    state.startedAt = startedAt;
    state.heartbeatAt = startedAt;
    completionPromise = new Promise((resolve) => {
      resolveCompletion = resolve;
    });
    try {
      const child = await spawnChild(
        process.execPath,
        ["scripts/mls/sync.mjs", `--mode=${captured.mode}`],
        { env: childEnvironment, stdio: "inherit" },
      );
      attachChild(child);
    } catch {
      childStartFailed();
    }
    return publicStatus(state);
  }

  function forwardSignal(signal) {
    if (signal !== "SIGTERM" && signal !== "SIGINT")
      throw fixedError("invalid_signal");
    if (forwardedSignals.has(signal)) return false;
    forwardedSignals.add(signal);
    if (state.state !== "running" || terminalClaimed) return false;
    const delivered = sendChildSignal(signal);
    if (delivered) deliveredSignals.add(signal);
    return delivered;
  }

  function waitForTerminal() {
    return completionPromise ?? Promise.resolve(publicStatus(state));
  }

  return Object.freeze({
    forwardSignal,
    start,
    status: () => publicStatus(state),
    waitForTerminal,
  });
}

function captureSupervisor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw fixedError("invalid_supervisor_configuration");
  const captured = {};
  for (const key of ["start", "status", "forwardSignal"]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "function"
    )
      throw fixedError("invalid_supervisor_configuration");
    captured[key] = descriptor.value.bind(value);
  }
  return Object.freeze(captured);
}

function projectPublicStatus(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw fixedError("supervisor_unavailable");
  const projected = {};
  for (const key of PUBLIC_STATUS_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor))
      throw fixedError("supervisor_unavailable");
    projected[key] = descriptor.value;
  }
  const attemptMatch =
    projected.attemptId === null
      ? null
      : typeof projected.attemptId === "string"
        ? ATTEMPT_ID_PATTERN.exec(projected.attemptId)
        : null;
  if (
    projected.attemptId !== null &&
    (!attemptMatch || !validDate(attemptMatch[2]))
  ) {
    throw fixedError("supervisor_unavailable");
  }
  if (
    !["pending", "running", "succeeded", "failed", "unknown"].includes(
      projected.state,
    )
  ) {
    throw fixedError("supervisor_unavailable");
  }
  for (const key of ["startedAt", "heartbeatAt", "completedAt"]) {
    if (projected[key] !== null && !validExactTimestamp(projected[key])) {
      throw fixedError("supervisor_unavailable");
    }
  }
  if (
    projected.exitCode !== null &&
    (!Number.isInteger(projected.exitCode) ||
      projected.exitCode < 0 ||
      projected.exitCode > 255)
  ) {
    throw fixedError("supervisor_unavailable");
  }
  if (
    projected.failureCode !== null &&
    (typeof projected.failureCode !== "string" ||
      !/^[a-z][a-z0-9_-]{0,79}$/.test(projected.failureCode))
  ) {
    throw fixedError("supervisor_unavailable");
  }
  for (const key of ["runId", "neonRunId"]) {
    if (
      projected[key] !== null &&
      (typeof projected[key] !== "string" || !UUID_PATTERN.test(projected[key]))
    ) {
      throw fixedError("supervisor_unavailable");
    }
  }
  if (projected.neonRunId !== null && projected.neonRunId !== projected.runId) {
    throw fixedError("supervisor_unavailable");
  }
  if (typeof projected.manifestPresent !== "boolean") {
    throw fixedError("supervisor_unavailable");
  }
  const expectedEvidencePrefix =
    attemptMatch && projected.runId !== null
      ? `mls-sync/${attemptMatch[1]}/${attemptMatch[2]}/${projected.runId}/${projected.attemptId}`
      : null;
  if (
    projected.evidencePrefix !== null &&
    (typeof projected.evidencePrefix !== "string" ||
      projected.evidencePrefix !== expectedEvidencePrefix ||
      projected.evidencePrefix.length > 512)
  ) {
    throw fixedError("supervisor_unavailable");
  }
  if (projected.manifestPresent) {
    if (
      projected.evidencePrefix === null ||
      projected.manifestKey !== `${projected.evidencePrefix}/manifest.json`
    ) {
      throw fixedError("supervisor_unavailable");
    }
  } else if (projected.manifestKey !== null) {
    throw fixedError("supervisor_unavailable");
  }
  return Object.freeze(projected);
}

function sendJson(response, statusCode, body) {
  if (response.destroyed || response.writableEnded) return;
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-length": String(payload.byteLength),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(payload);
}

function authorized(request, expectedDigest) {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string") return false;
  const match = /^Bearer ([A-Za-z0-9_-]{32,160})$/.exec(authorization);
  if (!match) return false;
  const suppliedDigest = createHash("sha256").update(match[1], "utf8").digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

function readRequestBody(request, limit) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let byteLength = 0;
    const chunks = [];
    const fail = (code) => {
      if (settled) return;
      settled = true;
      reject(fixedError(code));
    };
    request.on("data", (chunk) => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += bytes.byteLength;
      if (byteLength > limit) {
        request.resume();
        fail("body_too_large");
        return;
      }
      chunks.push(bytes);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, byteLength).toString("utf8"));
    });
    request.on("aborted", () => fail("request_aborted"));
    request.on("error", () => fail("invalid_body"));
  });
}

function safeErrorCode(error) {
  if (!error || typeof error !== "object") return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor &&
    "value" in descriptor &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

export function createSupervisorServer({ supervisor, token, port, host } = {}) {
  const controller = captureSupervisor(supervisor);
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32,160}$/.test(token))
    throw fixedError("invalid_supervisor_token");
  if (
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65_535 ||
    (host !== "0.0.0.0" && host !== "127.0.0.1")
  )
    throw fixedError("invalid_supervisor_configuration");
  const expectedDigest = createHash("sha256").update(token, "utf8").digest();
  token = undefined;

  const server = createServer((request, response) => {
    void (async () => {
      let pathname;
      try {
        pathname = new URL(request.url ?? "", "http://supervisor.invalid")
          .pathname;
      } catch {
        sendJson(response, 404, { error: "not_found" });
        return;
      }
      if (request.method === "GET" && pathname === "/health") {
        sendJson(response, 200, { status: "ok" });
        return;
      }
      if (request.method === "GET" && pathname === "/status") {
        sendJson(response, 200, projectPublicStatus(controller.status()));
        return;
      }
      if (request.method !== "POST" || pathname !== "/run") {
        sendJson(response, 404, { error: "not_found" });
        return;
      }
      if (!authorized(request, expectedDigest)) {
        request.resume();
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }
      const mediaType = request.headers["content-type"]
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (mediaType !== "application/json") {
        request.resume();
        sendJson(response, 415, { error: "unsupported_media_type" });
        return;
      }
      const contentLength = request.headers["content-length"];
      if (
        typeof contentLength === "string" &&
        (/^\d+$/.test(contentLength) === false ||
          Number(contentLength) > 32 * 1024)
      ) {
        request.resume();
        sendJson(response, /^\d+$/.test(contentLength) ? 413 : 400, {
          error: /^\d+$/.test(contentLength)
            ? "body_too_large"
            : "invalid_body",
        });
        return;
      }
      let text;
      try {
        text = await readRequestBody(request, 32 * 1024);
      } catch (error) {
        const code = safeErrorCode(error);
        if (code === "request_aborted") return;
        sendJson(response, code === "body_too_large" ? 413 : 400, {
          error: code === "body_too_large" ? "body_too_large" : "invalid_body",
        });
        return;
      }
      let input;
      try {
        input = JSON.parse(text);
      } catch {
        sendJson(response, 400, { error: "invalid_json" });
        return;
      }
      try {
        const status = projectPublicStatus(await controller.start(input));
        sendJson(response, 202, status);
      } catch (error) {
        const code = safeErrorCode(error);
        if (code === "invalid_run_envelope")
          sendJson(response, 400, { error: "invalid_run_envelope" });
        else if (code === "run_conflict")
          sendJson(response, 409, { error: "run_conflict" });
        else sendJson(response, 500, { error: "supervisor_unavailable" });
      }
    })().catch(() => {
      sendJson(response, 500, { error: "supervisor_unavailable" });
    });
  });

  const handledSignals = new Set();
  let shutdownRequested = false;
  const handleSignal = (signal) => {
    if (handledSignals.has(signal)) return;
    handledSignals.add(signal);
    shutdownRequested = true;
    try {
      controller.forwardSignal(signal);
    } catch {}
    if (server.listening) server.close();
  };
  const handleTerm = () => handleSignal("SIGTERM");
  const handleInterrupt = () => handleSignal("SIGINT");
  process.on("SIGTERM", handleTerm);
  process.on("SIGINT", handleInterrupt);
  let signalHandlersRemoved = false;
  const removeSignalHandlers = () => {
    if (signalHandlersRemoved) return;
    signalHandlersRemoved = true;
    process.removeListener("SIGTERM", handleTerm);
    process.removeListener("SIGINT", handleInterrupt);
  };
  server.once("close", removeSignalHandlers);
  server.once("error", removeSignalHandlers);
  server.once("listening", () => {
    if (shutdownRequested && server.listening) server.close();
  });
  server.listen({ host, port });
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const supervisor = createSupervisor();
  createSupervisorServer({
    supervisor,
    token: process.env.MLS_SUPERVISOR_TOKEN,
    port: 8080,
    host: "0.0.0.0",
  });
}
