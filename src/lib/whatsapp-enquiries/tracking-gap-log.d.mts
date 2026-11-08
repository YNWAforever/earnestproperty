export const UNPROVISIONED_LOG_INTERVAL_MS: number;
export const GAP_SAMPLE_LIMIT: number;

export type TrackingCandidate = {
  propertyId: string;
  candidateCount: number;
  code?: string | null;
};

export type TrackingGapSample = { propertyId: string; candidateCount: number };

export type TrackingGapClassification = {
  total: number;
  missing: TrackingGapSample[];
  ambiguous: TrackingGapSample[];
  unprovisioned: boolean;
};

export type TrackingGapLogEntry = {
  code: string;
  throttled: boolean;
  payload: Record<string, unknown>;
};

export function classifyTrackingGaps(
  candidates: ReadonlyArray<TrackingCandidate>,
): TrackingGapClassification;

export function trackingGapLogEntries(
  classification: TrackingGapClassification,
): TrackingGapLogEntry[];

export function unprovisionedLogDue(
  now: number,
  lastLoggedAt: number,
  intervalMs?: number,
): boolean;
