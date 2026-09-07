/**
 * SERP display-width budget for SEO 標題 / SEO 描述.
 *
 * ## Why width, not `.length`
 *
 * Every public string on this site is zh-HK. A CJK glyph occupies roughly two
 * Latin character cells in a Google result, so `title.length <= 60` passes for
 * a title that renders at 120 units and gets truncated with an ellipsis in the
 * SERP. docs/seo-audit-2026-09-06.md flagged exactly this (P2-14: "nothing
 * exceeds 60 characters, but CJK glyphs are double width") and the fix was
 * applied by eye. Measuring it here is what stops it drifting back.
 *
 * Units, not pixels: Google renders titles in a proportional font, so a pixel
 * budget would need per-glyph metrics we do not have. Two units per wide glyph
 * and one per halfwidth glyph is the same approximation `wcwidth` uses, and it
 * is stable enough to enforce in a test.
 *
 * ## The budgets
 *
 * `TITLE_MAX_UNITS` 60 / `DESCRIPTION_MAX_UNITS` 160 are the truncation points.
 * `TITLE_MIN_UNITS` / `DESCRIPTION_MIN_UNITS` are the other failure mode: a
 * nine-character title ("代理團隊｜晉誠地產") wastes the strongest ranking
 * signal on the page, and an 80-unit description leaves half the snippet to
 * Google's own extraction. Both floors are advisory in the sense that they
 * describe thin copy rather than broken copy -- `seoCopyIssues` reports them
 * separately from the hard caps so a caller can treat them differently.
 *
 * Authored as plain JS with a .d.ts sibling, matching website-inquiry.js and
 * migration-versions.js, so the `node --test` suites import it with no build
 * step (src/content/seo.ts is TypeScript and only loads under Node's type
 * stripping; this module has to work from a .mjs test either way).
 */

/**
 * Code point ranges rendered double-width. Taken from Unicode's East Asian
 * Width property (the `W` and `F` classes), restricted to the blocks that can
 * actually appear in this site's copy: CJK ideographs and punctuation, the
 * fullwidth Latin forms (｜ U+FF5C is in every title on the site), Hiragana /
 * Katakana, Hangul, and the emoji planes.
 *
 * Deliberately NOT included: the `A` (ambiguous) class -- en dash, em dash,
 * × , ° and the like. They render halfwidth in a Latin-primary font, which is
 * what a SERP uses even for a Chinese title, so counting them as two would
 * over-report every description carrying a "—".
 */
const WIDE_RANGES = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK Radicals, Kangxi, CJK Symbols and Punctuation (（ 、 。 「 」)
  [0x3041, 0x33ff], // Hiragana, Katakana, Bopomofo, Hangul Compatibility Jamo, CJK Compatibility
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe10, 0xfe19], // Vertical Forms
  [0xfe30, 0xfe6f], // CJK Compatibility Forms, Small Form Variants
  [0xff00, 0xff60], // Fullwidth Forms (｜ ， ： ！ ？ and fullwidth Latin)
  [0xffe0, 0xffe6], // Fullwidth signs (￥ ￦)
  [0x1f300, 0x1f64f], // Emoji: symbols and pictographs, emoticons
  [0x1f900, 0x1f9ff], // Emoji: supplemental symbols and pictographs
];

/**
 * @param {number} codePoint
 * @returns {boolean}
 */
function isWideCodePoint(codePoint) {
  for (const [start, end] of WIDE_RANGES) {
    if (codePoint >= start && codePoint <= end) return true;
  }
  return false;
}

/**
 * Display width of a string in Latin character cells.
 *
 * Iterates code points (`for...of`), not UTF-16 units, so an astral-plane
 * glyph counts once at width 2 rather than twice as two lone surrogates.
 *
 * @param {string | null | undefined} value
 * @returns {number}
 */
export function displayWidth(value) {
  if (!value) return 0;
  let width = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    width += codePoint !== undefined && isWideCodePoint(codePoint) ? 2 : 1;
  }
  return width;
}

