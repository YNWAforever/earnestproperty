import { Container } from "@/components/layout/Container";
import { DataNote } from "@/components/layout/DataNote";
import {
  EPRC_SOURCE_LABEL,
  EPRC_SNAPSHOT_DATE,
  type EprcEstateTransactions,
} from "@/content/eprc-transactions";

function AreaFigure({ area, psf }: { area: number | null; psf: number | null }) {
  if (area === null && psf === null) return <>—</>;
  return (
    <>
      <span className="block">{area === null ? "—" : `${area.toLocaleString("zh-HK")} 呎`}</span>
      {psf !== null && (
        <span className="block text-xs text-muted-foreground">
          ${psf.toLocaleString("zh-HK")}／呎
        </span>
      )}
    </>
  );
}

export function EstateRegisteredTransactions({
  market,
}: {
  market: EprcEstateTransactions | null;
}) {
  if (market === null) return null;
  return (
    <Container className="py-8">
      <section
        aria-labelledby="market-registered-transactions-heading"
        className="min-w-0 rounded-lg border bg-card p-5"
      >
        <h2 id="market-registered-transactions-heading" className="text-xl font-bold text-primary">
          市場註冊成交
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {market.total > 0
            ? `本次資料共 ${market.total} 筆註冊紀錄，按文書日期顯示最新 ${market.rows.length} 筆。`
            : "本次資料未有此屋苑的市場註冊成交紀錄。"}
        </p>
        {market.rows.length > 0 && (
          <div
            className="mt-4 max-w-full overflow-x-auto rounded-md border"
            tabIndex={0}
            role="region"
            aria-label="市場註冊成交紀錄表，可橫向捲動"
          >
            <table className="w-full min-w-[800px] text-left text-sm">
              <caption className="sr-only">
                市場註冊成交，售價以百萬港元（$M）顯示；面積為平方呎，呎價為港元／平方呎。
              </caption>
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  {[
                    "文書日期",
                    "樓宇",
                    "樓層／單位",
                    "售價（$M）",
                    "建築面積／呎價",
                    "實用面積／呎價",
                    "性質",
                  ].map((label) => (
                    <th key={label} scope="col" className="px-3 py-2">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {market.rows.map((row, index) => (
                  <tr key={index} className="border-t">
                    <td className="whitespace-nowrap px-3 py-3">
                      {row.instrumentDate ? (
                        <time dateTime={row.instrumentDate}>
                          {row.instrumentDate.split("-").reverse().join("/")}
                        </time>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="min-w-48 px-3 py-3">{row.building ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {[
                        row.floor === null ? null : `${row.floor} 樓`,
                        row.unit === null ? null : `${row.unit} 室`,
                      ]
                        .filter(Boolean)
                        .join("／") || "—"}
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      {row.priceMillions === null ? "—" : row.priceMillions.toFixed(3)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <AreaFigure area={row.grossArea} psf={row.grossPsf} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <AreaFigure area={row.saleableArea} psf={row.saleablePsf} />
                    </td>
                    <td className="px-3 py-3">{row.nature ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DataNote
          className="mt-4"
          source={EPRC_SOURCE_LABEL}
          asOf={EPRC_SNAPSHOT_DATE}
          caveat="此為註冊資料快照，並非即時或完整市場成交。同一單位可能有不同文書性質的註冊紀錄。"
        >
          售價單位：百萬港元（$M）；面積：平方呎；呎價：港元／平方呎。註冊紀錄與本行成交分開展示。
        </DataNote>
      </section>
    </Container>
  );
}
