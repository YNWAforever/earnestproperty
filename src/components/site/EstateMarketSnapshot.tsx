import type { EstateTransaction, ListingRow } from "@/lib/queries";

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

  return (
    <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="grid gap-4 sm:grid-cols-2">
          <Stat label="平均實呎" value={avgPsf ? `$${avgPsf.toLocaleString()}` : "查詢"} />
          <Stat label="公開售盤" value={`${saleCount} 個`} />
          <Stat label="公開租盤" value={`${rentCount} 個`} />
          <Stat
            label="單位 / 期數"
            value={`${(totalUnits ?? 0).toLocaleString()} / ${phases ?? "-"} 期`}
          />
        </div>
        <div className="rounded-lg border bg-card p-5">
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
          {transactions.length === 0 ? (
            <p className="mt-5 rounded-md bg-muted/50 p-4 text-sm text-muted-foreground">
              暫未有足夠近期成交資料顯示。業主或買家可提供座數、樓層和面積，代理會按同類放盤和成交補充估值。
            </p>
          ) : (
            <div className="mt-4 overflow-hidden rounded-md border">
              <table className="w-full text-left text-sm">
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
