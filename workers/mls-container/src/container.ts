import { Container, type StopParams } from "@cloudflare/containers";

import type { RunEnvelope, RunState } from "./run-contract";

const RUN_ENVELOPE_KEYS = [
  "environment",
  "hkDate",
  "attemptId",
  "kind",
  "mode",
  "scheduledTime",
  "manualReason",
  "commitSha",
] as const;
const ATTEMPT_RECORD_KEYS = [
  "envelope",
  "state",
  "workflowInstanceId",
  "containerDeploymentId",
  "containerId",
  "neonRunId",
  "evidencePrefix",
  "manifestPresent",
  "startedAt",
  "heartbeatAt",
  "completedAt",
  "exitCode",
  "failureCode",
] as const;
const SUPERVISOR_STATUS_KEYS = [
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
] as const;
const TERMINAL_STATES = new Set<RunState>(["succeeded", "failed", "unknown"]);
const EXACT_TIMESTAMP_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FAILURE_CODE_PATTERN = /^[a-z][a-z0-9_-]{0,79}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const DEFINITE_START_REJECTION = "container supervisor rejected the attempt";

export interface AttemptRecord {
  envelope: RunEnvelope;
  state: RunState;
  workflowInstanceId: string;
  containerDeploymentId: string | null;
  containerId: string;
  neonRunId: string | null;
  evidencePrefix: string | null;
  manifestPresent: boolean;
  startedAt: string | null;
  heartbeatAt: string | null;
  completedAt: string | null;
  exitCode: number | null;
  failureCode: string | null;
}

export interface ClaimAndStartInput {
  envelope: RunEnvelope;
  workflowInstanceId: string;
}

export interface SupervisorStatus {
  attemptId: string | null;
  state: RunState;
  startedAt: string | null;
  heartbeatAt: string | null;
  completedAt: string | null;
  exitCode: number | null;
  failureCode: string | null;
  runId: string | null;
  neonRunId: string | null;
  evidencePrefix: string | null;
  manifestKey: string | null;
  manifestPresent: boolean;
}

export interface AttemptStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: AttemptRecord): Promise<void>;
}

export interface ContainerPort {
  start(input: {
    envelope: RunEnvelope;
    token: string;
    envVars: Record<string, string>;
  }): Promise<void>;
  status(): Promise<unknown>;
  stop(): Promise<void>;
}

interface AttemptCoordinatorOptions {
  store: AttemptStore;
  container: ContainerPort;
  containerId: string;
  containerDeploymentId: string | null;
  startEnvironment(input: ClaimAndStartInput): Record<string, string>;
  createToken(): string;
  now(): string;
}

function invalid(message: string): never {
  throw new TypeError(message);
}

function exactDataRecord(
  input: unknown,
  keys: readonly string[],
  message: string,
): Record<string, unknown> {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  )
    invalid(message);
  const ownKeys = Reflect.ownKeys(input);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  )
    invalid(message);
  const captured: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor)) invalid(message);
    captured[key] = descriptor.value;
  }
  return captured;
}

function exactTimestamp(input: unknown, message: string): string {
  if (typeof input !== "string" || !EXACT_TIMESTAMP_PATTERN.test(input)) invalid(message);
  const date = new Date(input);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== input) invalid(message);
  return input;
}

function optionalTimestamp(input: unknown, message: string): string | null {
  return input === null ? null : exactTimestamp(input, message);
}

function optionalString(input: unknown, maximum: number, message: string): string | null {
  if (input === null) return null;
  if (typeof input !== "string" || input.length === 0 || input.length > maximum) invalid(message);
  return input;
}

function optionalUuid(input: unknown, message: string): string | null {
  if (input === null) return null;
  if (typeof input !== "string" || !UUID_PATTERN.test(input)) invalid(message);
  return input;
}

function runState(input: unknown, message: string): RunState {
  if (
    input !== "pending" &&
    input !== "running" &&
    input !== "succeeded" &&
    input !== "failed" &&
    input !== "unknown"
  )
    invalid(message);
  return input;
}

