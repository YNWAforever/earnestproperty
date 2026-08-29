import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import type { AttemptRecord, ClaimAndStartInput, Env } from "./container";
import { buildRunEnvelope, type RunEnvelope, type RunMode } from "./run-contract";

const SCHEDULE_CRON = "0 18 * * *";
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const TERMINAL_STATES = new Set<AttemptRecord["state"]>(["succeeded", "failed", "unknown"]);
export type WorkflowPayload = ManualRunParams | Record<string, never>;

export interface ManualRunParams {
  kind: "manual";
  mode: "shadow" | "publish";
  reason: string;
  suffix: string;
  scheduledTime: string;
}

export interface WorkflowPorts {
  containerFor(attemptId: string): {
    claimAndStart(input: ClaimAndStartInput): Promise<AttemptRecord>;
    readAttempt(attemptId: string): Promise<AttemptRecord>;
    markUnknown(attemptId: string, failureCode: string): Promise<AttemptRecord>;
  };
}

function invalid(message: string): never {
  throw new TypeError(message);
}

function ownValue(object: object, name: string, message: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, name);
  if (!descriptor || !("value" in descriptor)) invalid(message);
  return descriptor.value;
}

function requiredRuntimeString(env: Env, name: string): string {
  const value = ownValue(env, name, name + " is required");
  if (typeof value !== "string" || value.length === 0) invalid(name + " is required");
  return value;
}

function requiredRuntimeShape(env: Env, name: string): string {
  const value = requiredRuntimeString(env, name);
  if (value.length > 512) invalid(name + " is invalid");
  return value;
}

function validateDatabaseUrl(value: string): void {
  try {
    const url = new URL(value);
    if ((url.protocol !== "postgres:" && url.protocol !== "postgresql:") || !url.hostname)
      invalid("DATABASE_URL_UNPOOLED is invalid");
  } catch {
    invalid("DATABASE_URL_UNPOOLED is invalid");
  }
}

function validateContactUrl(value: string): void {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password)
      invalid("MLS_CRAWLER_CONTACT_URL is invalid");
  } catch {
    invalid("MLS_CRAWLER_CONTACT_URL is invalid");
  }
}

function validateMediaHosts(value: string): void {
  const hosts = value
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (hosts.length === 0 || new Set(hosts).size !== hosts.length)
    invalid("MLS_MEDIA_ALLOWED_HOSTS is invalid");
  for (const host of hosts) {
    if (host.includes("/") || host.includes("@") || host.includes(":"))
      invalid("MLS_MEDIA_ALLOWED_HOSTS is invalid");
    try {
      const url = new URL("https://" + host);
      if (url.hostname !== host || url.pathname !== "/")
        invalid("MLS_MEDIA_ALLOWED_HOSTS is invalid");
    } catch {
      invalid("MLS_MEDIA_ALLOWED_HOSTS is invalid");
    }
  }
}

function hasExactKeys(object: object, keys: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(object);
  return (
    ownKeys.length === keys.length &&
    ownKeys.every((key) => typeof key === "string" && keys.includes(key))
  );
}

function payloadObject(input: unknown, message: string): Record<string, unknown> {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  )
    invalid(message);
  return input as Record<string, unknown>;
}

function requireEventString(event: object, name: string, message: string): string {
  const value = ownValue(event, name, message);
  if (typeof value !== "string" || value.length === 0) invalid(message);
  return value;
}

function runtimeEnvironment(env: Env): "preview" | "production" {
  const value = requiredRuntimeShape(env, "MLS_ENVIRONMENT");
  if (value !== "preview" && value !== "production") invalid("MLS_ENVIRONMENT is invalid");
  return value;
}

function runtimeMode(value: unknown, name: string): RunMode {
  if (value !== "shadow" && value !== "publish") invalid(name + " is invalid");
  return value as RunMode;
}

