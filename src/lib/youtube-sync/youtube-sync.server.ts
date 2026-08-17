import "@tanstack/react-start/server-only";

import { createYouTubeClient, readYouTubeSyncConfig } from "./youtube-client.server";
import { hongKongMonthPeriod, planManualAdoptions } from "./youtube-reconciliation";
import { createYouTubeSyncRepository } from "./youtube-repository.server";
import {
  YOUTUBE_CHANNEL_ID,
  YOUTUBE_LEASE_RENEWAL_MS,
  YouTubeSyncError,
  type ManualVideoCandidate,
  type PlannedYouTubeVideo,
  type YouTubeFetchResult,
  type YouTubeMutationSummary,
  type YouTubePageProgress,
  type YouTubeSyncMode,
  type YouTubeSyncOutcome,
  type YouTubeSyncTrigger,
} from "./youtube-sync.types";

type ClientPort = {
  listUploads(input: {
    boundaryVideoId?: string | null;
    onPage?: (progress: YouTubePageProgress) => Promise<void>;
  }): Promise<YouTubeFetchResult>;
};

type RepositoryPort = {
  acquireLease(input: { channelId: string; owner: string; now: Date }): Promise<{
    channelId: string;
    owner: string;
    lastIncrementalVideoId: string | null;
    lastFullPeriod: string | null;
  } | null>;
  renewLease(input: { channelId: string; owner: string; now: Date }): Promise<boolean>;
  releaseLease(input: { channelId: string; owner: string; now: Date }): Promise<void>;
  listManualCandidates(): Promise<ManualVideoCandidate[]>;
  applySnapshot(input: {
    channelId: string;
    owner: string;
    mode: YouTubeSyncMode;
    videos: readonly PlannedYouTubeVideo[];
    newestVideoId: string | null;
    completedAt: Date;
    period: string | null;
  }): Promise<YouTubeMutationSummary>;
};

type TimersPort = {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
};

type Dependencies = {
  channelId?: string;
  owner?: () => string;
  now?: () => Date;
  client?: ClientPort;
  repository?: RepositoryPort;
  timers?: TimersPort;
  logger?: {
    info: (event: Record<string, unknown>) => void;
    error: (event: Record<string, unknown>) => void;
  };
};

const defaultLogger = {
  info(event: Record<string, unknown>) {
    console.info("[youtube-sync]", JSON.stringify(event));
  },
  error(event: Record<string, unknown>) {
    console.error("[youtube-sync]", JSON.stringify(event));
  },
};

const defaultTimers: TimersPort = {
  setInterval(callback, milliseconds) {
    return setInterval(callback, milliseconds);
  },
  clearInterval(handle) {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
};

function startLeaseHeartbeat(renew: () => Promise<void>, timers: TimersPort) {
  let failure: unknown = null;
  let inFlight = Promise.resolve();
  const timer = timers.setInterval(() => {
    inFlight = inFlight
      .then(async () => {
        if (!failure) await renew();
      })
      .catch((error) => {
        failure = error;
      });
  }, YOUTUBE_LEASE_RENEWAL_MS);

  return {
    async checkpoint() {
      await inFlight;
      if (failure) throw failure;
    },
    async stop() {
      timers.clearInterval(timer);
      await inFlight;
      if (failure) throw failure;
    },
  };
}

export async function runYouTubeSync(
  input: { mode: YouTubeSyncMode; trigger: YouTubeSyncTrigger },
  overrides: Dependencies = {},
): Promise<YouTubeSyncOutcome> {
  const now = overrides.now ?? (() => new Date());
  const startedAt = now();
  const owner = (overrides.owner ?? (() => crypto.randomUUID()))();
  const channelId = overrides.channelId ?? YOUTUBE_CHANNEL_ID;
  const logger = overrides.logger ?? defaultLogger;
  const repository = overrides.repository ?? createYouTubeSyncRepository();
  const client =
    overrides.client ??
    createYouTubeClient({
      ...readYouTubeSyncConfig(),
      channelId,
    });

  const lease = await repository.acquireLease({ channelId, owner, now: startedAt });
  if (!lease) {
    logger.info({
      event: "youtube_sync_skipped",
      mode: input.mode,
      trigger: input.trigger,
      reason: "sync_in_progress",
    });
    return { status: "skipped", reason: "sync_in_progress" };
  }

  async function renew() {
    const renewed = await repository.renewLease({ channelId, owner, now: now() });
    if (!renewed) {
      throw new YouTubeSyncError(
        "youtube_lease_lost",
        "The YouTube synchronization lease was lost.",
        true,
      );
    }
  }

  let startedHeartbeat: ReturnType<typeof startLeaseHeartbeat> | null = null;
  let primaryFailure: unknown = null;
  let primaryFailed = false;
  let outcome: Extract<YouTubeSyncOutcome, { status: "completed" }> | null = null;

  try {
    const heartbeat = startLeaseHeartbeat(renew, overrides.timers ?? defaultTimers);
    startedHeartbeat = heartbeat;
    const fetched = await client.listUploads({
      boundaryVideoId: input.mode === "incremental" ? lease.lastIncrementalVideoId : null,
      onPage: async () => {
        await heartbeat.checkpoint();
        await renew();
        await heartbeat.checkpoint();
      },
    });
    await heartbeat.checkpoint();
    const manualRows = await repository.listManualCandidates();
    const planned = planManualAdoptions(fetched.videos, manualRows);

    // This renewal is unconditional: it satisfies the immediate pre-mutation
    // checkpoint even when the last provider page completed moments ago.
    await heartbeat.checkpoint();
    await renew();
    const completedAt = now();
    const period = input.mode === "full" ? hongKongMonthPeriod(startedAt) : null;
    const mutations = await repository.applySnapshot({
      channelId,
      owner,
      mode: input.mode,
      videos: planned,
      newestVideoId: fetched.videos[0]?.videoId ?? null,
      completedAt,
      period,
    });
    const finishedAt = now();
    outcome = {
      status: "completed",
      summary: {
        mode: input.mode,
        trigger: input.trigger,
        pages: fetched.pages,
        fetched: fetched.videos.length,
        inserted: mutations.inserted,
        adopted: mutations.adopted,
        updated: mutations.updated,
        restored: mutations.restored,
        unavailable: mutations.unavailable,
        elapsedMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        period,
      },
    };
  } catch (error) {
    primaryFailed = true;
    primaryFailure = error;
  }

  let cleanupFailure: unknown = null;
  let cleanupFailed = false;
  if (startedHeartbeat) {
    const heartbeat = startedHeartbeat;
    try {
      await heartbeat.stop();
    } catch (error) {
      cleanupFailed = true;
      cleanupFailure = error;
    }
  }
  try {
    await repository.releaseLease({ channelId, owner, now: now() });
  } catch (error) {
    if (!cleanupFailed) cleanupFailure = error;
    cleanupFailed = true;
  }

  if (primaryFailed || cleanupFailed) {
    const failure = primaryFailed ? primaryFailure : cleanupFailure;
    logger.error({
      event: "youtube_sync_failed",
      mode: input.mode,
      trigger: input.trigger,
      code: failure instanceof YouTubeSyncError ? failure.code : "internal_error",
    });
    throw failure;
  }

  if (!outcome) {
    throw new YouTubeSyncError(
      "youtube_validation_error",
      "YouTube synchronization did not produce a result.",
    );
  }
  logger.info({ event: "youtube_sync_completed", ...outcome.summary });
  return outcome;
}
