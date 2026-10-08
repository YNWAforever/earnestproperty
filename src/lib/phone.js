/**
 * FX-12 (D-12): the one customer phone identity.
 *
 * Pure, no imports, so `node --test` .mjs tests and client code can both use it.
 * Every customer path (website enquiry, WhatsApp ingest, live agent, campaign
 * audience, public tel:/wa.me links) parses through normalizePhone, and every SQL
 * comparison of customer phones goes through phoneMatchSql or phoneEquivalentsSql.
 */

const ALLOWED = /^\+?[0-9 .()-]*$/;
const HK_CANONICAL = /^852[2-9][0-9]{7}$/;
const HK_LOCAL = /^[2-9][0-9]{7}$/;
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const SQL_PARAM = /^\$\d+$/;

/** The advisory lock key prefix ingest already uses; the Task 6 script uses the same. */
export const PHONE_LOCK_PREFIX = "woztell-phone:";

/**
 * Canonical customer phone: digits only. Hong Kong is "852" + 8 digits; any other
 * number is its E.164 digits without "+". Returns null for anything that is not
 * clearly a phone number. A null is never turned into a guess.
 */
export function normalizePhone(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).normalize("NFKC").trim();
  if (!text || !ALLOWED.test(text)) return null;
  let digits = text.replace(/[^0-9]/g, "");
  let international = text.startsWith("+");
  if (!international && digits.startsWith("00")) {
    international = true;
    digits = digits.slice(2);
  }
  if (!digits) return null;
  if (international) {
    if (digits.startsWith("852")) return HK_CANONICAL.test(digits) ? digits : null;
    // Owner decision (Open question 4): "+" typed before an 8-digit HK number is HK.
    if (HK_LOCAL.test(digits)) return "852" + digits;
    return /^[1-9][0-9]{7,14}$/.test(digits) ? digits : null;
  }
  if (HK_LOCAL.test(digits)) return "852" + digits;
  if (HK_CANONICAL.test(digits)) return digits;
  // WozTell sends international numbers without "+", e.g. "8613812345678".
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}

/** "852XXXXXXXX" -> "XXXXXXXX"; anything else -> null. */
export function hkLocalNumber(canonical) {
  if (typeof canonical !== "string") return null;
  const match = /^852([0-9]{8})$/.exec(canonical);
  return match ? match[1] : null;
}

function sqlOperand(value, label) {
  if (typeof value !== "string" || !(SQL_IDENTIFIER.test(value) || SQL_PARAM.test(value))) {
    throw new Error("Invalid phone SQL " + label);
  }
  return value;
}

/**
 * SQL predicate: `column` holds the same number as the canonical `param`, in any
 * legacy stored spelling (XXXXXXXX, 852XXXXXXXX, 00852XXXXXXXX). It is a superset
 * of the two-format match used before FX-12, so no customer stops matching.
 */
export function phoneMatchSql(column, param) {
  const col = sqlOperand(column, "column");
  const p = sqlOperand(param, "param") + "::text";
  return `(${col} = ${p} OR (${p} ~ '^852[0-9]{8}$' AND ${col} IN (right(${p}, 8), ('00' || ${p}))))`;
}

/**
 * ORDER BY key to place right after the existing exact-spelling key, ascending.
 * The wider match adds only 00852 rows; this sorts them after today's 8-digit
 * match, so whenever today's match finds a contact the pick is unchanged.
 */
export function phoneSpellingTiebreakSql(column, param) {
  const col = sqlOperand(column, "column");
  const p = sqlOperand(param, "param") + "::text";
  return `(${col} = ('00' || ${p}))`;
}

/**
 * SQL text[] of the stored spellings equivalent to `expr`. Uses [0-9]{8}, not
 * [2-9], so it never links fewer peers than the pre-FX-12 CASE did.
 */
export function phoneEquivalentsSql(expr) {
  const e = sqlOperand(expr, "expression") + "::text";
  return `(CASE
    WHEN ${e} ~ '^[0-9]{8}$' THEN ARRAY[${e}, '852' || ${e}, '00852' || ${e}]
    WHEN ${e} ~ '^852[0-9]{8}$' THEN ARRAY[${e}, right(${e}, 8), '00' || ${e}]
    WHEN ${e} ~ '^00852[0-9]{8}$' THEN ARRAY[${e}, right(${e}, 8), substr(${e}, 3)]
    ELSE ARRAY[${e}] END)`;
}