function runtimeCommitSha(env: Env): string {
  const value = requiredRuntimeString(env, "MLS_GIT_COMMIT_SHA");
  if (!COMMIT_SHA_PATTERN.test(value)) invalid("MLS_GIT_COMMIT_SHA is invalid");
  return value;
}

function captureManualPayload(input: unknown): ManualRunParams {
  const payload = payloadObject(input, "manual workflow payload is invalid");
  const keys = ["kind", "mode", "reason", "suffix", "scheduledTime"] as const;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(payload, key))
      invalid("manual workflow " + key + " is invalid");
  }
  if (!hasExactKeys(payload, keys)) invalid("manual workflow payload is invalid");
  const kind = ownValue(payload, "kind", "manual workflow kind is invalid");
  if (kind !== "manual") invalid("manual workflow kind is invalid");
  const mode = runtimeMode(
    ownValue(payload, "mode", "manual workflow mode is invalid"),
    "manual workflow mode",
  );
  const reason = ownValue(payload, "reason", "manual workflow reason is invalid");
  if (typeof reason !== "string") invalid("manual workflow reason is invalid");
  const suffix = ownValue(payload, "suffix", "manual workflow suffix is invalid");
  if (typeof suffix !== "string") invalid("manual workflow suffix is invalid");
  const scheduledTime = ownValue(
    payload,
    "scheduledTime",
    "manual workflow scheduledTime is invalid",
  );
  if (typeof scheduledTime !== "string") invalid("manual workflow scheduledTime is invalid");
  return { kind: "manual", mode, reason, suffix, scheduledTime };
}

function scheduledTimeFromEvent(event: object): number {
  const schedule = ownValue(event, "schedule", "scheduled schedule is required");
  const value = payloadObject(schedule, "scheduled schedule is invalid");
  if (!hasExactKeys(value, ["cron", "scheduledTime"])) invalid("scheduled schedule is invalid");
  const cron = ownValue(value, "cron", "scheduled cron is invalid");
  if (cron !== SCHEDULE_CRON) invalid("scheduled cron is invalid");
  const scheduledTime = ownValue(value, "scheduledTime", "scheduled time is invalid");
  if (typeof scheduledTime !== "number" || !Number.isFinite(scheduledTime))
    invalid("scheduled time is invalid");
  return scheduledTime;
}

export function buildEnvelopeFromEvent(
  event: WorkflowEvent<WorkflowPayload>,
  env: Env,
): Readonly<RunEnvelope> {
  const eventObject = payloadObject(event, "workflow event is invalid");
  const environment = runtimeEnvironment(env);
  const commitSha = runtimeCommitSha(env);
  const scheduleDescriptor = Object.getOwnPropertyDescriptor(eventObject, "schedule");
  if (scheduleDescriptor && !("value" in scheduleDescriptor))
    invalid("workflow schedule is invalid");
  const schedule = scheduleDescriptor?.value;
  if (scheduleDescriptor) {
    if (schedule === null) invalid("scheduled schedule is invalid");
    const payload = payloadObject(
      ownValue(eventObject, "payload", "workflow payload is invalid"),
      "scheduled workflow payload is invalid",
    );
    if (!hasExactKeys(payload, [])) invalid("scheduled workflow payload is invalid");
    return buildRunEnvelope({
      environment,
      scheduledTime: scheduledTimeFromEvent(eventObject),
      kind: "scheduled",
      mode: runtimeMode(requiredRuntimeShape(env, "MLS_SCHEDULED_MODE"), "MLS_SCHEDULED_MODE"),
      commitSha,
    });
  }

  const payload = captureManualPayload(
    ownValue(eventObject, "payload", "manual workflow payload is invalid"),
  );
  return buildRunEnvelope({
    environment,
    scheduledTime: payload.scheduledTime,
    kind: "manual",
    mode: payload.mode,
    manualReason: payload.reason,
    manualSuffix: payload.suffix,
    commitSha,
  });
}

