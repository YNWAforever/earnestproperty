/**
 * Video category taxonomy (P5e2). Unlike the estate tag on /videos (parsed
 * from a title's ＃marker -- see video-tags.js), category is a genuine
 * admin-assigned fact with no reliable text heuristic, so it lives as a real
 * nullable `cms_videos.category` column. Existing videos default to `null`
 * (shown as unfiltered) rather than a guessed category.
 */
export const VIDEO_CATEGORIES = ["樓盤實拍", "屋苑開箱", "市場評論", "社區生活"] as const;
export type VideoCategory = (typeof VIDEO_CATEGORIES)[number];

export function isVideoCategory(value: string): value is VideoCategory {
  return (VIDEO_CATEGORIES as readonly string[]).includes(value);
}
