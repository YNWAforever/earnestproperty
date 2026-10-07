export type JobLane = "service" | "general";
/** True only when OPS_WAKE_URL is non-blank and this is not a test run (NODE_TEST_CONTEXT / NODE_ENV=test). */
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
