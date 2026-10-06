export type JobLane = "service" | "general";
/** True only when OPS_WAKE_URL is a non-blank string; the former wake flag is ignored. */
export function wakeEnabledFromEnv(env: Record<string, string | undefined>): boolean;
export function createJobWake(ports: {
  enabled: boolean;
  waitUntil: (work: Promise<unknown>) => unknown;
  run: (lane: JobLane) => unknown;
  report?: (code: string) => void;
}): (lane: JobLane) => void;
export function signalJobWake(input: {
  url: string;
  secret: string;
  lane: JobLane;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<void>;
