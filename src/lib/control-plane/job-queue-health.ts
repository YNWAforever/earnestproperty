// Pure: no DB, no env. health.server.ts gathers the facts; this decides.
import type { HealthCheck } from "./health.server.ts";

export type JobQueueThresholds = { overdueGraceMinutes: number; heartbeatStaleMinutes: number };

/**
 * FX-07 owner decision 4. The worker sweeps every 10 minutes from 08:00 to
 * 21:50 HKT and hourly overnight, so the tolerances follow the HKT clock:
 * - day: three 10-minute ticks before a heartbeat is stale; a job is overdue
 *   once it has waited one tick plus 5 minutes;
 * - night: one hourly tick plus 30 minutes before a heartbeat is stale; a job
 *   is overdue once it has waited one hourly tick plus 15 minutes.
 */
export const DAY_JOB_QUEUE_THRESHOLDS: JobQueueThresholds = Object.freeze({
  overdueGraceMinutes: 15,
  heartbeatStaleMinutes: 30,
});
export const NIGHT_JOB_QUEUE_THRESHOLDS: JobQueueThresholds = Object.freeze({
  overdueGraceMinutes: 75,
  heartbeatStaleMinutes: 90,
});
// Decision 4's day window, shifted by one stale window after the first
// 10-minute tick so the 07:00 heartbeat is not judged by the day threshold.
// The cadence itself is unchanged: every 10 minutes from 08:00 HKT.
export const DAY_START_MINUTE_HKT = 8 * 60 + 30;
export const NIGHT_START_MINUTE_HKT = 22 * 60;

const hktClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Hong_Kong",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function hktMinuteOfDay(now: Date) {
  const parts = hktClock.formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return value("hour") * 60 + value("minute");
}

/** The one place that picks day or night tolerances, from `now` in Asia/Hong_Kong. */
export function jobQueueThresholds(now: Date): JobQueueThresholds {
  const minute = hktMinuteOfDay(now);
  return minute >= DAY_START_MINUTE_HKT && minute < NIGHT_START_MINUTE_HKT
    ? { ...DAY_JOB_QUEUE_THRESHOLDS }
    : { ...NIGHT_JOB_QUEUE_THRESHOLDS };
}

/** Missing or older than the threshold. A heartbeat from the future (clock skew) is fresh. */
export function heartbeatIsStale(
  heartbeatAt: string | null,
  now: Date,
  staleAfterMinutes: number,
): boolean {
  if (!heartbeatAt) return true;
  const seen = Date.parse(heartbeatAt);
  if (!Number.isFinite(seen)) return true;
  return now.getTime() - seen > staleAfterMinutes * 60_000;
}

export type JobQueueFacts = {
  overdueQueued: number;
  expiredLeases: number;
  serviceHeartbeatAt: string | null;
  generalHeartbeatAt: string | null;
  wakeConfigured: boolean;
};

function ageMinutes(heartbeatAt: string, now: Date) {
  return Math.max(0, Math.round((now.getTime() - Date.parse(heartbeatAt)) / 60_000));
}

export function assessJobQueueHealth(
  facts: JobQueueFacts,
  now: Date,
  thresholds: JobQueueThresholds = jobQueueThresholds(now),
): HealthCheck {
  const details = {
    wakeConfigured: facts.wakeConfigured,
    serviceHeartbeatFresh: !heartbeatIsStale(
      facts.serviceHeartbeatAt,
      now,
      thresholds.heartbeatStaleMinutes,
    ),
    generalHeartbeatFresh: !heartbeatIsStale(
      facts.generalHeartbeatAt,
      now,
      thresholds.heartbeatStaleMinutes,
    ),
    noOverdueJobs: facts.overdueQueued === 0,
    noExpiredLeases: facts.expiredLeases === 0,
  };
  const beats = [facts.serviceHeartbeatAt, facts.generalHeartbeatAt];
  const oldestHeartbeatMinutes = beats.every((beat) => beat && Number.isFinite(Date.parse(beat)))
    ? Math.max(...beats.map((beat) => ageMinutes(beat!, now)))
    : null;
  return {
    key: "jobs.queue",
    // Can make the badge 降級, never 故障.
    required: false,
    status: Object.values(details).every(Boolean) ? "healthy" : "degraded",
    details,
    facts: {
      overdueQueued: facts.overdueQueued,
      expiredLeases: facts.expiredLeases,
      oldestHeartbeatMinutes,
    },
  };
}
