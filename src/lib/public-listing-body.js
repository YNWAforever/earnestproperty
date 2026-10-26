/**
 * Public listing copy for /property/$listingNo.
 *
 * Saved-capture import used to append source encyclopedia rows (座數及單位,
 * 校網, 發展商, 屋苑介紹, …) onto the unit description. Those facts are not
 * the unit description. The detail page reads 發展商 / 入伙年份 / 總單位 from
 * the linked estate row, and must not invent them from this text.
 *
 * Plain JS so node --test can import it without a build.
 */

// Estate rows in the order used by the saved-capture importer. Rental terms,
// management fees and kitchen details are ordinary unit copy, not evidence
// that a description contains an encyclopedia appendix.
const CAPTURED_ESTATE_FACT_LABELS = Object.freeze([
  "座數及單位",
  "小學校網",
  "中學校網",
  "發展商",
  "管理公司",
  "樓齡",
  "入伙日期",
  "屋苑介紹",
  "屋苑單位數目",
  "屋苑座數",
  "屋苑車位",
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The importer joined these lines with newlines. sanitizeListingText then
// collapses that whitespace. A single label is not enough to identify a
// capture; require at least three distinct estate rows in capture order.
// Unit-term boundaries also match immediately after Chinese punctuation.
const CAPTURED_FACT_ROW = new RegExp(
  `(?:^|\\s)(${CAPTURED_ESTATE_FACT_LABELS.map(escapeRegExp).join("|")})：|(?:廚房類型|廚房煮食模式|租金包括|管理費)：`,
  "g",
);

/**
 * Unit description with the captured encyclopedia appendix removed.
 * Returns null when nothing of the unit description remains. Does not
 * parse or return the removed facts.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function stripCapturedListingFacts(value) {
  if (typeof value !== "string") return null;
  const rows = [...value.matchAll(CAPTURED_FACT_ROW)];
  let start = rows.length - 1;
  while (
    start > 0 &&
    // Unit terms break the estate appendix, even when whitespace collapsed.
    CAPTURED_ESTATE_FACT_LABELS.indexOf(rows[start - 1][1]) >= 0 &&
    CAPTURED_ESTATE_FACT_LABELS.indexOf(rows[start - 1][1]) <
      CAPTURED_ESTATE_FACT_LABELS.indexOf(rows[start][1])
  ) {
    start -= 1;
  }
  const description = rows.length - start >= 3 ? value.slice(0, rows[start].index) : value;
  return description.trim() || null;
}

/**
 * Feature chips are not the estate record. They stay only when the listing
 * has no linked estate, so they cannot occupy the 屋苑資料 slot.
 *
 * @param {unknown} estate
 * @returns {boolean}
 */
export function showListingFeatureChips(estate) {
  return estate == null;
}
