import type { YouTubeSyncStatus } from "@/lib/youtube-sync/youtube-status.types";

const priorSuccess = "2026-10-14T19:00:00+08:00";
const unknown: YouTubeSyncStatus = {
  status: "never",
  lastAttempt: null,
  lastSuccess: null,
  inserted: null,
  adopted: null,
  updated: null,
  failed: null,
  code: null,
};

export const statusCases = {
  never: unknown,
  failed: {
    ...unknown,
    status: "failed",
    lastAttempt: "2026-10-16T03:00:00+08:00",
    lastSuccess: priorSuccess,
    inserted: 0,
    adopted: 0,
    updated: 0,
    failed: 1,
    code: "youtube_quota_exhausted",
  },
  partial: {
    ...unknown,
    status: "partial",
    lastAttempt: "2026-10-16T03:00:00+08:00",
    lastSuccess: priorSuccess,
    inserted: 2,
    adopted: 1,
    updated: 3,
    failed: 1,
    code: "SYNTHETIC_INTERNAL_SECRET",
  },
  interrupted: {
    ...unknown,
    status: "interrupted",
    lastAttempt: "2026-10-16T03:00:00+08:00",
    code: "SYNTHETIC_INTERNAL_SECRET",
  },
} satisfies Record<string, YouTubeSyncStatus>;

export type StatusCase = keyof typeof statusCases;
