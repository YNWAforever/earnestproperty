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

/** Tokens that match the marker but are not places. */
const DROPPED_TAGS = new Set(["晉誠地產", "晉誠", "樓市當面講"]);

/**
 * Sub-developments marketed under their own name. Generic phase-suffix
 * stripping cannot catch these because the child name shares no substring with
 * the parent.
 */
const TAG_ALIASES = new Map([
  ["黃金海灣意嵐", "黃金海灣"],
  ["黃金海灣珀岸", "黃金海灣"],
  ["意嵐", "黃金海灣"],
  ["珀岸", "黃金海灣"],
]);

/** 浪翠園一期 / 浪翠園三期 -> 浪翠園 */
const PHASE_SUFFIX = /(?:第?[一二三四五六七八九十\d]+期)$/;

/**
 * Estate -> district, mirroring src/content/core-estates.ts.
 *
 * Duplicated rather than imported because core-estates.ts is TypeScript and this
 * module must stay importable by `node --test` with no build step -- the same
 * constraint that makes this file plain JS. video-tags.test.mjs asserts this map
 * agrees with core-estates.ts, so drift is a red test rather than a silent
 * mismatch.
 *
 * Estates the curated list has no district for are absent here and resolve to
 * null. That is deliberate: core-estates.ts refuses to guess a district rather
 * than put a false location on a real estate.
 */
export const ESTATE_DISTRICTS = new Map([
  ["碧堤半島", "深井"],
  ["浪翠園", "深井"],
  ["麗都花園", "深井"],
  ["海韻花園", "深井"],
  ["豪景花園", "青山公路"],
  ["海雲軒", "汀九"],
  ["縉皇居", "汀九"],
]);

/**
 * @param {string} token
 * @returns {string | null}
 */
function normalizeTag(token) {
  const aliased = TAG_ALIASES.get(token) ?? token;
  const stripped = aliased.replace(PHASE_SUFFIX, "");
  const final = stripped.length >= 2 ? stripped : aliased;
  if (DROPPED_TAGS.has(final)) return null;
  return final;
}

/**
 * @param {string | null | undefined} title
 * @returns {{ tag: string, district: string | null } | null}
 */
export function deriveEstateTag(title) {
  if (typeof title !== "string") return null;
  const match = title.match(MARKER);
  if (!match) return null;
  const tag = normalizeTag(match[1]);
  if (!tag) return null;
  return { tag, district: ESTATE_DISTRICTS.get(tag) ?? null };
}

/**
 * Counts derived tags across a video list, most frequent first.
 *
 * Ties break alphabetically so the chip row is stable between renders rather
 * than reflecting whatever order the rows arrived in.
 *
 * @param {ReadonlyArray<{ title?: string | null }>} videos
 * @returns {Array<{ tag: string, district: string | null, count: number }>}
 */
export function buildTagCounts(videos) {
  /** @type {Map<string, { tag: string, district: string | null, count: number }>} */
  const counts = new Map();

  for (const video of videos) {
    const derived = deriveEstateTag(video?.title);
    if (!derived) continue;
    const existing = counts.get(derived.tag);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(derived.tag, { ...derived, count: 1 });
    }
  }

  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-Hant"),
  );
}