function exitCode(input: unknown, message: string): number | null {
  if (input === null) return null;
  if (!Number.isInteger(input) || (input as number) < 0 || (input as number) > 255)
    invalid(message);
  return input as number;
}

function failureCode(input: unknown, message: string): string | null {
  if (input === null) return null;
  if (typeof input !== "string" || !FAILURE_CODE_PATTERN.test(input)) invalid(message);
  return input;
}

function safeIdentifier(input: unknown, message: string): string {
  if (typeof input !== "string" || !SAFE_ID_PATTERN.test(input)) invalid(message);
  return input;
}

function validDate(value: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function captureEnvelope(input: unknown): Readonly<RunEnvelope> {
  const value = exactDataRecord(input, RUN_ENVELOPE_KEYS, "run envelope is invalid");
  const environment = value.environment;
  const hkDate = value.hkDate;
  const attemptId = value.attemptId;
  const kind = value.kind;
  const mode = value.mode;
  const scheduledTime = value.scheduledTime;
  const manualReason = value.manualReason;
  const commitSha = value.commitSha;
  if (environment !== "preview" && environment !== "production") invalid("run envelope is invalid");
  if (typeof hkDate !== "string" || !validDate(hkDate)) invalid("run envelope is invalid");
  if (kind !== "scheduled" && kind !== "manual") invalid("run envelope is invalid");
  if (mode !== "shadow" && mode !== "publish") invalid("run envelope is invalid");
  if (typeof scheduledTime !== "string") invalid("run envelope is invalid");
  exactTimestamp(scheduledTime, "run envelope is invalid");
  const scheduledDate = new Date(new Date(scheduledTime).getTime() + 8 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
  if (scheduledDate !== hkDate) invalid("run envelope is invalid");
  if (typeof commitSha !== "string" || !/^[0-9a-f]{40}$/.test(commitSha))
    invalid("run envelope is invalid");
  const scheduledId = `scheduled:${environment}:${hkDate}`;
  if (kind === "scheduled") {
    if (attemptId !== scheduledId || manualReason !== null) invalid("run envelope is invalid");
  } else {
    const prefix = `${scheduledId}:manual:`;
    const suffix =
      typeof attemptId === "string" && attemptId.startsWith(prefix)
        ? attemptId.slice(prefix.length)
        : "";
    if (
      !/^[a-z0-9][a-z0-9-]{7,63}$/.test(suffix) ||
      typeof manualReason !== "string" ||
      manualReason !== manualReason.trim() ||
      manualReason.length < 8 ||
      manualReason.length > 240
    )
      invalid("run envelope is invalid");
  }
  return Object.freeze({
    environment,
    hkDate,
    attemptId: attemptId as string,
    kind,
    mode,
    scheduledTime,
    manualReason: manualReason as string | null,
    commitSha,
  });
}

function captureInput(input: unknown): Readonly<ClaimAndStartInput> {
  const value = exactDataRecord(
    input,
    ["envelope", "workflowInstanceId"],
    "attempt claim is invalid",
  );
  return Object.freeze({
    envelope: captureEnvelope(value.envelope),
    workflowInstanceId: safeIdentifier(value.workflowInstanceId, "attempt claim is invalid"),
  });
}

function snapshotRecord(record: AttemptRecord): AttemptRecord {
  return Object.freeze({
    ...record,
    envelope: captureEnvelope(record.envelope),
  });
}

function captureAttemptRecord(input: unknown): AttemptRecord {
  const value = exactDataRecord(input, ATTEMPT_RECORD_KEYS, "attempt record is invalid");
  const state = runState(value.state, "attempt record is invalid");
  const manifestPresent = value.manifestPresent;
  if (typeof manifestPresent !== "boolean") invalid("attempt record is invalid");
  const record: AttemptRecord = {
    envelope: captureEnvelope(value.envelope),
    state,
    workflowInstanceId: safeIdentifier(value.workflowInstanceId, "attempt record is invalid"),
    containerDeploymentId:
      value.containerDeploymentId === null
        ? null
        : safeIdentifier(value.containerDeploymentId, "attempt record is invalid"),
    containerId: safeIdentifier(value.containerId, "attempt record is invalid"),
    neonRunId: optionalUuid(value.neonRunId, "attempt record is invalid"),
    evidencePrefix: optionalString(value.evidencePrefix, 512, "attempt record is invalid"),
    manifestPresent,
    startedAt: optionalTimestamp(value.startedAt, "attempt record is invalid"),
    heartbeatAt: optionalTimestamp(value.heartbeatAt, "attempt record is invalid"),
    completedAt: optionalTimestamp(value.completedAt, "attempt record is invalid"),
    exitCode: exitCode(value.exitCode, "attempt record is invalid"),
    failureCode: failureCode(value.failureCode, "attempt record is invalid"),
  };
  if (TERMINAL_STATES.has(state)) {
    if (record.completedAt === null || (state !== "succeeded" && record.failureCode === null))
      invalid("attempt record is invalid");
  } else if (
    record.completedAt !== null ||
    record.exitCode !== null ||
    record.failureCode !== null
  ) {
    invalid("attempt record is invalid");
  }
  if (
    state === "succeeded" &&
    (record.exitCode !== 0 || record.failureCode !== null || !manifestPresent)
  )
    invalid("attempt record is invalid");
  return snapshotRecord(record);
}

function captureSupervisorStatus(input: unknown, envelope: RunEnvelope): SupervisorStatus {
  const value = exactDataRecord(input, SUPERVISOR_STATUS_KEYS, "supervisor status is invalid");
  if (value.attemptId !== envelope.attemptId) invalid("supervisor status is invalid");
  const state = runState(value.state, "supervisor status is invalid");
  const runId = optionalUuid(value.runId, "supervisor status is invalid");
  const neonRunId = optionalUuid(value.neonRunId, "supervisor status is invalid");
  if (neonRunId !== null && neonRunId !== runId) invalid("supervisor status is invalid");
  const evidencePrefix = optionalString(value.evidencePrefix, 512, "supervisor status is invalid");
  const manifestKey = optionalString(value.manifestKey, 526, "supervisor status is invalid");
  const manifestPresent = value.manifestPresent;
  if (typeof manifestPresent !== "boolean") invalid("supervisor status is invalid");
  const normalizedAttemptId = envelope.attemptId.replaceAll(":", "-");
  const expectedPrefix =
    runId === null
      ? null
      : `mls-sync/${envelope.environment}/${envelope.hkDate}/${runId}/${normalizedAttemptId}`;
  if (evidencePrefix !== null && evidencePrefix !== expectedPrefix)
    invalid("supervisor status is invalid");
  if (manifestPresent) {
    if (evidencePrefix === null || manifestKey !== `${evidencePrefix}/manifest.json`)
      invalid("supervisor status is invalid");
  } else if (manifestKey !== null) invalid("supervisor status is invalid");
  const status: SupervisorStatus = {
    attemptId: envelope.attemptId,
    state,
    startedAt: optionalTimestamp(value.startedAt, "supervisor status is invalid"),
    heartbeatAt: optionalTimestamp(value.heartbeatAt, "supervisor status is invalid"),
    completedAt: optionalTimestamp(value.completedAt, "supervisor status is invalid"),
    exitCode: exitCode(value.exitCode, "supervisor status is invalid"),
    failureCode: failureCode(value.failureCode, "supervisor status is invalid"),
    runId,
    neonRunId,
    evidencePrefix,
    manifestKey,
    manifestPresent,
  };
  if (TERMINAL_STATES.has(state)) {
    if (status.completedAt === null || (state !== "succeeded" && status.failureCode === null))
      invalid("supervisor status is invalid");
  } else if (
    status.completedAt !== null ||
    status.exitCode !== null ||
    status.failureCode !== null
  ) {
    invalid("supervisor status is invalid");
  }
  if (
    state === "succeeded" &&
    (status.exitCode !== 0 || status.failureCode !== null || !manifestPresent)
  )
    invalid("supervisor status is invalid");
  return Object.freeze(status);
}

function sameEnvelope(left: RunEnvelope, right: RunEnvelope): boolean {
  return RUN_ENVELOPE_KEYS.every((key) => left[key] === right[key]);
}

function captureStartEnvironment(input: unknown): Readonly<Record<string, string>> {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  )
    invalid("container start environment is invalid");
  const captured: Record<string, string> = {};
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string") invalid("container start environment is invalid");
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string")
      invalid("container start environment is invalid");
    captured[key] = descriptor.value;
  }
  return Object.freeze(captured);
}

