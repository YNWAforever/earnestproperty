export const YOUTUBE_CHANNEL_ID = "UCTwcj9hcQoKVpKEZY-ZgnwA" as const;
export const YOUTUBE_LEASE_MS = 15 * 60 * 1_000;
export const YOUTUBE_LEASE_RENEWAL_MS = 3 * 60 * 1_000;

export type YouTubeSyncMode = "incremental" | "full";
export type YouTubeSyncTrigger = "cron" | "staff";

export type YouTubeProviderErrorCode =
  | "youtube_quota_exhausted"
  | "youtube_auth_failed"
  | "youtube_rate_limited"
  | "youtube_unavailable"
  | "youtube_invalid_snapshot";

export type YouTubeSyncErrorCode =
  | YouTubeProviderErrorCode
  | "youtube_sync_in_progress"
  | "youtube_lease_lost"
  | "youtube_validation_error";

export class YouTubeSyncError extends Error {
  readonly code: YouTubeSyncErrorCode;
  readonly retryable: boolean;

  constructor(code: YouTubeSyncErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "YouTubeSyncError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type YouTubeVideo = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  canonicalUrl: string;
};

export type PlannedYouTubeVideo = YouTubeVideo & {
  adoptionId: string | null;
  expectedManualUrl: string | null;
};

export type ManualVideoCandidate = {
  id: string;
  videoUrl: string;
};

export type YouTubePageProgress = {
  pageNumber: number;
  itemCount: number;
};

export type YouTubeFetchResult = {
  videos: YouTubeVideo[];
  pages: number;
  boundaryFound: boolean;
};

export type YouTubeMutationSummary = {
  inserted: number;
  adopted: number;
  updated: number;
  restored: number;
  unavailable: number;
};

export type YouTubeSyncSummary = YouTubeMutationSummary & {
  mode: YouTubeSyncMode;
  trigger: YouTubeSyncTrigger;
  pages: number;
  fetched: number;
  elapsedMs: number;
  period: string | null;
};

export type YouTubeSyncOutcome =
  | { status: "completed"; summary: YouTubeSyncSummary }
  | { status: "skipped"; reason: "sync_in_progress" };
