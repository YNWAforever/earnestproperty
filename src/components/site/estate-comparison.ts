/**
 * P4 Task 5 (docs/superpowers/plans/2026-08-30-frontend-revamp-p4-areas-estates.md):
 * pure comparison-table logic for EstateComparisonTable.tsx, kept in its own
 * plain .ts module (no JSX) on purpose -- estate-registry.ts and
 * castle-peak-road.ts already use this split so their pure logic can be
 * imported and actually executed under Node's native TS stripping in tests,
 * instead of only being proven by a source-text scan. This module follows
 * the same pattern: EstateComparisonTable.tsx imports it and handles nothing
 * but JSX.
 *
 * Uses a relative import (with an explicit .ts extension, matching
 * core-estates.ts's own import of estate-registry.ts) rather than the "@/"
 * alias -- the alias only resolves through Vite's bundler, which the test
 * files that import this module directly do not run.
 */
import { estateFigure } from "../../content/core-estates.ts";

export type EstateComparisonRow = {
  slug: string;
  nameZh: string;
  /** Whether `/estate/$slug` resolves for this row -- gates whether its
   * header cell links anywhere. Never link to a page that 404s. */
  hasPage: boolean;
  avgPsf: number | null;
  totalUnits: number | null;
  yearCompleted: number | null;
  developer: string | null;
  /** `estates.verified_at` -- null for every estate today (no verification
   * pass has run yet), so this self-heals to a real date the moment one
   * does, rather than needing new plumbing added later. */
  asOf?: string | null;
};

/**
 * The most recent non-null `asOf` across the rendered rows, or null when
 * none carry one -- callers fall back to the existing static caption in that
 * case rather than claiming a verification date that doesn't exist yet.
 */
export function latestComparisonAsOf(rows: EstateComparisonRow[]): string | null {
  const dates = rows
    .map((row) => row.asOf)
    .filter((value): value is string => Boolean(value))
    .sort();
  return dates.at(-1) ?? null;
}

/**
 * The estate columns the table should render, current estate first, or
 * `null` when there is nothing real to compare against. Reached only when
 * zero comparable estates were found (see estate-registry.ts's
 * `findComparableEstates`) -- a single real comparable still renders (the
 * current estate next to one neighbour reads fine); only a genuinely empty
 * comparison would ship a table that looks broken, so that's the one case
 * hidden entirely rather than shown with a placeholder.
 */
export function buildComparisonColumns(
  current: EstateComparisonRow,
  comparables: EstateComparisonRow[],
): EstateComparisonRow[] | null {
  if (comparables.length === 0) return null;
  return [current, ...comparables];
}

/**
 * developer is a free-text fact, not a number -- estateFigure (core-estates.ts)
 * is numeric-only by design (see its own doc comment), so this mirrors its
 * exact "missing -> em dash, never blank" convention for a string fact
 * instead of widening that shared, already-tested helper's signature.
 */
export function estateTextFigure(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const trimmed = value.trim();
  return trimmed.length === 0 ? "—" : trimmed;
}

/**
 * avgPsf needs a "$" prefix only when a real figure exists --
 * `` `$${estateFigure(value)}` `` alone would print the broken "$—" for a
 * missing value. Mirrors the exact same guard src/routes/index.tsx already
 * uses for the homepage estate cards' PSF figure.
 */
function comparisonPsfFigure(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `$${estateFigure(value)}`;
}

/**
 * yearCompleted is a calendar year, not a magnitude -- estateFigure's
 * `.toLocaleString()` would print "1,998" for 1998, a thousands separator
 * that's simply wrong on a year (no other year display in this codebase
 * applies one either: see estate.$slug.tsx's `estateFacts` and
 * EstateMarketSnapshot.tsx's own year label, both plain `${year}`). This
 * keeps estateFigure's missing-value convention (em dash, never a fabricated
 * year) without inheriting the grouping behaviour that's only correct for
 * counts like totalUnits.
 */
function comparisonYearFigure(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${value}`;
}

export type ComparisonRowDef = {
  key: string;
  label: string;
  formatCell: (estate: EstateComparisonRow) => string;
};

/**
 * The comparison table's fact rows, in display order. Every numeric fact
 * (avgPsf, totalUnits, yearCompleted) traces back to estateFigure -- either
 * called directly (totalUnits), or through a thin wrapper that keeps its
 * missing-value convention while fixing a formatting detail estateFigure
 * itself gets wrong for that one fact (see comparisonPsfFigure's "$—" guard
 * and comparisonYearFigure's no-thousands-separator note above) -- so a
 * missing value always renders as the established em dash, never blank or
 * "0", and a present value never renders a fabricated separator either.
 */
export function buildComparisonRowDefs(): ComparisonRowDef[] {
  return [
    {
      key: "avgPsf",
      label: "平均實呎",
      formatCell: (estate) => comparisonPsfFigure(estate.avgPsf),
    },
    {
      key: "totalUnits",
      label: "總單位數",
      formatCell: (estate) => `${estateFigure(estate.totalUnits)} 個`,
    },
    {
      key: "yearCompleted",
      label: "落成年份",
      formatCell: (estate) => `${comparisonYearFigure(estate.yearCompleted)} 年`,
    },
    {
      key: "developer",
      label: "發展商",
      formatCell: (estate) => estateTextFigure(estate.developer),
    },
  ];
}