function captureNow(options: AttemptCoordinatorOptions): string {
  return exactTimestamp(options.now(), "coordinator clock is invalid");
}

function isDefiniteStartRejection(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(error, "message");
  return Boolean(
    descriptor && "value" in descriptor && descriptor.value === DEFINITE_START_REJECTION,
  );
}

function initialRecord(
  input: ClaimAndStartInput,
  options: AttemptCoordinatorOptions,
): AttemptRecord {
  return snapshotRecord({
    envelope: input.envelope,
    state: "pending",
    workflowInstanceId: input.workflowInstanceId,
    containerDeploymentId:
      options.containerDeploymentId === null
        ? null
        : safeIdentifier(options.containerDeploymentId, "container deployment id is invalid"),
    containerId: safeIdentifier(options.containerId, "container id is invalid"),
    neonRunId: null,
    evidencePrefix: null,
    manifestPresent: false,
    startedAt: null,
    heartbeatAt: null,
    completedAt: null,
    exitCode: null,
    failureCode: null,
  });
}

async function stopAfterPersistence(container: ContainerPort): Promise<void> {
  try {
    await container.stop();
  } catch {
    // Durable state is authoritative; a bounded stop failure cannot rewrite it.
  }
}

export function createAttemptCoordinator(options: AttemptCoordinatorOptions) {
  const inFlight = new Map<
    string,
    {
      input: Readonly<ClaimAndStartInput>;
      claim: Promise<AttemptRecord>;
    }
  >();

  async function readMatchingRecord(
    key: string,
    input: ClaimAndStartInput,
  ): Promise<AttemptRecord | undefined> {
    const stored = await options.store.get(key);
    if (stored === undefined) return undefined;
    const record = captureAttemptRecord(stored);
    if (!sameEnvelope(record.envelope, input.envelope))
      invalid("attempt claim does not match existing record");
    return record;
  }

  function claimAndStart(input: ClaimAndStartInput): Promise<AttemptRecord> {
    const capturedInput = captureInput(input);
    const key = `attempt:${capturedInput.envelope.attemptId}`;
    const active = inFlight.get(key);
    if (active) {
      if (!sameEnvelope(active.input.envelope, capturedInput.envelope))
        invalid("attempt claim does not match existing record");
      return active.claim;
    }

    const claim = (async () => {
      const existing = await readMatchingRecord(key, capturedInput);
      if (existing !== undefined) {
        return snapshotRecord(existing);
      }

      const record = initialRecord(capturedInput, options);
      await options.store.put(key, record);
      try {
        const token = options.createToken();
        if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32,160}$/.test(token))
          invalid("container control token is invalid");
        const envVars = captureStartEnvironment(options.startEnvironment(capturedInput));
        await options.container.start({
          envelope: capturedInput.envelope,
          token,
          envVars,
        });
      } catch (error) {
        const current = await readMatchingRecord(key, capturedInput);
        if (current !== undefined && TERMINAL_STATES.has(current.state))
          return snapshotRecord(current);
        const definite = isDefiniteStartRejection(error);
        const terminal = snapshotRecord({
          ...(current ?? record),
          state: definite ? "failed" : "unknown",
          completedAt: captureNow(options),
          failureCode: definite ? "container_start_failed" : "container_start_outcome_unknown",
        });
        await options.store.put(key, terminal);
        await stopAfterPersistence(options.container);
        return terminal;
      }
      const current = await readMatchingRecord(key, capturedInput);
      return snapshotRecord(current ?? record);
    })();
    inFlight.set(key, { input: capturedInput, claim });
    void claim.then(
      () => {
        if (inFlight.get(key)?.claim === claim) inFlight.delete(key);
      },
      () => {
        if (inFlight.get(key)?.claim === claim) inFlight.delete(key);
      },
    );
    return claim;
  }

  async function readAttempt(attemptId: string): Promise<AttemptRecord> {
    const capturedAttemptId = safeIdentifier(attemptId, "attempt id is invalid");
    const key = `attempt:${capturedAttemptId}`;
    const stored = await options.store.get(key);
    if (stored === undefined) invalid("attempt record not found");
    const existing = captureAttemptRecord(stored);
    if (existing.envelope.attemptId !== capturedAttemptId) invalid("attempt record is invalid");
    if (TERMINAL_STATES.has(existing.state)) return snapshotRecord(existing);

    const status = captureSupervisorStatus(await options.container.status(), existing.envelope);
    const current = await readMatchingRecord(key, existing);
    if (current !== undefined && TERMINAL_STATES.has(current.state)) return snapshotRecord(current);
    const latest = current ?? existing;
    if (latest.state === "running" && status.state === "pending")
      invalid("supervisor status is invalid");
    const updated = snapshotRecord({
      ...latest,
      state: status.state,
      neonRunId: status.neonRunId,
      evidencePrefix: status.evidencePrefix,
      manifestPresent: status.manifestPresent,
      startedAt: status.startedAt,
      heartbeatAt: status.heartbeatAt,
      completedAt: status.completedAt,
      exitCode: status.exitCode,
      failureCode: status.failureCode,
    });
    await options.store.put(key, updated);
    if (TERMINAL_STATES.has(updated.state)) await stopAfterPersistence(options.container);
    return updated;
  }

  async function markUnknown(
    attemptId: string,
    code: string,
    stopContainer = true,
  ): Promise<AttemptRecord> {
    const capturedAttemptId = safeIdentifier(attemptId, "attempt id is invalid");
    const capturedCode = failureCode(code, "failure code is invalid");
    if (capturedCode === null) invalid("failure code is invalid");
    const key = `attempt:${capturedAttemptId}`;
    const stored = await options.store.get(key);
    if (stored === undefined) invalid("attempt record not found");
    const existing = captureAttemptRecord(stored);
    if (existing.envelope.attemptId !== capturedAttemptId) invalid("attempt record is invalid");
    if (TERMINAL_STATES.has(existing.state)) return snapshotRecord(existing);
    const updated = snapshotRecord({
      ...existing,
      state: "unknown",
      completedAt: captureNow(options),
      failureCode: capturedCode,
    });
    await options.store.put(key, updated);
    if (stopContainer) await stopAfterPersistence(options.container);
    return updated;
  }

  return Object.freeze({ claimAndStart, readAttempt, markUnknown });
}

