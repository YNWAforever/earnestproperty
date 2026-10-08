/**
 * FX-12 (D-12): the one customer phone identity.
 *
 * Pure, no imports, so `node --test` .mjs tests and client code can both use it.
 * Every customer path (website enquiry, WhatsApp ingest, live agent, campaign
 * audience, public tel:/wa.me links) parses through normalizePhone, and every SQL
 * comparison of customer phones goes through phoneMatchSql or phoneEquivalentsSql.
 */

// A leading label staff or customers type before the number (namecards, forms).
const LABEL = /^(?:telephone|tel|t|phone|mobile|whatsapp|wa|電話|手提)\s*[:.]?\s*/i;
// A trailing label after the number: "9123 4567 (WhatsApp)", "9123 4567 WA".
const TRAILING_LABEL = /\s*(?:\(\s*(?:whatsapp|wa|mobile|手提|電話)\s*\)|(?:whatsapp|wa|手提))$/i;
// A parenthesised trunk zero, dropped only after an explicit country prefix.
const TRUNK_ZERO = /\(\s*0\s*\)/g;
// Formatting only: whitespace, dots, parentheses, slashes and hyphens.
const SEPARATORS = /[\s.()/-]+/g;
const HK_CANONICAL = /^852[2-9][0-9]{7}$/;
const HK_LOCAL = /^[2-9][0-9]{7}$/;
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const SQL_PARAM = /^\$\d+$/;

/** The advisory lock key prefix ingest already uses; the Task 6 script uses the same. */
export const PHONE_LOCK_PREFIX = "woztell-phone:";

function parseInternational(digits) {
  // 852 is Hong Kong only, so a typed +852 / 00852 must be a valid HK number.
  if (digits.startsWith("852")) return HK_CANONICAL.test(digits) ? digits : null;
  // Owner decision (Open question 4): "+" typed before an 8-digit HK number is HK.
  // This also captures the rare genuine 8-digit E.164 number (e.g. "+500 12345",
  // Falklands); the owner accepted that trade-off.
  if (HK_LOCAL.test(digits)) return "852" + digits;
  return /^[1-9][0-9]{7,14}$/.test(digits) ? digits : null;
}

/**
 * Without an explicit "+" or "00" prefix, separate digit groups are joined only in
 * a Hong Kong shape: 8 digits as 4+4, or 852 then 8 digits (as 8 or 4+4). Anything
 * else, such as "9123 4567 12" or "1203 9123 4567", is two things typed together
 * and is never assembled into a number (FX-12 fix round 2).
 */
function parseBareGroups(groups) {
  const lengths = groups.map((group) => group.length).join("+");
  const joined = groups.join("");
  if (lengths === "4+4") return HK_LOCAL.test(joined) ? "852" + joined : null;
  if (groups[0] === "852" && (lengths === "3+8" || lengths === "3+4+4")) {
    return HK_CANONICAL.test(joined) ? joined : null;
  }
  return null;
}

function parseNumber(text) {
  const compact = text.replace(SEPARATORS, "");
  // Only digits remain, with at most one "+" in front. Letters ("ext"), commas, a
  // second "+" or a "+" inside the number mean it is not one clear phone number.
  if (!/^\+?[0-9]+$/.test(compact)) return null;
  if (compact.startsWith("+") || compact.startsWith("00")) {
    // An explicit country prefix: the number may be grouped, and a "(0)" trunk is
    // dropped ("+44 (0)7911 123456").
    const digits = text
      .replace(TRUNK_ZERO, "")
      .replace(SEPARATORS, "")
      .replace(/^\+|^00/, "");
    return parseInternational(digits);
  }
  const groups = text.split(SEPARATORS).filter(Boolean);
  if (groups.length > 1) return parseBareGroups(groups);
  const digits = groups[0] ?? "";
  if (HK_LOCAL.test(digits)) return "852" + digits;
  // One contiguous run of 10-15 digits keeps its behaviour: WozTell sends
  // international numbers without "+" (e.g. "8613812345678"), and the company
  // number is configured the same way. Known edge (FX-12 final review Minor 8): a
  // bare "85212345678" is kept as typed, while "+852 1234 5678" is null because a
  // typed +852 must be a valid HK number; a bare WozTell 8-digit "5xxxxxxx" is HK
  // as on main.
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}

/**
 * Canonical customer phone: digits only. Hong Kong is "852" + 8 digits; any other
 * number is its E.164 digits without "+". Tolerates formatting only: a leading or
 * trailing label (Tel, T, Phone, Mobile, WhatsApp, WA, 電話, 手提), spaces, dots,
 * hyphens, parentheses and slashes. Separate digit groups form a number only in a
 * Hong Kong shape or after an explicit "+"/"00" prefix. Returns null for anything
 * that is not clearly one phone number, including two numbers in one string. A null
 * is never turned into a guess.
 */
export function normalizePhone(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw)
    .normalize("NFKC")
    .trim()
    .replace(LABEL, "")
    .replace(TRAILING_LABEL, "")
    .trim();
  if (!text) return null;
  // "9123/4567" is one number split by a slash; "2688 2988/9123 4567" and
  // "9123 4567/68" are alternatives. If any slash-separated part is already a full
  // number on its own, the input is ambiguous.
  const parts = text.split("/");
  if (parts.length > 1 && parts.some((part) => parseNumber(part) !== null)) return null;
  return parseNumber(text);
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
 * SQL integer: 0 when `expr` is stored in the canonical spelling (852 + 8 digits,
 * or a non-852 international number of 10-15 digits), 1 for a legacy or
 * unparseable spelling (8 digits, 00852..., NULL). Lower sorts first.
 */
export function phoneSpellingRankSql(expr) {
  const e = sqlOperand(expr, "expression") + "::text";
  return `(CASE WHEN ${e} ~ '^852[2-9][0-9]{7}$'
    OR (${e} ~ '^[1-9][0-9]{9,14}$' AND ${e} !~ '^852') THEN 0 ELSE 1 END)`;
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
