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

// Digit runs may be joined by spaces, dots, hyphens, slashes or a closing
// bracket, e.g. "91 23 45 67", "9123.4567", "(852) 2688-2988". The leading
// "(" / "+" belong to the run so they are removed with it.
const DIGIT_RUN = /[(+]*\d+(?:(?:[ .\-/]+|\)[ .\-/]*)\d+)*/g;
const DATE_DIGITS = /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;
const UNIT_AFTER = /^\s*(?:萬|億|元|呎|尺|平方呎|sq\.?\s*ft)/i;
const PRICE_BEFORE = /(?:\$|HK\$|價|售|租|呎價|高度)\s*$/i;
const LABEL_BEFORE =
  /(?:(?:致電|電話|手機|聯絡|WhatsApp|Whatsapp|Tel|Call|chat)\s*(?:號碼)?\s*[:：]?\s*)+$/i;

/** @param {string} digits */
function isHkPhoneDigits(digits) {
  return /^[2-9]\d{7}$/.test(digits) || /^852[2-9]\d{7}$/.test(digits);
}

/**
 * Finds [start, end) ranges of Hong Kong phone numbers in `text`, which must
 * already be normalised to ASCII digits (same length as the original).
 *
 * @param {string} text
 * @returns {Array<[number, number]>}
 */
function findPhoneRanges(text) {
  /** @type {Array<[number, number]>} */
  const ranges = [];
  for (const run of text.matchAll(DIGIT_RUN)) {
    const runStart = run.index ?? 0;
    const groups = [...run[0].matchAll(/\d+/g)].map((g) => ({
      start: runStart + (g.index ?? 0),
      end: runStart + (g.index ?? 0) + g[0].length,
      digits: g[0],
    }));
    let i = 0;
    while (i < groups.length) {
      let digits = "";
      let matched = -1;
      for (let j = i; j < groups.length; j += 1) {
        digits += groups[j].digits;
        if (digits.length > 11) break;
        if (!isHkPhoneDigits(digits)) continue;
        const start = i === 0 ? runStart : groups[i].start;
        let end = groups[j].end;
        // "(9123 4567)": the run owns the opening bracket, so take its pair too.
        const body = text.slice(start, end);
        if (text[end] === ")" && body.split("(").length > body.split(")").length) end += 1;
        const exempt =
          DATE_DIGITS.test(digits) ||
          UNIT_AFTER.test(text.slice(end)) ||
          PRICE_BEFORE.test(text.slice(0, start));
        if (exempt) continue;
        ranges.push([start, end]);
        matched = j;
        break;
      }
      i = matched === -1 ? i + 1 : matched + 1;
    }
  }
  return ranges;
}

/**
 * Removes Hong Kong phone numbers (8 digits starting 2-9, optionally with an
 * 852 prefix; any spacing, dots, hyphens or slashes; fullwidth digits) and a
 * directly preceding label such as 電話：from text bound for structured data.
 * Prices (價 6800 0000, 680萬), areas (512呎), compact dates and listing ids are
 * kept. Residual risk: an 8-digit landline that looks exactly like a date is
 * kept.
 *
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function redactPhoneNumbers(value) {
  if (typeof value !== "string") return "";
  const normalised = value
    .replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ");
  const ranges = findPhoneRanges(normalised);
  if (ranges.length === 0) return value;

  let out = normalised;
  for (const [start, end] of [...ranges].reverse()) {
    const label = LABEL_BEFORE.exec(out.slice(0, start));
    const from = label ? start - label[0].length : start;
    out = out.slice(0, from) + out.slice(end);
  }

  return out
    .replace(/(?:https?:\/\/)?wa\.me\/?(?![\w])/gi, "")
    .replace(/[（(]\s*[）)]/g, "")
    .replace(/\bchat\s*(?=[.。,，!！]|$)/gi, "")
    .replace(/(^|\s)\/+(?=\s|$)/g, "$1")
    .replace(/[ \t]+([,.，。、；;!！])/g, "$1")
    .replace(/([，,、；;。.！!])(?:\s*[，,、；;])+/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
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

/**
 * The name and description a VideoObject carries for a CMS video. Both are
 * phone-free; the name falls back when redaction leaves nothing.
 *
 * @param {{ title?: string | null; description?: string | null }} video
 * @param {string} fallbackName
 * @returns {{ name: string; description: string | null }}
 */
export function videoSchemaText(video, fallbackName) {
  return {
    name: redactPhoneNumbers(cleanVideoText(video.title)) || fallbackName,
    description: summarizeVideoDescriptionForSchema(video.description),
  };
}
