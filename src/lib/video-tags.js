/**
 * Derives an estate tag from a video title.
 *
 * ## Why parse the title rather than match a curated list
 *
 * Measured across all 97 production titles: only 39 (40%) contain a name from
 * src/content/core-estates.ts, while 94 (97%) carry a ＃ marker with the estate
 * immediately after it. 黃金海灣, 漣山, 上源, 愛琴海岸, 星堤 and 帝濤灣 all appear in
 * videos and are absent from the curated list, so matching that list alone would
 * leave most of the catalogue unfilterable.
 *
 * An unrecognised token still becomes a tag. That is the intended degradation
 * path: a newly marketed estate appears as its own chip the day it is uploaded
 * rather than silently vanishing from the filter set.
 *
 * Authored as plain JS with a .d.ts sibling, matching website-inquiry.js and
 * video-description.js, so the node --test suite imports it with no build step.
 */

// Full-width ＃ is what this channel types; ASCII # appears occasionally. The
// token stops at punctuation, so "＃黃金海灣.珀岸" yields "黃金海灣".
const MARKER = /[＃#]\s*([一-鿿A-Za-z0-9]{2,10})/;

/**
 * @param {string | null | undefined} title
 * @returns {{ tag: string, district: string | null } | null}
 */
export function deriveEstateTag(title) {
  if (typeof title !== "string") return null;
  const match = title.match(MARKER);
  if (!match) return null;
  return { tag: match[1], district: null };
}
