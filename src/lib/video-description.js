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
 * Strips U+FFFC (the object-replacement character YouTube leaves where an
 * embedded chip or link was), collapses the doubled spaces that leaves, trims.
 *
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function cleanVideoText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\uFFFC/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

/**
 * @param {string | null | undefined} value
 * @param {number} [maxLength]
 * @returns {string | null}
 */
export function summarizeVideoDescription(value, maxLength = 120) {
  if (typeof value !== "string") return null;
  value = cleanVideoText(value);

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

const PHONE_PATTERN =
  /(?<!\d)(?:(?:致電|電話|手機|聯絡|聯繫|熱線|WhatsApp|WA|Tel|Mobile|Phone)\s*(?:號碼)?\s*[:：]?\s*)*(?:\(?\+?852\)?[\s-]*)?[2-9]\d{3}[\s-]?\d{4}(?!\d)/gi;

/**
 * Removes Hong Kong phone numbers (8 digits, optional 852 prefix, optional
 * label such as 電話：) from text bound for structured data. Fullwidth digits
 * are normalised first. Listing ids and prices have no 8-digit run and are
 * left alone.
 *
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function redactPhoneNumbers(value) {
  if (typeof value !== "string") return "";
  const ascii = value.replace(/[\uFF10-\uFF19]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
  return ascii
    .replace(PHONE_PATTERN, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/([，,、；;])\s*(?=[，,、；;。.！!]|$)/g, "")
    .replace(/^[\s，,、；;:：-]+|[\s，,、；;:：-]+$/g, "")
    .trim();
}

/**
 * Summary for JSON-LD: the card summary with any phone number removed. Null
 * when nothing is left, so the schema falls back to the video name.
 *
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function summarizeVideoDescriptionForSchema(value) {
  const summary = redactPhoneNumbers(summarizeVideoDescription(value, 10000));
  if (!summary) return null;
  return summary.length <= 120 ? summary : `${summary.slice(0, 120).trimEnd()}…`;
}