export interface Env extends Cloudflare.Env {
  MLS_RUN_CONTAINER: DurableObjectNamespace<MlsRunContainer>;
  MLS_ENVIRONMENT: string;
  MLS_SCHEDULED_MODE: string;
  MLS_GIT_COMMIT_SHA: string;
  DATABASE_URL_UNPOOLED: string;
  BLOB_READ_WRITE_TOKEN?: string;
  MLS_CRAWLER_CONTACT_URL: string;
  MLS_MEDIA_ALLOWED_HOSTS: string;
  MLS_PUBLISH_ENABLED: string;
  MLS_MEDIA_RIGHTS_CONFIRMED: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  MLS_EVIDENCE_BUCKET: string;
  MLS_R2_ACCESS_KEY_ID: string;
  MLS_R2_SECRET_ACCESS_KEY: string;
  CLOUDFLARE_DEPLOYMENT_ID: string;
}

type PassedEnvironmentKey =
  | "DATABASE_URL_UNPOOLED"
  | "MLS_CRAWLER_CONTACT_URL"
  | "MLS_MEDIA_ALLOWED_HOSTS"
  | "MLS_PUBLISH_ENABLED"
  | "MLS_MEDIA_RIGHTS_CONFIRMED"
  | "CLOUDFLARE_ACCOUNT_ID"
  | "MLS_EVIDENCE_BUCKET"
  | "MLS_R2_ACCESS_KEY_ID"
  | "MLS_R2_SECRET_ACCESS_KEY";

