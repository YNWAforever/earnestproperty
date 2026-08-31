import { Link } from "@tanstack/react-router";

import { buildComparisonRowDefs, type EstateComparisonRow } from "./estate-comparison";

export type { EstateComparisonRow };

/**
 * P5e1 Task 3: a flat, neutral N-way comparison of sibling estates for blog
 * articles (e.g. "which of these 3 Sham Tseng estates should I look at?").
 * Unlike EstateComparisonTable.tsx, there is no "current estate" -- every
 * column is equal, so this skips buildComparisonColumns() entirely and reuses
 * only buildComparisonRowDefs()'s row/formatting logic, which is already
 * current-estate-agnostic.
 *
 * Renders nothing when there are no rows -- an empty table would look broken,
 * not informative.
 */
export function BlogEstateComparisonTable({ estates }: { estates: EstateComparisonRow[] }) {
  if (estates.length === 0) return null;

  const rows = buildComparisonRowDefs();

  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h2 className="text-xl font-bold text-primary">屋苑實時比較</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        資料實時來自本網站屋苑資料庫，暫缺時顯示「—」。
      </p>
      <div className="mt-4 max-w-full overflow-x-auto rounded-md border">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">比較項目</th>
              {estates.map((estate) => (
                <th key={estate.slug} className="px-3 py-2 text-foreground">
                  {estate.hasPage ? (
                    <Link to="/estate/$slug" params={{ slug: estate.slug }} className="underline">
                      {estate.nameZh}
                    </Link>
                  ) : (
                    estate.nameZh
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t">
                <td className="px-3 py-2 text-muted-foreground">{row.label}</td>
                {estates.map((estate) => (
                  <td key={estate.slug} className="px-3 py-2">
                    {row.formatCell(estate)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
