export type JobLane = "service" | "general";

export const JOB_LANES: readonly JobLane[];

export const LANE_ENDPOINTS: Readonly<Record<JobLane, string>>;

export function createJobAlarm(input: {
  storage: DurableObjectStorage;
  drain: () => Promise<string | null>;
  now?: () => number;
  report?: (code: string) => void;
}): {
  signal(): Promise<void>;
  fire(): Promise<void>;
  sweep(): Promise<void>;
};

/**
 * POST origin+path with Bearer, redirect:"manual"; 3xx -> JOB_DRAIN_REDIRECTED; !ok -> JOB_DRAIN_HTTP_<n>;
 * origin must be https (or http://localhost) with no path -> else JOB_DRAIN_ORIGIN_INVALID.
 */
export function createLaneDrain(input: {
  origin: string;
  path: string;
  secret: string;
  fetcher?: typeof fetch;
}): () => Promise<string | null>;

/** Sweeps every lane with allSettled; a failing lane reports JOB_SWEEP_FAILED:<lane> and never blocks the other. */
export function sweepLanes(
  getLane: (lane: JobLane) => { sweep(): Promise<void> },
  report?: (code: string) => void,
): Promise<void>;
