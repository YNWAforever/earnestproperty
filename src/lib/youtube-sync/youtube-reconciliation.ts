import { getYouTubeVideoId } from "@/lib/youtube-video-url.js";

import {
  YouTubeSyncError,
  type ManualVideoCandidate,
  type PlannedYouTubeVideo,
  type YouTubeVideo,
} from "./youtube-sync.types";

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function canonicalYouTubeUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function hongKongMonthPeriod(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) {
    throw new YouTubeSyncError(
      "youtube_validation_error",
      "Hong Kong period could not be calculated.",
    );
  }
  return `${year}-${month}-01`;
}

export function validateYouTubeSnapshot(videos: readonly YouTubeVideo[]) {
  const seen = new Set<string>();
  for (const item of videos) {
    const validDate = Number.isFinite(Date.parse(item.publishedAt));
    if (
      !VIDEO_ID_PATTERN.test(item.videoId) ||
      !item.title.trim() ||
      !validDate ||
      item.canonicalUrl !== canonicalYouTubeUrl(item.videoId) ||
      seen.has(item.videoId)
    ) {
      throw new YouTubeSyncError(
        "youtube_invalid_snapshot",
        "The provider returned an invalid YouTube snapshot.",
      );
    }
    seen.add(item.videoId);
  }
  return [...videos];
}

export function planManualAdoptions(
  videos: readonly YouTubeVideo[],
  manualRows: readonly ManualVideoCandidate[],
): PlannedYouTubeVideo[] {
  const validated = validateYouTubeSnapshot(videos);
  const candidatesByVideo = new Map<string, ManualVideoCandidate[]>();

  for (const row of manualRows) {
    const videoId = getYouTubeVideoId(row.videoUrl);
    if (!videoId) continue;
    const candidates = candidatesByVideo.get(videoId) ?? [];
    candidates.push(row);
    candidatesByVideo.set(videoId, candidates);
  }

  return validated.map((item) => {
    const candidates = candidatesByVideo.get(item.videoId) ?? [];
    if (candidates.length > 1) {
      throw new YouTubeSyncError(
        "youtube_invalid_snapshot",
        "Multiple manual rows match one incoming YouTube video.",
      );
    }
    const candidate = candidates[0];
    return {
      ...item,
      adoptionId: candidate?.id ?? null,
      expectedManualUrl: candidate?.videoUrl ?? null,
    };
  });
}
