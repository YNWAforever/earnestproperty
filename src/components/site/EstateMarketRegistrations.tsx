import { Link } from "@tanstack/react-router";
import type {
  MarketChartMonth,
  MarketEstateTransactions,
  MarketTransactionRow,
} from "@/content/market-transactions";
import type { EstateMarketSearch } from "@/lib/estate-market-search";
import { formatHkDate } from "@/lib/format";

/** Router link to a filtered view of this estate's market-registration table. */
type EstateMarketLink = {
  to: "/estate/$slug";
  params: { slug: string };
  search: EstateMarketSearch;
  hash: string;
};

/**
 * 市場註冊成交 (market registered transactions) on /estate/$slug.
 *
 * Presentational: every number comes from `MarketEstateTransactions`, so a
 * missing area or 呎價 can only surface as 從缺 (—), never as 0 or as an estate
 * average. Facet and page controls are router links, which keeps the module
 * crawlable, JS-light and server-rendered while the route owns the search
 * schema.
 *
 * This is deliberately NOT the 本行成交 table (agency deals from the
 * `transactions` table, rendered by EstateMarketSnapshot on the estate page and
 * by the listing route).
 */
export function EstateMarketRegistrations({
  market,
  chart,
}: {
  market: MarketEstateTransactions;
  chart: readonly MarketChartMonth[];
}) {
  const { estate, rows, total, page, pageCount, facets, activeFilters } = market;
  const filteredEmpty = estate.status === "filtered-empty";
  const firstRow = total === 0 ? 0 : (page - 1) * market.pageSize + 1;
  const lastRow = Math.min(page * market.pageSize, total);
  const estateLink = {
    to: "/estate/$slug",
    params: { slug: estate.slug },
    hash: "market-registrations-heading",
  } as const;
  const filters = {
    mtYear: activeFilters.year ?? undefined,
    mtNature: activeFilters.nature ?? undefined,
    mtPhase: activeFilters.phase ?? undefined,
  };
  const facetLink = (patch: Partial<EstateMarketSearch>): EstateMarketLink => ({
    ...estateLink,
    search: { ...filters, ...patch, mtPage: 1 },
  });

  return (
    <section
      aria-labelledby="market-registrations-heading"
      className="min-w-0 rounded-lg border bg-card p-5"
    >
      <h2 id="market-registrations-heading" className="text-xl font-bold text-primary">
        市場註冊成交
      </h2>
      {filteredEmpty && (
        <p className="mt-1 text-sm text-muted-foreground">
          此公開來源的 2021–2026 列表未有此屋苑紀錄。
        </p>
      )}

      {!filteredEmpty && (
        <div className="mt-5 space-y-2">
          <FacetRow
            label="年份"
            allActive={!activeFilters.year}
            allLink={facetLink({ mtYear: undefined })}
            values={facets.years.map((facet) => ({
              key: String(facet.value),
              label: String(facet.value),
              count: facet.count,
              active: activeFilters.year === facet.value,
              link: facetLink({ mtYear: facet.value }),
            }))}
          />
          <FacetRow
            label="性質"
            allActive={!activeFilters.nature}
            allLink={facetLink({ mtNature: undefined })}
            values={facets.natures.map((facet) => ({
              key: String(facet.value),
              label: String(facet.value),
              count: facet.count,
              active: activeFilters.nature === facet.value,
              link: facetLink({ mtNature: String(facet.value) }),
            }))}
          />
          {facets.phases.length > 1 && (
            <FacetRow
              label="期數／座數"
              allActive={!activeFilters.phase}
              allLink={facetLink({ mtPhase: undefined })}
              values={facets.phases.map((facet) => ({
                key: String(facet.value),
                label: String(facet.value),
                count: facet.count,
                active: activeFilters.phase === facet.value,
                link: facetLink({ mtPhase: String(facet.value) }),
              }))}
            />
          )}
        </div>
      )}

      {rows.length > 0 ? (
        <>
          <div
            className="mt-4 max-w-full overflow-x-auto rounded-md border"
            tabIndex={0}
            role="region"
            aria-label="市場註冊成交紀錄表，可橫向捲動"
          >
            <table className="w-full min-w-[820px] text-left text-sm">
              <caption className="sr-only">
                市場註冊成交來源紀錄。登記日期與文書日期為兩個獨立欄位；售價以百萬港元（$M）顯示；面積為平方呎，呎價為港元／平方呎；資料從缺時顯示破折號而非零。
              </caption>
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  {[
                    "登記日期",
                    "文書日期",
                    "期數／座數",
                    "樓層／單位",
                    "售價（$M）",
                    "面積／呎價",
                    "性質",
                  ].map((label) => (
                    <th key={label} scope="col" className="px-3 py-2">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <TransactionRow key={`${row.yearFilter}-${row.ref}`} row={row} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <p>
              顯示第 {firstRow.toLocaleString("zh-HK")}–{lastRow.toLocaleString("zh-HK")} 筆，共{" "}
              {total.toLocaleString("zh-HK")} 筆
            </p>
            {pageCount > 1 && (
              <div className="flex items-center gap-2">
                {page > 1 ? (
                  <Link
                    {...estateLink}
                    search={{
                      ...filters,
                      mtPage: page - 1,
                    }}
                    className="rounded-md border px-3 py-1.5 text-xs font-medium text-foreground"
                  >
                    上一頁
                  </Link>
                ) : (
                  <span className="rounded-md border px-3 py-1.5 text-xs font-medium opacity-40">
                    上一頁
                  </span>
                )}
                <span aria-live="polite">
                  第 {page} / {pageCount} 頁
                </span>
                {page < pageCount ? (
                  <Link
                    {...estateLink}
                    search={{
                      ...filters,
                      mtPage: page + 1,
                    }}
                    className="rounded-md border px-3 py-1.5 text-xs font-medium text-foreground"
                  >
                    下一頁
                  </Link>
                ) : (
                  <span className="rounded-md border px-3 py-1.5 text-xs font-medium opacity-40">
                    下一頁
                  </span>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="mt-4 rounded-md bg-muted/50 p-4 text-sm text-muted-foreground">
          {filteredEmpty ? (
            <p>
              此公開來源於 2021–2026
              年的列表過濾後沒有返回此屋苑的註冊紀錄。這不代表此屋苑沒有成交，也不代表其他來源沒有紀錄。
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p>所選條件沒有符合的紀錄。</p>
              <Link
                {...estateLink}
                search={{ mtPage: 1 }}
                className="rounded-md border px-3 py-1.5 text-xs font-medium text-foreground"
              >
                清除篩選
              </Link>
            </div>
          )}
        </div>
      )}

      {chart.length > 0 && <ChartTranscription chart={chart} />}
    </section>
  );
}

function TransactionRow({ row }: { row: MarketTransactionRow }) {
  const unit = [
    row.floor === null ? null : `${row.floor} 樓`,
    row.unit === null ? null : `${row.unit} 室`,
  ]
    .filter(Boolean)
    .join("／");
  const block = [row.phase, row.tower ?? row.houseId].filter(Boolean).join(" ") || "—";
  return (
    <tr className="border-t">
      <td className="whitespace-nowrap px-3 py-3">
        <DateCell value={row.registrationDate} />
      </td>
      <td className="whitespace-nowrap px-3 py-3">
        <DateCell value={row.instrumentDate} />
      </td>
      <td className="px-3 py-3">{block}</td>
      <td className="whitespace-nowrap px-3 py-3">{unit || "—"}</td>
      <td className="px-3 py-3 tabular-nums">
        {row.considerationMillion === null ? "—" : row.considerationMillion.toFixed(3)}
      </td>
      <td className="px-3 py-3">
        <AreaCell row={row} />
      </td>
      <td className="px-3 py-3">{row.nature ?? "—"}</td>
    </tr>
  );
}

function DateCell({ value }: { value: string | null }) {
  if (value === null) return <>—</>;
  return <time dateTime={value}>{formatHkDate(value) ?? value}</time>;
}

function AreaCell({ row }: { row: MarketTransactionRow }) {
  if (row.grossAreaSqft === null && row.pricePerSqft === null) return <>—</>;
  return (
    <>
      <span className="block">
        {row.grossAreaSqft === null ? "—" : `${row.grossAreaSqft.toLocaleString("zh-HK")} 呎`}
      </span>
      {row.pricePerSqft !== null && (
        <span className="block text-xs text-muted-foreground">
          ${row.pricePerSqft.toLocaleString("zh-HK")}／呎
          {row.psfBasis ? `（${row.psfBasis}）` : ""}
        </span>
      )}
    </>
  );
}

type FacetValue = {
  key: string;
  label: string;
  count: number;
  active: boolean;
  link: EstateMarketLink;
};

function FacetRow({
  label,
  allActive,
  allLink,
  values,
}: {
  label: string;
  allActive: boolean;
  allLink: EstateMarketLink;
  values: FacetValue[];
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs font-semibold text-muted-foreground">{label}</span>
      <FacetChip label="全部" count={null} active={allActive} link={allLink} />
      {values.map((value) => (
        <FacetChip
          key={value.key}
          label={value.label}
          count={value.count}
          active={value.active}
          link={value.link}
        />
      ))}
    </div>
  );
}

function FacetChip({
  label,
  count,
  active,
  link,
}: {
  label: string;
  count: number | null;
  active: boolean;
  link: EstateMarketLink;
}) {
  return (
    <Link
      {...link}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "rounded-full border border-primary bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
          : "rounded-full border px-2.5 py-1 text-xs font-medium text-foreground hover:border-primary"
      }
    >
      {label}
      {count === null ? "" : ` ${count}`}
    </Link>
  );
}

/**
 * Chart-label transcription, kept visually and semantically separate from the
 * table above: these monthly 宗數/實用呎價 figures were transcribed by hand
 * from chart images on the source pages, are not an official raw dataset, and
 * their date basis is unpublished. Never mixed into the table or its counts.
 */
function ChartTranscription({ chart }: { chart: readonly MarketChartMonth[] }) {
  const periodStart = chart[0]?.month ?? null;
  const periodEnd = chart[chart.length - 1]?.month ?? null;
  return (
    <details className="mt-5 rounded-md border bg-muted/30 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-primary">
        來源圖表轉錄（{chart.length} 個月
        {periodStart && periodEnd ? `，${periodStart} 至 ${periodEnd}` : ""}）
      </summary>
      <p className="mt-2 text-xs leading-6 text-muted-foreground">
        以下數字由來源頁面圖表人手核對轉錄，屬圖表轉錄而非官方原始數據；日期基準未公開，
        不可與上表來源列數或成交宗數直接比較。零成交月份的宗數為 0，呎價留空。
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[320px] text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-2 py-1">
                月份
              </th>
              <th scope="col" className="px-2 py-1 text-right">
                宗數
              </th>
              <th scope="col" className="px-2 py-1 text-right">
                平均實用呎價
              </th>
            </tr>
          </thead>
          <tbody>
            {chart.map((month) => (
              <tr key={month.month} className="border-t">
                <td className="px-2 py-1">{month.month}</td>
                <td className="px-2 py-1 text-right tabular-nums">{month.count ?? "—"}</td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {month.avgPsf === null ? "—" : `$${month.avgPsf.toLocaleString("zh-HK")}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