const PASSED_ENVIRONMENT_KEYS: readonly PassedEnvironmentKey[] = [
  "DATABASE_URL_UNPOOLED",
  "MLS_CRAWLER_CONTACT_URL",
  "MLS_MEDIA_ALLOWED_HOSTS",
  "MLS_PUBLISH_ENABLED",
  "MLS_MEDIA_RIGHTS_CONFIRMED",
  "CLOUDFLARE_ACCOUNT_ID",
  "MLS_EVIDENCE_BUCKET",
  "MLS_R2_ACCESS_KEY_ID",
  "MLS_R2_SECRET_ACCESS_KEY",
];
const ACTIVE_ATTEMPT_KEY = "active-attempt-id";

export class MlsRunContainer extends Container<Env> {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = "5h";

  private coordinator?: ReturnType<typeof createAttemptCoordinator>;
  private activeAttemptId: string | null = null;

  private async rememberActiveAttempt(attemptId: string, allowNew: boolean): Promise<void> {
    const capturedAttemptId = safeIdentifier(attemptId, "attempt id is invalid");
    if (this.activeAttemptId !== null && this.activeAttemptId !== capturedAttemptId)
      invalid("active attempt does not match existing pointer");
    const stored = await this.ctx.storage.get(ACTIVE_ATTEMPT_KEY);
    if (stored !== undefined) {
      const storedAttemptId = safeIdentifier(stored, "active attempt pointer is invalid");
      if (storedAttemptId !== capturedAttemptId)
        invalid("active attempt does not match existing pointer");
    } else if (!allowNew) {
      const storedAttempt = await this.ctx.storage.get(`attempt:${capturedAttemptId}`);
      if (storedAttempt === undefined) invalid("attempt record not found");
      const capturedStoredAttempt = captureAttemptRecord(storedAttempt);
      if (capturedStoredAttempt.envelope.attemptId !== capturedAttemptId)
        invalid("attempt record is invalid");
      await this.ctx.storage.put(ACTIVE_ATTEMPT_KEY, capturedAttemptId);
    } else {
      await this.ctx.storage.put(ACTIVE_ATTEMPT_KEY, capturedAttemptId);
    }
    this.activeAttemptId = capturedAttemptId;
  }

