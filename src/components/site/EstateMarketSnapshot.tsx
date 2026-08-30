import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { EstateTransaction, ListingRow } from "@/lib/queries";

type PsfTrendPoint = { date: string; psf: number };

/**
 * Fed by the same `transactions` prop already loaded and used for the 5-row
 * table below (no new query) -- see district.sham-tseng.tsx's own PSF-trend
 * chart for the reference implementation this mirrors. `transactions` arrives
 * `ORDER BY deal_date DESC` (most recent first, per fetchEstateTransactions),
 * so this re-sorts ascending for a left-to-right trend line. A transaction
 * missing either deal_date or saleable_psf can't plot a point and is dropped
 * rather than plotted at 0, which would fabricate a data point.
 */
function buildPsfTrend(transactions: EstateTransaction[]): PsfTrendPoint[] {
  return transactions
    .filter(
      (
        tx,
      ): tx is EstateTransaction & {
        deal_date: string;
        saleable_psf: number;
      } => Boolean(tx.deal_date) && Boolean(tx.saleable_psf),
    )
    .map((tx) => ({ date: tx.deal_date, psf: tx.saleable_psf }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function EstateMarketSnapshot({
  avgPsf,
  totalUnits,
  phases,
  year,
  listings,
  transactions,
}: {
  avgPsf: number | null;
  totalUnits: number | null;
  phases: number | null;
  year: number | null;
  listings: ListingRow[];
  transactions: EstateTransaction[];
}) {
  const saleCount = listings.filter((listing) => listing.deal_type === "sale").length;
  const rentCount = listings.filter((listing) => listing.deal_type === "rent").length;
  const totalUnitsLabel = totalUnits === null ? "待查" : totalUnits.toLocaleString();
  const phasesLabel = phases === null ? "待查" : phases;
  const psfTrend = buildPsfTrend(transactions);

  return (
    <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Stat label="平均實呎" value={avgPsf ? `$${avgPsf.toLocaleString()}` : "查詢"} />
          <Stat label="最新顯示售盤" value={`${saleCount} 個`} />
          <Stat label="最新顯示租盤" value={`${rentCount} 個`} />
          <Stat label="單位 / 期數" value={`${totalUnitsLabel} / ${phasesLabel} 期`} />
        </div>
        <div className="min-w-0 rounded-lg border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-primary">成交及呎價快照</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                成交資料按現有公開/資料庫紀錄整理，最新估價請 WhatsApp 查詢。
              </p>
            </div>
            <span className="text-xs text-muted-foreground">
              {year ? `${year} 年落成` : "年份待查"}
            </span>
          </div>
          {/* A single point (or zero) cannot draw a trend -- hidden rather
              than shown broken, matching this repo's established convention
              for data that isn't there yet. */}
          {psfTrend.length >= 2 && (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground">
                實呎走勢（{psfTrend.length} 宗成交）
              </p>
              <div className="mt-2 h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={psfTrend}
                    margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--border)"
                    />
                    <XAxis
                      dataKey="date"
                      stroke="var(--muted-foreground)"
                      fontSize={11}
                      tickFormatter={(value: string) =>
                        value.slice(2, 10).replace(/-/g, "/")
                      }
                    />
                    <YAxis
                      stroke="var(--muted-foreground)"
                      fontSize={11}
                      width={48}
                      tickFormatter={(value: number) =>
                        `$${(value / 1000).toFixed(1)}k`
                      }
                      domain={["dataMin - 200", "dataMax + 200"]}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                      }}
                      formatter={(value: number) => [
                        `$${value.toLocaleString()} / 呎`,
                        "實呎",
                      ]}
                    />
                    <Line
                      type="monotone"
                      dataKey="psf"
                      stroke="var(--primary)"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          {transactions.length === 0 ? (
            <p className="mt-5 rounded-md bg-muted/50 p-4 text-sm text-muted-foreground">
              暫未有足夠近期成交資料顯示。業主或買家可提供座數、樓層和面積，代理會按同類放盤和成交補充估值。
            </p>
          ) : (
            <div className="mt-4 max-w-full overflow-x-auto rounded-md border">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">日期</th>
                    <th className="px-3 py-2">單位</th>
                    <th className="px-3 py-2">實呎</th>
                    <th className="px-3 py-2">成交</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.slice(0, 5).map((tx, index) => (
                    <tr key={`${tx.deal_date}-${tx.unit}-${index}`} className="border-t">
                      <td className="px-3 py-2">{tx.deal_date ?? "-"}</td>
                      <td className="px-3 py-2">{tx.unit ?? "-"}</td>
                      <td className="px-3 py-2">
                        {tx.saleable_psf ? `$${tx.saleable_psf.toLocaleString()}` : "-"}
                      </td>
                      <td className="px-3 py-2">
                        {tx.price ? `$${(tx.price / 1_000_000).toFixed(2)}M` : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold text-primary">{value}</p>
    </div>
  );
}