/** Google truncates a result title past roughly this width. */
export const TITLE_MAX_UNITS = 60;
/** Below this a title is too thin to carry its page's ranking terms. */
export const TITLE_MIN_UNITS = 24;
/** Google truncates a result snippet past roughly this width. */
export const DESCRIPTION_MAX_UNITS = 160;
/** Below this the snippet leaves space Google fills with its own extraction. */
export const DESCRIPTION_MIN_UNITS = 90;

/**
 * How many trailing characters two descriptions must share before they read as
 * one template rather than two pieces of copy. 12 is long enough that the
 * shared brand sign-off ("晉誠地產 C-018613。", 16 units) trips it while a
 * coincidental "。" does not.
 */
export const SHARED_TAIL_CHARS = 12;

/**
 * Truncate to a width budget on a word/clause boundary.
 *
 * Slicing by `.length` is what produced the defect this module exists to
 * prevent -- `description.slice(0, 150)` on zh-HK prose cuts mid-clause and
 * leaves a dangling "，". So: cut to the budget by width, then back up to the
 * last clause delimiter (or ASCII space) if one sits in the final third of the
 * result, and drop a trailing delimiter. A string already inside the budget is
 * returned untouched, including its own punctuation.
 *
 * @param {string | null | undefined} value
 * @param {number} maxUnits
 * @returns {string}
 */
export function truncateToWidth(value, maxUnits) {
  if (!value) return "";
  if (displayWidth(value) <= maxUnits) return value;

  const chars = [...value];
  let width = 0;
  let cut = 0;
  for (const char of chars) {
    const codePoint = char.codePointAt(0);
    const charWidth = codePoint !== undefined && isWideCodePoint(codePoint) ? 2 : 1;
    if (width + charWidth > maxUnits) break;
    width += charWidth;
    cut += 1;
  }

  const text = chars.slice(0, cut).join("");
  // Only rewind into the final third: backing up further would throw away more
  // snippet than the ragged edge costs.
  const floor = Math.floor(text.length * (2 / 3));
  // Clause delimiters first, spaces only as a fallback. Rewinding to whichever
  // came last put the cut inside a phrase: "…分三期落成，共 28 座" trimmed on
  // the space to "…分三期落成，共 28", a dangling numeral. The 「，」 is the
  // real boundary even though it sits further back.
  for (const pattern of [/[，。、；：！？,;:!?]/, /[　 ]/]) {
    for (let index = text.length - 1; index >= floor; index -= 1) {
      if (pattern.test(text[index])) {
        return text.slice(0, index).replace(/[，。、；：,;:\s]+$/, "");
      }
    }
  }
  return text.replace(/[，。、；：,;:\s]+$/, "");
}

/**
 * Every way a title/description pair can fail its budget, as machine-readable
 * codes. Empty array = the pair is shippable.
 *
 * Returns codes rather than prose so `seo-copy.test.mjs` can assert on them and
 * an admin-side width hint can map them to Chinese labels without re-deriving
 * the rules.
 *
 * @param {{ title?: string | null, description?: string | null }} input
 * @returns {string[]}
 */
export function seoCopyIssues(input) {
  const issues = [];
  const title = input.title ?? "";
  const description = input.description ?? "";
  const titleWidth = displayWidth(title);
  const descriptionWidth = displayWidth(description);

  if (title.trim() === "") issues.push("title_missing");
  else if (titleWidth > TITLE_MAX_UNITS) issues.push("title_over_budget");
  else if (titleWidth < TITLE_MIN_UNITS) issues.push("title_thin");

  if (description.trim() === "") issues.push("description_missing");
  else if (descriptionWidth > DESCRIPTION_MAX_UNITS) issues.push("description_over_budget");
  else if (descriptionWidth < DESCRIPTION_MIN_UNITS) issues.push("description_thin");

  return issues;
}
