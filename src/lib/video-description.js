/**
 * Reduces a raw YouTube description to a card-sized summary.
 *
 * The channel's descriptions repeat the listing's agency boilerplate after the
 * headline: listing id, publication date, company licence, and the agent's
 * personal mobile. /videos rendered that field verbatim, which republished those
 * numbers in a surface nobody reviewed for it, and at up to 987 characters it
 * stretched grid cards from 456px to 1047px tall -- a 2.3x spread that made the
 * three-column grid visibly ragged.
 *
 * Cutting at the first boilerplate marker (rather than truncating blindly)
 * keeps the human-written headline intact while dropping the machine-appended
 * tail, which is exactly the half worth showing.
 *
 * Authored as plain JS with a .d.ts sibling, matching website-inquiry.js and
 * site-branches.js, so the node --test suite imports it with no build step.
 */

/**
 * Markers that begin the agency boilerplate. Everything from the earliest match
 * onwards is dropped.
 */
const BOILERPLATE_MARKERS = Object.freeze([
  "樓盤編號",
  "刊登日期",
  "公司牌照",
  "地產代理",
  "牌照號碼",
  "營業員",
]);

/**
 * @param {string | null | undefined} value
 * @param {number} [maxLength]
 * @returns {string | null}
 */
export function summarizeVideoDescription(value, maxLength = 120) {
  if (typeof value !== "string") return null;

  let cutIndex = value.length;
  for (const marker of BOILERPLATE_MARKERS) {
    const index = value.indexOf(marker);
    if (index !== -1 && index < cutIndex) cutIndex = index;
  }

  // Collapse every run of whitespace, newlines included: the source wraps lines
  // for YouTube's own layout, which has nothing to do with this card's width.
  const summary = value.slice(0, cutIndex).replace(/\s+/g, " ").trim();
  if (!summary) return null;
  if (summary.length <= maxLength) return summary;

  return `${summary.slice(0, maxLength).trimEnd()}…`;
}
