import "@tanstack/react-start/server-only";

import { createYouTubeClient, readYouTubeSyncConfig } from "./youtube-client.server";
import { hongKongMonthPeriod, planManualAdoptions } from "./youtube-reconciliation";
import { createYouTubeSyncHistory, type YouTubeHistoryPort } from "./youtube-history.server";
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
    backfillVideoIds?: readonly string[];
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
  history?: YouTubeHistoryPort;
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
  input: {
    mode: YouTubeSyncMode;
    trigger: YouTubeSyncTrigger;
    backfillVideoIds?: readonly string[];
  },
  overrides: Dependencies = {},
): Promise<YouTubeSyncOutcome> {
  if (input.mode === "full" && input.backfillVideoIds?.length) {
    throw new YouTubeSyncError(
      "youtube_validation_error",
      "Targeted repair requires incremental mode.",
    );
  }
  const now = overrides.now ?? (() => new Date());
  const startedAt = now();
  const owner = (overrides.owner ?? (() => crypto.randomUUID()))();
  const channelId = overrides.channelId ?? YOUTUBE_CHANNEL_ID;
  const logger = overrides.logger ?? defaultLogger;
  const repository = overrides.repository ?? createYouTubeSyncRepository();
  // Injected repositories are isolated test ports; never fall back to a live history writer.
  const history =
    overrides.history ?? (overrides.repository ? undefined : createYouTubeSyncHistory());

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
    await history?.started({
      runId: owner,
      channelId,
      startedAt,
      mode: input.mode,
      trigger: input.trigger,
    });
    const client =
      overrides.client ?? createYouTubeClient({ ...readYouTubeSyncConfig(), channelId });
    const heartbeat = startLeaseHeartbeat(renew, overrides.timers ?? defaultTimers);
    startedHeartbeat = heartbeat;
    const fetched = await client.listUploads({
      boundaryVideoId: input.mode === "incremental" ? lease.lastIncrementalVideoId : null,
      backfillVideoIds: input.backfillVideoIds,
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
    await history
      ?.finished({
        runId: owner,
        channelId,
        startedAt,
        finishedAt: now(),
        mode: input.mode,
        trigger: input.trigger,
        status: outcome ? "partial" : "failed",
        summary: outcome?.summary ?? null,
        code: failure instanceof YouTubeSyncError ? failure.code : "internal_error",
      })
      .catch(() => {
        logger.error({ event: "youtube_status_record_failed" });
      });
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
  try {
    await history?.finished({
      runId: owner,
      channelId,
      startedAt,
      finishedAt: now(),
      mode: input.mode,
      trigger: input.trigger,
      status: "completed",
      summary: outcome.summary,
      code: null,
    });
  } catch {
    throw new YouTubeSyncError(
      "youtube_status_unavailable",
      "YouTube result could not be recorded.",
    );
  }
  logger.info({ event: "youtube_sync_completed", ...outcome.summary });
  return outcome;
}