  private async resolveActiveAttempt(): Promise<string | null> {
    if (this.activeAttemptId !== null) return this.activeAttemptId;
    const stored = await this.ctx.storage.get(ACTIVE_ATTEMPT_KEY);
    if (stored === undefined) return null;
    const capturedAttemptId = safeIdentifier(stored, "active attempt pointer is invalid");
    this.activeAttemptId = capturedAttemptId;
    return capturedAttemptId;
  }

  private environmentValue(name: keyof Env, required = true): string | undefined {
    const descriptor = Object.getOwnPropertyDescriptor(this.env, name);
    if (!descriptor || !("value" in descriptor)) {
      if (required) invalid("container environment is invalid");
      return undefined;
    }
    const value = descriptor.value;
    if (value === undefined && !required) return undefined;
    if (typeof value !== "string" || value.length === 0)
      invalid("container environment is invalid");
    return value;
  }

  private startEnvironment(input: ClaimAndStartInput): Record<string, string> {
    const envVars: Record<string, string> = {};
    for (const key of PASSED_ENVIRONMENT_KEYS) {
      const value = this.environmentValue(key);
      if (value !== undefined) envVars[key] = value;
    }
    if (input.envelope.mode === "publish") {
      const blobToken = this.environmentValue("BLOB_READ_WRITE_TOKEN");
      if (blobToken !== undefined) envVars.BLOB_READ_WRITE_TOKEN = blobToken;
    }
    const deploymentId = this.environmentValue("CLOUDFLARE_DEPLOYMENT_ID");
    if (deploymentId === undefined) invalid("container environment is invalid");
    envVars.MLS_EVIDENCE_BACKEND = "r2";
    envVars.MLS_ENVIRONMENT = input.envelope.environment;
    envVars.MLS_SCHEDULED_FOR = input.envelope.hkDate;
    envVars.MLS_ATTEMPT_ID = input.envelope.attemptId;
    envVars.MLS_COMMIT_SHA = input.envelope.commitSha;
    envVars.CLOUDFLARE_DEPLOYMENT_ID = deploymentId;
    envVars.MLS_WORKFLOW_INSTANCE_ID = input.workflowInstanceId;
    envVars.MLS_CONTAINER_ID = this.ctx.id.toString();
    envVars.MLS_ATTEMPT_STARTED_AT = new Date().toISOString();
    envVars.MLS_TERMINAL_STATUS_FILE = "/tmp/earnest-mls-terminal.json";
    return envVars;
  }

