/**
 * Category chips for /videos. A chip with no videos is noise, so it is dropped,
 * except the one the URL selected: a direct link to an empty category must keep
 * its pressed chip and the empty state.
 *
 * @param {ReadonlyArray<{ category?: string | null }>} videos
 * @param {ReadonlyArray<string>} categories
 * @param {string | undefined} selected
 * @returns {Array<{ category: string; count: number }>}
 */
export function visibleCategoryChips(videos, categories, selected) {
  const counts = new Map();
  for (const video of videos) {
    if (video.category) counts.set(video.category, (counts.get(video.category) ?? 0) + 1);
  }
  return categories
    .map((category) => ({ category, count: counts.get(category) ?? 0 }))
    .filter((entry) => entry.count > 0 || entry.category === selected);
}
