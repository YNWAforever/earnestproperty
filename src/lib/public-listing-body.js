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

// Longer labels first. None is a prefix of another; the order still keeps a
// future shorter label from winning an alternation at the same index.
const CAPTURED_LISTING_FACT_LABELS = Object.freeze([
  "廚房煮食模式",
  "屋苑單位數目",
  "座數及單位",
  "小學校網",
  "中學校網",
  "管理公司",
  "入伙日期",
  "屋苑介紹",
  "屋苑座數",
  "屋苑車位",
  "廚房類型",
  "租金包括",
  "管理費",
  "發展商",
  "樓齡",
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The importer joined these lines with newlines. sanitizeListingText then
// collapses that whitespace, so the appendix is a space plus "標籤：".
const CAPTURED_FACT_APPENDIX = new RegExp(
  `(?:^|\\s)(?:${CAPTURED_LISTING_FACT_LABELS.map(escapeRegExp).join("|")})：`,
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
  const match = CAPTURED_FACT_APPENDIX.exec(value);
  if (!match) {
    const trimmed = value.trim();
    return trimmed || null;
  }
  const head = value.slice(0, match.index).trim();
  return head || null;
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
