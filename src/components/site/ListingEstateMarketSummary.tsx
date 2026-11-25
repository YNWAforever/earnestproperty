import { Link } from "@tanstack/react-router";
import { formatHkDate } from "@/lib/format";
import type { MarketEstateTransactions } from "@/content/market-transactions";

/**
 * Compact 市場註冊成交 summary on `/property/$listingNo`, linking through to the
 * estate page.
 *
 * Two rules drive this component:
 *
 * 1. It only ever shows ESTATE-level market registrations. The listing's own
 *    unit facts are printed exactly as the source recorded them: a listing
 *    whose floor, unit, asking price or gross area is blank keeps showing 從缺
 *    and is never back-filled with an estate average.
 * 2. These rows are NOT 本行成交. The listing page's agency deals come from the
 *    `transactions` table in a separate section, and neither count is ever
 *    added to the other.
 */
export function ListingEstateMarketSummary({
  market,
  estateNameZh,
}: {
  market: MarketEstateTransactions;
  estateNameZh: string;
}) {
  const { estate, rows, pageCount, total } = market;
  const latest = rows.slice(0, 3);
  return (
    <section aria-labelledby="listing-estate-market-heading" className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="listing-estate-market-heading" className="text-xl font-semibold">
          {estateNameZh} 市場註冊成交
        </h2>
        <p className="text-xs text-muted-foreground">
          {estate.rowCount.toLocaleString("zh-HK")} 筆來源紀錄 · 更新於 {estate.asOf.slice(0, 10)}
        </p>
      </div>
      {latest.length > 0 ? (
        <div className="mt-3 max-w-full overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[480px] text-left text-sm">
            <caption className="sr-only">
              {estateNameZh} 市場註冊成交最新紀錄。售價以百萬港元顯示，面積從缺時顯示破折號。
            </caption>
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                {["登記日期", "樓層／單位", "售價（$M）", "面積／呎價"].map((label) => (
                  <th key={label} scope="col" className="px-3 py-2">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {latest.map((row) => (
                <tr key={`${row.yearFilter}-${row.ref}`} className="border-t">
                  <td className="whitespace-nowrap px-3 py-2">
                    {row.registrationDate ? (
                      <time dateTime={row.registrationDate}>
                        {formatHkDate(row.registrationDate) ?? row.registrationDate}
                      </time>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {[
                      row.floor === null ? null : `${row.floor} 樓`,
                      row.unit === null ? null : `${row.unit} 室`,
                    ]
                      .filter(Boolean)
                      .join("／") || "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.considerationMillion === null ? "—" : row.considerationMillion.toFixed(3)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {row.grossAreaSqft === null && row.pricePerSqft === null ? (
                      "—"
                    ) : (
                      <>
                        <span className="block">
                          {row.grossAreaSqft === null
                            ? "—"
                            : `${row.grossAreaSqft.toLocaleString("zh-HK")} 呎`}
                        </span>
                        {row.pricePerSqft !== null && (
                          <span className="block text-xs text-muted-foreground">
                            ${row.pricePerSqft.toLocaleString("zh-HK")}／呎
                            {row.psfBasis ? `（${row.psfBasis}）` : ""}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          {estate.status === "filtered-empty"
            ? "此公開來源的 2021–2026 列表未有此屋苑紀錄，不代表此屋苑沒有成交。"
            : `此屋苑暫無可顯示的市場註冊成交，可到屋苑頁查看其他來源。`}
        </p>
      )}
      <Link
        to="/estate/$slug"
        params={{ slug: estate.slug }}
        search={{ mtPage: 1 }}
        hash="market-registrations-heading"
        className="mt-3 inline-block text-sm font-semibold text-primary underline"
      >
        查看 {estateNameZh} 全部市場註冊成交（
        {pageCount > 1 ? `${total.toLocaleString("zh-HK")} 筆` : "詳情"}）→
      </Link>
    </section>
  );
}
