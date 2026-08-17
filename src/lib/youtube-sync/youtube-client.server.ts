import "@tanstack/react-start/server-only";

import { canonicalYouTubeUrl } from "./youtube-reconciliation";
import {
  YOUTUBE_CHANNEL_ID,
  YouTubeSyncError,
  type YouTubeFetchResult,
  type YouTubePageProgress,
  type YouTubeProviderErrorCode,
  type YouTubeVideo,
} from "./youtube-sync.types";

const API_ROOT = "https://www.googleapis.com/youtube/v3";
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 500;
const RFC3339_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

type FetchLike = typeof fetch;
type Sleep = (milliseconds: number) => Promise<void>;

type YouTubeClientDependencies = {
  apiKey: string;
  channelId?: string;
  fetchImpl?: FetchLike;
  sleep?: Sleep;
  random?: () => number;
};

type ListUploadsInput = {
  boundaryVideoId?: string | null;
  onPage?: (progress: YouTubePageProgress) => Promise<void>;
};

export function readYouTubeSyncConfig(env: Record<string, string | undefined> = process.env) {
  const apiKey = env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    throw new YouTubeSyncError("youtube_auth_failed", "YouTube synchronization is not configured.");
  }
  return { apiKey, channelId: YOUTUBE_CHANNEL_ID };
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function isStrictRfc3339Timestamp(value: string) {
  const match = value.match(RFC3339_TIMESTAMP);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[7]);
  const offsetMinute = Number(match[8]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    (match[7] === undefined || (offsetHour <= 23 && offsetMinute <= 59)) &&
    Number.isFinite(Date.parse(value))
  );
}

function hasConsistentPageInfo(value: unknown, itemCount: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pageInfo = value as Record<string, unknown>;
  const totalResults = pageInfo.totalResults;
  const resultsPerPage = pageInfo.resultsPerPage;
  if (
    typeof totalResults !== "number" ||
    typeof resultsPerPage !== "number" ||
    !Number.isSafeInteger(totalResults) ||
    !Number.isSafeInteger(resultsPerPage)
  ) {
    return false;
  }
  return totalResults >= itemCount && resultsPerPage >= itemCount && resultsPerPage <= 50;
}

function providerReason(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const error = "error" in body && body.error && typeof body.error === "object" ? body.error : null;
  const errors = error && "errors" in error && Array.isArray(error.errors) ? error.errors : [];
  const first = errors[0];
  return first && typeof first === "object" && "reason" in first ? String(first.reason) : "";
}

function classifyProviderError(status: number, reason: string): YouTubeProviderErrorCode {
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
    return "youtube_quota_exhausted";
  }
  if (status === 429 || reason === "userRateLimitExceeded" || reason === "rateLimitExceeded") {
    return "youtube_rate_limited";
  }
  if (
    status === 401 ||
    reason === "keyInvalid" ||
    reason === "accessNotConfigured" ||
    reason === "forbidden"
  ) {
    return "youtube_auth_failed";
  }
  return "youtube_unavailable";
}

function retryAfterMilliseconds(response: Response) {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

async function requestJson(
  url: URL,
  dependencies: Required<Pick<YouTubeClientDependencies, "fetchImpl" | "sleep" | "random">>,
) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await dependencies.fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    } catch {
      if (attempt + 1 === MAX_ATTEMPTS) {
        throw new YouTubeSyncError(
          "youtube_unavailable",
          "YouTube is temporarily unavailable.",
          true,
        );
      }
      await dependencies.sleep(
        BASE_BACKOFF_MS * 2 ** attempt + Math.floor(dependencies.random() * 250),
      );
      continue;
    }

    const body = await response.json().catch(() => null);
    if (response.ok) return body;

    const reason = providerReason(body);
    const code = classifyProviderError(response.status, reason);
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt + 1 === MAX_ATTEMPTS) {
      throw new YouTubeSyncError(
        code,
        "YouTube could not complete the synchronization request.",
        retryable,
      );
    }
    const retryAfter = retryAfterMilliseconds(response);
    const backoff = BASE_BACKOFF_MS * 2 ** attempt + Math.floor(dependencies.random() * 250);
    await dependencies.sleep(retryAfter ?? backoff);
  }
  throw new YouTubeSyncError("youtube_unavailable", "YouTube is temporarily unavailable.", true);
}

