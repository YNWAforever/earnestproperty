import { Link } from "@tanstack/react-router";

import { formatHkDate } from "@/lib/format";
import {
  buildComparisonColumns,
  buildComparisonRowDefs,
  latestComparisonAsOf,
  type EstateComparisonRow,
} from "./estate-comparison";

export type { EstateComparisonRow };

/**
 * P4 Task 5: a compact side-by-side comparison of the current estate
 * against up to two "nearby" estates (see estate-registry.ts's
 * `findComparableEstates` -- sharing `districtSlug` or `corridorSegment`).
 * All the row-selection/formatting logic lives in estate-comparison.ts (a
 * plain .ts module with no JSX) so it's directly testable under Node's
 * native TS stripping; this component only turns that into markup.
 *
 * Renders nothing at all when there are zero real comparables -- a table
 * with only the current estate's own column would look broken, not
 * informative. A single comparable still renders (current vs. one
 * neighbour), which is why the "hide" check is on `comparables.length`
 * rather than requiring both slots to be full.
 */
export function EstateComparisonTable({
  current,
  comparables,
}: {
  current: EstateComparisonRow;
  comparables: EstateComparisonRow[];
}) {
  const columns = buildComparisonColumns(current, comparables);
  if (!columns) return null;

  const rows = buildComparisonRowDefs();
  const asOf = formatHkDate(latestComparisonAsOf(columns));

  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h2 className="text-xl font-bold text-primary">附近屋苑比較</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        同區或同段屋苑的基本資料比較，資料暫缺時顯示「—」
        {asOf ? `，資料更新於 ${asOf}` : ""}。
      </p>
      <div className="mt-4 max-w-full overflow-x-auto rounded-md border">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">比較項目</th>
              {columns.map((estate, index) => (
                <th key={estate.slug} className="px-3 py-2 text-foreground">
                  {/* Never link to a page that 404s -- only a comparable
                      with a real detail page (hasPage) gets a link, and the
                      current estate (index 0) is already on its own page. */}
                  {index > 0 && estate.hasPage ? (
                    <Link to="/estate/$slug" params={{ slug: estate.slug }} className="underline">
                      {estate.nameZh}
                    </Link>
                  ) : (
                    estate.nameZh
                  )}
                  {index === 0 && (
                    <span className="ml-1 font-normal text-muted-foreground">（目前瀏覽）</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t">
                <td className="px-3 py-2 text-muted-foreground">{row.label}</td>
                {columns.map((estate) => (
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
