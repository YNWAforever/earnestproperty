/** The advisory lock key prefix ingest already uses; the Task 6 script uses the same. */
export const PHONE_LOCK_PREFIX: "woztell-phone:";

/**
 * Canonical customer phone. Digits only. Hong Kong -> "852" + 8 digits; others ->
 * E.164 digits, no "+". Returns null for anything unparseable; never guesses.
 */
export function normalizePhone(raw: unknown): string | null;

/** "852XXXXXXXX" -> "XXXXXXXX"; anything else -> null. */
export function hkLocalNumber(canonical: string | null | undefined): string | null;

/**
 * SQL predicate: `column` holds the same number as canonical `param`, in any legacy
 * spelling. A superset of the pre-FX-12 two-format match. Throws on an unsafe
 * column or param (identifier or `$n` only).
 */
export function phoneMatchSql(column: string, param: string): string;

/**
 * ORDER BY key (ascending) to place right after the exact-spelling key, so the
 * 00852 rows the wider match adds never displace today's pick.
 */
export function phoneSpellingTiebreakSql(column: string, param: string): string;

/** SQL integer: 0 for the canonical stored spelling, 1 for a legacy or unparseable one. */
export function phoneSpellingRankSql(expr: string): string;

/** SQL text[] of the stored spellings equivalent to `expr`. */
export function phoneEquivalentsSql(expr: string): string;