export function createYouTubeClient(input: YouTubeClientDependencies) {
  const apiKey = input.apiKey.trim();
  const channelId = YOUTUBE_CHANNEL_ID;
  if (!apiKey || (input.channelId !== undefined && input.channelId !== YOUTUBE_CHANNEL_ID)) {
    throw new YouTubeSyncError("youtube_auth_failed", "YouTube synchronization is not configured.");
  }
  const dependencies = {
    fetchImpl: input.fetchImpl ?? fetch,
    sleep: input.sleep ?? defaultSleep,
    random: input.random ?? Math.random,
  };

  async function uploadsPlaylistId() {
    const url = new URL(`${API_ROOT}/channels`);
    url.searchParams.set("part", "contentDetails");
    url.searchParams.set("id", channelId);
    url.searchParams.set("key", apiKey);
    const responseBody = await requestJson(url, dependencies);
    const body =
      responseBody && typeof responseBody === "object"
        ? (responseBody as Record<string, unknown>)
        : null;
    const items = Array.isArray(body?.items) ? body.items : [];
    const channel = items[0] as Record<string, unknown> | undefined;
    const contentDetails = channel?.contentDetails as Record<string, unknown> | undefined;
    const related = contentDetails?.relatedPlaylists as Record<string, unknown> | undefined;
    const uploads = typeof related?.uploads === "string" ? related.uploads : "";
    if (channel?.id !== channelId || !uploads) {
      throw new YouTubeSyncError(
        "youtube_invalid_snapshot",
        "The provider returned an invalid YouTube channel snapshot.",
      );
    }
    return uploads;
  }

  function normalizePlaylistItem(value: unknown): YouTubeVideo {
    if (!value || typeof value !== "object") {
      throw new YouTubeSyncError(
        "youtube_invalid_snapshot",
        "The provider returned an invalid YouTube snapshot.",
      );
    }
    const item = value as Record<string, unknown>;
    const snippet = item.snippet as Record<string, unknown> | undefined;
    const content = item.contentDetails as Record<string, unknown> | undefined;
    const resource = snippet?.resourceId as Record<string, unknown> | undefined;
    const contentVideoId = typeof content?.videoId === "string" ? content.videoId : "";
    const resourceVideoId = typeof resource?.videoId === "string" ? resource.videoId : "";
    const videoId = contentVideoId || resourceVideoId;
    const snippetChannelId = typeof snippet?.channelId === "string" ? snippet.channelId : null;
    const videoOwnerChannelId =
      typeof snippet?.videoOwnerChannelId === "string" ? snippet.videoOwnerChannelId : null;
    const title = typeof snippet?.title === "string" ? snippet.title.trim() : "";
    const description = typeof snippet?.description === "string" ? snippet.description : "";
    const publishedAt =
      typeof content?.videoPublishedAt === "string"
        ? content.videoPublishedAt
        : typeof snippet?.publishedAt === "string"
          ? snippet.publishedAt
          : "";

    if (
      !/^[A-Za-z0-9_-]{11}$/.test(videoId) ||
      (contentVideoId && resourceVideoId && contentVideoId !== resourceVideoId) ||
      (snippetChannelId !== null && snippetChannelId !== channelId) ||
      (videoOwnerChannelId !== null && videoOwnerChannelId !== channelId) ||
      (!snippetChannelId && !videoOwnerChannelId) ||
      !title ||
      !isStrictRfc3339Timestamp(publishedAt)
    ) {
      throw new YouTubeSyncError(
        "youtube_invalid_snapshot",
        "The provider returned an invalid YouTube snapshot.",
      );
    }
    return {
      videoId,
      title,
      description,
      publishedAt: new Date(publishedAt).toISOString(),
      canonicalUrl: canonicalYouTubeUrl(videoId),
    };
  }

  async function listUploads(listInput: ListUploadsInput = {}): Promise<YouTubeFetchResult> {
    const playlistId = await uploadsPlaylistId();
    const videos: YouTubeVideo[] = [];
    const seenVideoIds = new Set<string>();
    const seenTokens = new Set<string>();
    let pageToken: string | null = null;
    let pageNumber = 0;
    let boundaryFound = false;

    do {
      const url = new URL(`${API_ROOT}/playlistItems`);
      url.searchParams.set("part", "snippet,contentDetails");
      url.searchParams.set("playlistId", playlistId);
      url.searchParams.set("maxResults", "50");
      url.searchParams.set("key", apiKey);
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const responseBody = await requestJson(url, dependencies);
      const body =
        responseBody && typeof responseBody === "object"
          ? (responseBody as Record<string, unknown>)
          : null;
      if (!body || !Array.isArray(body.items)) {
        throw new YouTubeSyncError(
          "youtube_invalid_snapshot",
          "The provider returned an invalid YouTube snapshot.",
        );
      }
      if (
        (Object.prototype.hasOwnProperty.call(body, "nextPageToken") &&
          (typeof body.nextPageToken !== "string" || !body.nextPageToken.trim())) ||
        (Object.prototype.hasOwnProperty.call(body, "pageInfo") &&
          !hasConsistentPageInfo(body.pageInfo, body.items.length))
      ) {
        throw new YouTubeSyncError(
          "youtube_invalid_snapshot",
          "The provider returned an invalid YouTube snapshot.",
        );
      }
      pageNumber += 1;
      const pageVideos: YouTubeVideo[] = [];
      for (const rawItem of body.items) {
        const item = normalizePlaylistItem(rawItem);
        if (seenVideoIds.has(item.videoId)) {
          throw new YouTubeSyncError(
            "youtube_invalid_snapshot",
            "The provider returned an invalid YouTube snapshot.",
          );
        }
        seenVideoIds.add(item.videoId);
        pageVideos.push(item);
      }
      const next = typeof body.nextPageToken === "string" ? body.nextPageToken : null;
      if (next && seenTokens.has(next)) {
        throw new YouTubeSyncError(
          "youtube_invalid_snapshot",
          "The provider returned an invalid YouTube snapshot.",
        );
      }
      if (next) seenTokens.add(next);
      const boundaryIndex = listInput.boundaryVideoId
        ? pageVideos.findIndex((item) => item.videoId === listInput.boundaryVideoId)
        : -1;
      const acceptedOnPage = boundaryIndex === -1 ? pageVideos.length : boundaryIndex + 1;
      videos.push(...pageVideos.slice(0, acceptedOnPage));
      if (boundaryIndex !== -1) {
        boundaryFound = true;
      }
      await listInput.onPage?.({ pageNumber, itemCount: acceptedOnPage });
      if (boundaryFound) break;

      pageToken = next;
    } while (pageToken);

    return { videos, pages: pageNumber, boundaryFound };
  }

  return { listUploads };
}
