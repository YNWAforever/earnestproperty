// Number grounding for the FX-11 eval graders (plain JS: shared by the node eval script and the
// staff copilot). A number in visitor-facing text is grounded only when a database fact holds the
// same value within the precision the text displays: "$6.80M" covers 6,795,000-6,805,000, while
// "680萬" must be exactly 6,800,000. Hrefs are never passed in, so a listing number inside a link is
// not text.

const MULTIPLIERS = { M: 1e6, K: 1e3, k: 1e3, 萬: 1e4, 万: 1e4, 億: 1e8, 亿: 1e8 };

// Optional currency, a grouped or plain number, then an optional multiplier. M/K must not run into
// a latin word ("5 Mins" is 5, not 5 million).
const NUMBER_RE =
  /(?:HK\$|\$)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s?([萬万億亿])|([MKk])(?![A-Za-z]))?/g;

// Opt-in (staff copilot only): a Chinese numeral counts as a number only right after 第 or right
// before one of these counting units, so 一個, 一定, 統一, 一手, 萬一, 千祈 and 十分 stay words.
// 萬 and 億 are the money suffixes, as in 七百萬.
export const CHINESE_NUMERAL_UNITS = Object.freeze([
  "房",
  "廳",
  "廁",
  "套",
  "期",
  "座",
  "座數",
  "樓",
  "層",
  "分鐘",
  "小時",
  "年",
  "個月",
  "月",
  "日",
  "天",
  "呎",
  "平方呎",
  "尺",
  "歲",
  "間",
  "伙",
  "個車位",
  "車位",
  "萬",
  "億",
]);

const CHINESE_DIGITS = {
  〇: 0,
  零: 0,
  一: 1,
  二: 2,
  兩: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
const CHINESE_SCALES = { 十: 10, 百: 100, 千: 1000 };
const CHINESE_UNIT_PATTERN = [...CHINESE_NUMERAL_UNITS]
  .sort((left, right) => right.length - left.length)
  .join("|");
const CHINESE_NUMBER_RE = new RegExp(
  `(第)?([〇零一二兩两三四五六七八九十百千]+)(${CHINESE_UNIT_PATTERN})?`,
  "g",
);

/** 十二 → 12, 二十 → 20, 一百二十 → 120, 二〇二四 → 2024. @param {string} numeral */
function chineseNumeralValue(numeral) {
  const chars = [...numeral];
  if (!chars.some((char) => char in CHINESE_SCALES)) {
    return Number(chars.map((char) => CHINESE_DIGITS[char]).join(""));
  }
  let total = 0;
  let digit = null;
  for (const char of chars) {
    if (char in CHINESE_DIGITS) {
      digit = CHINESE_DIGITS[char];
    } else {
      total += (digit ?? 1) * CHINESE_SCALES[char];
      digit = null;
    }
  }
  return total + (digit ?? 0);
}

/** @param {string} source */
function extractChineseNumbers(source) {
  const out = [];
  for (const match of source.matchAll(CHINESE_NUMBER_RE)) {
    const [raw, ordinal, numeral, unit] = match;
    if (!ordinal && !unit) continue;
    const multiplier = unit && unit in MULTIPLIERS ? MULTIPLIERS[unit] : 1;
    out.push({
      raw,
      value: chineseNumeralValue(numeral) * multiplier,
      tolerance: 0,
      index: match.index,
    });
  }
  return out;
}

/**
 * @param {string} text
 * @param {{ chineseNumerals?: boolean }} [options]
 */
export function extractNumbers(text, options) {
  const source = String(text ?? "").normalize("NFKC");
  const out = [];
  const positions = [];
  for (const match of source.matchAll(NUMBER_RE)) {
    positions.push(match.index);
    const digits = match[1].replace(/,/g, "");
    const unit = match[2] ?? match[3] ?? null;
    const multiplier = unit ? MULTIPLIERS[unit] : 1;
    const decimals = digits.includes(".") ? digits.split(".")[1].length : 0;
    const value = Math.round(Number(digits) * multiplier * 1e6) / 1e6;
    // Half a unit of the last displayed decimal place; an integer display is exact.
    const tolerance = decimals > 0 ? (multiplier * 10 ** -decimals) / 2 : 0;
    out.push({ raw: match[0], value, tolerance: Math.round(tolerance * 1e6) / 1e6 });
  }
  if (!options?.chineseNumerals) return out;
  const indexed = out.map((number, position) => ({ number, index: positions[position] }));
  for (const { index, ...number } of extractChineseNumbers(source)) indexed.push({ number, index });
  return indexed.sort((left, right) => left.index - right.index).map(({ number }) => number);
}

/**
 * @param {Array<string | number>} facts
 * @param {{ chineseNumerals?: boolean }} [options]
 */
function factValues(facts, options) {
  const values = [];
  for (const fact of facts ?? []) {
    if (typeof fact === "number") {
      if (Number.isFinite(fact)) values.push(fact);
    } else if (typeof fact === "string") {
      for (const { value } of extractNumbers(fact, options)) values.push(value);
    }
  }
  return values;
}

/**
 * Raw spellings of the numbers in text that no fact holds within the displayed tolerance.
 * @param {string} text
 * @param {Array<string | number>} facts
 * @param {{ chineseNumerals?: boolean }} [options] chineseNumerals reads 兩房 / 第一期 / 七百萬 as numbers
 *   (staff copilot only; the live-agent eval graders keep the default off).
 */
export function ungroundedNumbers(text, facts, options) {
  const values = factValues(facts, options);
  return extractNumbers(text, options)
    .filter(({ value, tolerance }) => !values.some((fact) => Math.abs(fact - value) <= tolerance))
    .map(({ raw }) => raw);
}
