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

/** @param {string} text */
export function extractNumbers(text) {
  const source = String(text ?? "").normalize("NFKC");
  const out = [];
  for (const match of source.matchAll(NUMBER_RE)) {
    const digits = match[1].replace(/,/g, "");
    const unit = match[2] ?? match[3] ?? null;
    const multiplier = unit ? MULTIPLIERS[unit] : 1;
    const decimals = digits.includes(".") ? digits.split(".")[1].length : 0;
    const value = Math.round(Number(digits) * multiplier * 1e6) / 1e6;
    // Half a unit of the last displayed decimal place; an integer display is exact.
    const tolerance = decimals > 0 ? (multiplier * 10 ** -decimals) / 2 : 0;
    out.push({ raw: match[0], value, tolerance: Math.round(tolerance * 1e6) / 1e6 });
  }
  return out;
}

/** @param {Array<string | number>} facts */
function factValues(facts) {
  const values = [];
  for (const fact of facts ?? []) {
    if (typeof fact === "number") {
      if (Number.isFinite(fact)) values.push(fact);
    } else if (typeof fact === "string") {
      for (const { value } of extractNumbers(fact)) values.push(value);
    }
  }
  return values;
}

/**
 * Raw spellings of the numbers in text that no fact holds within the displayed tolerance.
 * @param {string} text
 * @param {Array<string | number>} facts
 */
export function ungroundedNumbers(text, facts) {
  const values = factValues(facts);
  return extractNumbers(text)
    .filter(({ value, tolerance }) => !values.some((fact) => Math.abs(fact - value) <= tolerance))
    .map(({ raw }) => raw);
}