export function assertRuntimeConfiguration(env: Env, mode: RunMode): void {
  validateDatabaseUrl(requiredRuntimeString(env, "DATABASE_URL_UNPOOLED"));
  validateContactUrl(requiredRuntimeShape(env, "MLS_CRAWLER_CONTACT_URL"));
  validateMediaHosts(requiredRuntimeShape(env, "MLS_MEDIA_ALLOWED_HOSTS"));
  requiredRuntimeShape(env, "CLOUDFLARE_ACCOUNT_ID");
  requiredRuntimeShape(env, "MLS_EVIDENCE_BUCKET");
  requiredRuntimeShape(env, "MLS_R2_ACCESS_KEY_ID");
  requiredRuntimeShape(env, "MLS_R2_SECRET_ACCESS_KEY");
  requiredRuntimeShape(env, "CLOUDFLARE_DEPLOYMENT_ID");

  const publishEnabled = requiredRuntimeString(env, "MLS_PUBLISH_ENABLED");
  const rightsConfirmed = requiredRuntimeString(env, "MLS_MEDIA_RIGHTS_CONFIRMED");
  if (publishEnabled !== "true" && publishEnabled !== "false")
    invalid("MLS_PUBLISH_ENABLED is invalid");
  if (rightsConfirmed !== "true" && rightsConfirmed !== "false")
    invalid("MLS_MEDIA_RIGHTS_CONFIRMED is invalid");
  if (mode === "publish") {
    if (publishEnabled !== "true") invalid("MLS_PUBLISH_ENABLED is not enabled");
    if (rightsConfirmed !== "true") invalid("MLS_MEDIA_RIGHTS_CONFIRMED is not confirmed");
    requiredRuntimeString(env, "BLOB_READ_WRITE_TOKEN");
  }
}

function workflowInstanceId(event: WorkflowEvent<WorkflowPayload>): string {
  const value = requireEventString(event, "instanceId", "workflow instance id is invalid");
  if (value.length > 160) invalid("workflow instance id is invalid");
  return value;
}

function isTerminal(state: AttemptRecord["state"]): boolean {
  return TERMINAL_STATES.has(state);
}

export async function runMlsWorkflow(input: {
  event: WorkflowEvent<WorkflowPayload>;
  step: WorkflowStep;
  env: Env;
  ports: WorkflowPorts;
}): Promise<AttemptRecord> {
  const envelope = buildEnvelopeFromEvent(input.event, input.env);
  assertRuntimeConfiguration(input.env, envelope.mode);
  const instanceId = workflowInstanceId(input.event);
  const container = input.ports.containerFor(envelope.attemptId);
  let record = await input.step.do("claim-and-start", async () =>
    container.claimAndStart({
      envelope,
      workflowInstanceId: instanceId,
    }),
  );
  if (isTerminal(record.state)) return record;

  for (let index = 1; index <= 240; index += 1) {
    await input.step.sleep("poll-wait-" + index, "1 minute");
    try {
      record = await input.step.do("poll-status-" + index, async () =>
        container.readAttempt(envelope.attemptId),
      );
    } catch {
      return input.step.do("mark-status-unknown", async () =>
        container.markUnknown(envelope.attemptId, "workflow_status_unknown"),
      );
    }
    if (isTerminal(record.state)) return record;
  }
  return input.step.do("mark-deadline-unknown", async () =>
    container.markUnknown(envelope.attemptId, "workflow_poll_deadline"),
  );
}

export class MlsRunWorkflow extends WorkflowEntrypoint<Env, WorkflowPayload> {
  override async run(
    event: Readonly<WorkflowEvent<WorkflowPayload>>,
    step: WorkflowStep,
  ): Promise<AttemptRecord> {
    return runMlsWorkflow({
      event,
      step,
      env: this.env,
      ports: {
        containerFor: (attemptId) => this.env.MLS_RUN_CONTAINER.getByName(attemptId),
      },
    });
  }
}
