const HK_OFFSET_MS = 8 * 60 * 60 * 1_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_SUFFIX_PATTERN = /^[a-z0-9][a-z0-9-]{7,63}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const TERMINAL_STATES = new Set<RunState>(["succeeded", "failed", "unknown"]);
const ALLOWED_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  pending: ["running", "failed", "unknown"],
  running: ["succeeded", "failed", "unknown"],
  succeeded: [],
  failed: [],
  unknown: [],
};

export type RunMode = "shadow" | "publish";
export type RunState = "pending" | "running" | "succeeded" | "failed" | "unknown";

export interface RunEnvelope {
  environment: "preview" | "production";
  hkDate: string;
  attemptId: string;
  kind: "scheduled" | "manual";
  mode: RunMode;
  scheduledTime: string;
  manualReason: string | null;
  commitSha: string;
}

interface EnvelopeInput {
  environment: "preview" | "production";
  scheduledTime: number | string | Date;
  kind: "scheduled" | "manual";
  mode: RunMode;
  manualReason?: string | null;
  manualSuffix?: string | null;
  commitSha: string;
}

function requireDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new TypeError("scheduled time is invalid");
  return value;
}

export function hongKongDate(scheduledTime: number | string | Date): string {
  const date = requireDate(new Date(scheduledTime));
  return new Date(date.getTime() + HK_OFFSET_MS).toISOString().slice(0, 10);
}

export function scheduledAttemptId(environment: string, hkDate: string): string {
  if (!/^(preview|production)$/.test(environment) || !DATE_PATTERN.test(hkDate)) {
    throw new TypeError("scheduled attempt identity is invalid");
  }
  return `scheduled:${environment}:${hkDate}`;
}

export function buildRunEnvelope(input: unknown): Readonly<RunEnvelope> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("run envelope input is invalid");
  }
  const value = input as EnvelopeInput;
  const scheduled = requireDate(new Date(value.scheduledTime));
  const hkDate = hongKongDate(scheduled);
  const environment = value.environment;
  if (typeof environment !== "string" || !/^(preview|production)$/.test(environment)) {
    throw new TypeError("run environment is invalid");
  }
  const mode = value.mode;
  if (typeof mode !== "string" || !/^(shadow|publish)$/.test(mode))
    throw new TypeError("run mode is invalid");
  const commitSha = value.commitSha;
  if (typeof commitSha !== "string" || !SHA_PATTERN.test(commitSha))
    throw new TypeError("commit SHA is invalid");
  const kind = value.kind;
  if (kind !== "scheduled" && kind !== "manual") {
    throw new TypeError("run kind is invalid");
  }
  let attemptId = scheduledAttemptId(environment, hkDate);
  let manualReason: string | null = null;
  if (kind === "manual") {
    const suppliedManualReason = value.manualReason;
    manualReason = typeof suppliedManualReason === "string" ? suppliedManualReason.trim() : "";
    if (manualReason.length < 8 || manualReason.length > 240) {
      throw new TypeError("manual reason is invalid");
    }
    const manualSuffix = value.manualSuffix;
    if (typeof manualSuffix !== "string" || !SAFE_SUFFIX_PATTERN.test(manualSuffix)) {
      throw new TypeError("manual suffix is invalid");
    }
    attemptId = `${attemptId}:manual:${manualSuffix}`;
  }
  return Object.freeze({
    environment,
    hkDate,
    attemptId,
    kind,
    mode,
    scheduledTime: scheduled.toISOString(),
    manualReason,
    commitSha,
  });
}

export function transitionRunState(current: RunState, next: RunState): RunState {
  if (TERMINAL_STATES.has(current)) throw new TypeError("run state is terminal");
  if (!ALLOWED_TRANSITIONS[current].includes(next)) {
    throw new TypeError(`run transition ${current} -> ${next} is invalid`);
  }
  return next;
}
