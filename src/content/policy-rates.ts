/**
 * A single price band of Hong Kong's residential Ad Valorem Duty (AVD)
 * Scale 2 schedule. Three shapes, matching the statutory table's own
 * alternating structure:
 *  - "fixed": a flat duty regardless of price (the lowest band only).
 *  - "flatRate": duty is `rate` of the full price.
 *  - "marginal": a transitional band giving marginal relief so a price
 *    just above a "flatRate" threshold never nets less after-duty value
 *    than a price just below it -- duty is `base` (the duty at `from`)
 *    plus `rate` on the amount over `from`.
 * Every band's upper bound is inclusive (`price <= upTo` selects it).
 */
export type StampDutyBracket =
  | { kind: "fixed"; upTo: number; amount: number }
  | { kind: "flatRate"; upTo: number; rate: number }
  | { kind: "marginal"; upTo: number; from: number; base: number; rate: number };

export type ResidentialStampDutySchedule = {
  brackets: StampDutyBracket[];
  source: string;
  sourceUrl: string | null;
  effectiveDate: string;
};

/**
 * Extracted from `calculateResidentialStampDuty` in `src/lib/mortgage.ts`,
 * where these exact figures previously lived as inline literals with no
 * citation next to them. Follows `school-nets.ts`'s
 * source/sourceUrl/effective-date shape.
 *
 * `sourceUrl` is not a new citation invented for this file: it is the same
 * IRD link already surfaced to users in `MortgageCalculator.tsx`'s "重要事項"
 * note (added when that component was translated to zh-HK), and its
 * presence there is asserted by `src/routes/mortgage.test.mjs`. Reusing it
 * here avoids the alternative of inventing a second, disconnected citation
 * for the same numbers. `effectiveDate` is copied verbatim from that same
 * note's text, not independently re-derived.
 *
 * If this schedule is ever revised, update both this file and the note in
 * MortgageCalculator.tsx together -- don't let the two drift.
 */
export const RESIDENTIAL_STAMP_DUTY_SCHEDULE: ResidentialStampDutySchedule = {
  brackets: [
    { kind: "fixed", upTo: 4_000_000, amount: 100 },
    { kind: "marginal", upTo: 4_323_780, from: 4_000_000, base: 100, rate: 0.2 },
    { kind: "flatRate", upTo: 4_500_000, rate: 0.015 },
    { kind: "marginal", upTo: 4_935_480, from: 4_500_000, base: 67_500, rate: 0.1 },
    { kind: "flatRate", upTo: 6_000_000, rate: 0.0225 },
    { kind: "marginal", upTo: 6_642_860, from: 6_000_000, base: 135_000, rate: 0.1 },
    { kind: "flatRate", upTo: 9_000_000, rate: 0.03 },
    { kind: "marginal", upTo: 10_080_000, from: 9_000_000, base: 270_000, rate: 0.1 },
    { kind: "flatRate", upTo: 20_000_000, rate: 0.0375 },
    { kind: "marginal", upTo: 21_739_120, from: 20_000_000, base: 750_000, rate: 0.1 },
    { kind: "flatRate", upTo: 100_000_000, rate: 0.0425 },
    { kind: "marginal", upTo: 109_574_470, from: 100_000_000, base: 4_250_000, rate: 0.3 },
    { kind: "flatRate", upTo: Number.POSITIVE_INFINITY, rate: 0.065 },
  ],
  source: "稅務局",
  sourceUrl: "https://www.ird.gov.hk/chi/faq/avd.htm",
  effectiveDate: "2026 年 2 月 26 日",
};
