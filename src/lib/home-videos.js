import { getYouTubeVideoId } from "./youtube-video-url.js";

// Staff sometimes promote a listing's own walkthrough to the official channel,
// so the same YouTube video can appear once as a listing walkthrough and once as
// a channel video. Dedupe by video id (falling back to the raw URL for anything
// that is not a recognised YouTube link) before the section is capped.
function dedupeVideosByUrl(videos) {
  const seen = new Set();
  return videos.filter((video) => {
    const id = getYouTubeVideoId(video.url) ?? video.url;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Builds the homepage 精選樓盤影片 cards: listing walkthroughs first, topped up
 * from the curated channel videos, deduped, capped at `limit`. Only the five
 * fields the card renders are kept, so YouTube descriptions never reach the
 * loader payload.
 */
export function toHomeVideos(listingVideos, cmsVideos, limit) {
  return dedupeVideosByUrl([
    ...listingVideos.map((video) => ({
      key: video.key,
      title: video.title,
      url: video.url,
      eyebrow: video.eyebrow,
      listingNo: video.listingNo ?? null,
    })),
    ...cmsVideos.map((video) => ({
      key: `cms-${video.id}`,
      title: video.title || "晉誠地產 YouTube影片",
      url: video.video_url,
      eyebrow: "官方頻道",
      listingNo: null,
    })),
  ]).slice(0, limit);
}
