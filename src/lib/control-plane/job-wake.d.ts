export type JobLane = "service" | "general";
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