  private getCoordinator(): ReturnType<typeof createAttemptCoordinator> {
    if (this.coordinator) return this.coordinator;
    const deploymentId = this.environmentValue("CLOUDFLARE_DEPLOYMENT_ID");
    if (deploymentId === undefined) invalid("container environment is invalid");
    this.coordinator = createAttemptCoordinator({
      store: {
        get: (key) => this.ctx.storage.get(key),
        put: (key, value) => this.ctx.storage.put(key, value),
      },
      container: {
        start: async ({ envelope, token, envVars }) => {
          await this.startAndWaitForPorts({
            ports: [8080],
            startOptions: {
              envVars: { ...envVars, MLS_SUPERVISOR_TOKEN: token },
              enableInternet: true,
            },
            cancellationOptions: { portReadyTimeoutMS: 60_000 },
          });
          const response = await this.containerFetch("http://localhost/run", {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(envelope),
          });
          if (response.status !== 202) throw new Error("container supervisor rejected the attempt");
        },
        status: async () => {
          if (this.ctx.container?.running !== true) throw new Error("container is not running");
          const response = await this.containerFetch("http://localhost/status", {
            method: "GET",
          });
          if (response.status !== 200) throw new Error("container status is unavailable");
          const body: unknown = await response.json();
          return body;
        },
        stop: () => this.stop(),
      },
      containerId: this.ctx.id.toString(),
      containerDeploymentId: deploymentId,
      startEnvironment: (input) => this.startEnvironment(input),
      createToken: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
    });
    return this.coordinator;
  }

  async claimAndStart(input: ClaimAndStartInput): Promise<AttemptRecord> {
    const capturedInput = captureInput(input);
    await this.rememberActiveAttempt(capturedInput.envelope.attemptId, true);
    return this.getCoordinator().claimAndStart(capturedInput);
  }

  async readAttempt(attemptId: string): Promise<AttemptRecord> {
    const capturedAttemptId = safeIdentifier(attemptId, "attempt id is invalid");
    await this.rememberActiveAttempt(capturedAttemptId, false);
    return this.getCoordinator().readAttempt(capturedAttemptId);
  }

  async markUnknown(attemptId: string, code: string): Promise<AttemptRecord> {
    const capturedAttemptId = safeIdentifier(attemptId, "attempt id is invalid");
    await this.rememberActiveAttempt(capturedAttemptId, false);
    return this.getCoordinator().markUnknown(capturedAttemptId, code);
  }

  override async onStop(_params: StopParams): Promise<void> {
    const attemptId = await this.resolveActiveAttempt();
    if (attemptId === null) return;
    await this.getCoordinator().markUnknown(attemptId, "container_stopped", false);
  }

  override async onError(_error: unknown): Promise<void> {
    const attemptId = await this.resolveActiveAttempt();
    if (attemptId === null) return;
    await this.getCoordinator().markUnknown(attemptId, "container_runtime_error", false);
  }
}
