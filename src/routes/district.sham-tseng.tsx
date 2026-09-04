import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/Container";
import { DataNote } from "@/components/layout/DataNote";
import { EmptyState } from "@/components/layout/EmptyState";
import { AnswerSummaryCallout } from "@/components/site/AnswerSummaryCallout";
import { IntentWhatsAppCTA } from "@/components/site/IntentWhatsAppCTA";
import { OwnerValuationPanel } from "@/components/site/OwnerValuationPanel";
import { PageHero } from "@/components/site/PageHero";
import { TrustProofPanel } from "@/components/site/TrustProofPanel";
import { whatsappIntentUrl, type WhatsAppIntentContext } from "@/config/site";
import {
  fetchEstates,
  fetchFaqs,
  fetchDistrictTransactions,
  type EstateSummary,
  type FaqItem,
  type DistrictTransaction,
} from "@/lib/queries";
import { renderableFaqs } from "@/lib/faq";
import { canonicalLink, pageSeo } from "@/content/seo";
import { jsonLdScript } from "@/lib/schema";
import { schoolNets } from "@/content/school-nets";
import { buildContext, useTrackPageView } from "@/lib/analytics/events";

type LoaderData = {
  estates: EstateSummary[];
  faqs: FaqItem[];
  transactions: DistrictTransaction[];
};

export const Route = createFileRoute("/district/sham-tseng")({
  head: () => ({
    meta: [
      { title: "深井 Sham Tseng 物業｜屋苑、交通、校網 62、12 個月成交" },
      {
        name: "description",
        content: "深井屋苑一覽、交通時間、小學校網 62、近 12 個月實呎成交走勢及最常見問題。",
      },
      { property: "og:title", content: "深井 Sham Tseng 地區專頁" },
      {
        property: "og:description",
        content: "深井屋苑、交通、校網 62、近 12 個月成交數據及在售放盤一覽。",
      },
    ],
    links: [canonicalLink(pageSeo.shamTseng.path)],
  }),
  loader: async (): Promise<LoaderData> => {
    const [allEstates, faqs, transactions] = await Promise.all([
      fetchEstates(),
      fetchFaqs("district:sham-tseng"),
      fetchDistrictTransactions("sham-tseng", 12),
    ]);
    return { estates: allEstates, faqs, transactions };
  },
  errorComponent: DistrictErrorComponent,
  notFoundComponent: () => (
    <div className="mx-auto max-w-2xl px-6 py-24 text-center">
      <h1 className="text-2xl font-bold">找不到地區</h1>
      <Link to="/" className="mt-4 inline-block text-primary underline">
        返回首頁
      </Link>
    </div>
  ),
  component: ShamTsengPage,
});

function DistrictErrorComponent({ error }: { error: Error }) {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-2xl px-6 py-24 text-center">
      <h1 className="text-2xl font-bold">載入失敗</h1>
      <p className="mt-2 text-muted-foreground">{error.message}</p>
      <button
        className="mt-6 rounded-md bg-primary px-4 py-2 text-primary-foreground"
        onClick={() => router.invalidate()}
      >
        重試
      </button>
    </div>
  );
}

const TRANSIT = [
  { to: "荃灣站", mode: "小巴 96M", minutes: 12 },
  { to: "葵芳站", mode: "巴士 234B", minutes: 18 },
  { to: "中環", mode: "巴士 X961 + 西隧", minutes: 35 },
  { to: "尖沙咀", mode: "巴士 234X", minutes: 30 },
  { to: "機場", mode: "巴士 E32 / 青馬大橋", minutes: 22 },
  { to: "港珠澳大橋口岸", mode: "巴士 B6", minutes: 25 },
];

// P7e: synthesis of the master plan's 4 named answer-summary questions,
// restating only facts already stated elsewhere on this same page (the
// "西半山平民海景區" section, the TRANSIT table above, and the school-net
// caveat below) -- no new claim, no new number.
const ANSWER_SUMMARY =
  "適合邊類家庭：自住客重視環境安靜、實用率高、屋苑規模成熟；投資者則睇中機場、荃灣、港島通勤需求帶來嘅租務穩定性。 " +
  "交通取捨：深井主要靠小巴同巴士接駁荃灣站、葵芳站及機場方向，車程由 12 分鐘到 35 分鐘不等，並非港鐵直達，睇樓前應按上班地點實測繁忙時間車程。 " +
  "同價有咩選擇：碧堤半島、浪翠園、海韻花園、麗都花園沿青山公路排開，生活圈集中，各屋苑樓齡、會所同景觀都有分別，可以一程比較。 " +
  "睇樓前要留意：校網 62 嘅實際派位同入學安排因應個別地址同入學年度而有所不同，應以教育局最新公布核實。";

function aggregateByMonth(rows: DistrictTransaction[]) {
  const buckets = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    if (!r.deal_date || !r.saleable_psf) continue;
    const key = r.deal_date.slice(0, 7); // YYYY-MM
    const b = buckets.get(key) ?? { sum: 0, n: 0 };
    b.sum += Number(r.saleable_psf);
    b.n += 1;
    buckets.set(key, b);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { sum, n }]) => ({
      month: month.slice(2).replace("-", "/"),
      psf: Math.round(sum / n),
    }));
}

function ShamTsengPage() {
  const { estates, faqs: faqRows, transactions } = Route.useLoaderData() as LoaderData;
  const faqs = renderableFaqs(faqRows);
  useTrackPageView(
    () => ({
      event: { name: "district_view", payload: { districtSlug: "sham-tseng" } },
      context: buildContext({ districtSlug: "sham-tseng" }),
    }),
    [],
  );
  const chartData = aggregateByMonth(transactions);
  const latestPsf = chartData.length ? chartData[chartData.length - 1].psf : 0;
  const firstPsf = chartData.length ? chartData[0].psf : 0;
  const yoyDelta = firstPsf ? Math.round(((latestPsf - firstPsf) / firstPsf) * 1000) / 10 : 0;
  const totalUnits = estates.reduce((sum, e) => sum + (e.total_units ?? 0), 0);

  // The flagship district page had no WhatsApp entry point at all -- every
  // sibling geography page (estate, corridor segment) carries the intent CTAs,
  // the owner-valuation panel and the trust block, so this one does too.
  const ctaContext: WhatsAppIntentContext = {
    districtName: "深井",
    source: "district-sham-tseng",
  };

  return (
    <div className="bg-background">
      <PageHero
        eyebrow="地區專頁"
        title="深井 Sham Tseng"
        lead={
          <>
            毗鄰青馬大橋、坐擁無敵海景的傳統西半山豪宅區。共 {estates.length} 個主要屋苑、約{" "}
            {totalUnits.toLocaleString()} 個單位，校網 62。
          </>
        }
        actions={
          <div className="w-full max-w-3xl">
            <IntentWhatsAppCTA context={ctaContext} />
          </div>
        }
      >
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="主要屋苑" value={`${estates.length} 個`} />
          <Stat label="總單位" value={totalUnits.toLocaleString()} />
          <Stat label="最新平均實呎" value={latestPsf ? `$${latestPsf.toLocaleString()}` : "—"} />
          <Stat
            label="12 個月走勢"
            value={chartData.length >= 2 ? `${yoyDelta > 0 ? "+" : ""}${yoyDelta}%` : "—"}
            tone={yoyDelta >= 0 ? "up" : "down"}
          />
        </div>
        <DataNote
          className="mt-4"
          source="本行屋苑資料庫及成交記錄"
          caveat="「主要屋苑」及「總單位」按目前資料庫屋苑記錄計算；「最新平均實呎」及「12 個月走勢」按近 12 個月成交記錄計算，數字隨資料更新而變動，並非固定核實日期的靜態數字。"
        />
      </PageHero>

      <Container className="pt-6">
        <AnswerSummaryCallout summary={ANSWER_SUMMARY} />
      </Container>

      <Container className="py-10">
        <section className="rounded-lg border bg-muted/30 p-6">
          <h2 className="text-2xl font-semibold">西半山平民海景區</h2>
          <div className="mt-4 space-y-4 text-sm leading-7 text-muted-foreground">
            <p>
              深井常被本地買家形容為「西半山平民海景區」：同樣有開揚海景、青馬橋景同低密度生活感，但入場門檻比港島傳統海景地段親民得多。
              碧堤半島、浪翠園、海韻花園、麗都花園沿青山公路排開，生活圈集中，睇樓時可以一程比較屋苑樓齡、會所、景觀同交通。
            </p>
            <p>
              對自住客而言，深井最大優勢係環境安靜、實用率高、屋苑規模成熟；對投資者而言，機場、荃灣、港島通勤需求令租務保持穩定。
              晉誠地產門市就在麗都花園，熟悉每個屋苑座向、樓層景觀同近期放盤叫價。
            </p>
          </div>
        </section>

        {/* Price chart */}
        <section className="mt-12">
          <h2 className="text-2xl font-semibold">12 個月實呎成交走勢</h2>
          {transactions.length > 0 ? (
            <DataNote className="mt-1" source={`本行成交記錄（${transactions.length} 宗買賣）`} />
          ) : null}
          {chartData.length === 0 ? (
            <EmptyState
              className="mt-4"
              title="暫未有近 12 個月成交數據"
              description="成交記錄更新後會在此顯示實呎走勢；想知最新叫價同成交參考，可直接 WhatsApp 查詢。"
              action={
                <Button asChild variant="brand">
                  <a
                    href={whatsappIntentUrl("buy", ctaContext)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    WhatsApp 查詢深井成交
                  </a>
                </Button>
              }
            />
          ) : (
            <Card className="mt-4">
              <CardContent className="pt-6">
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={12} />
                      <YAxis
                        stroke="var(--muted-foreground)"
                        fontSize={12}
                        tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
                        domain={["dataMin - 200", "dataMax + 200"]}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                        }}
                        formatter={(v: number) => [`$${v.toLocaleString()} / 呎`, "平均實呎"]}
                      />
                      <Line
                        type="monotone"
                        dataKey="psf"
                        stroke="var(--primary)"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </section>

        {/* Transit + Schools */}
        <section className="mt-12 grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle as="h3">交通時間</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {TRANSIT.map((t) => (
                  <li key={t.to} className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">前往 {t.to}</p>
                      <p className="text-sm text-muted-foreground">{t.mode}</p>
                    </div>
                    <span className="text-lg font-semibold text-primary">
                      {t.minutes} <span className="text-xs text-muted-foreground">分鐘</span>
                    </span>
                  </li>
                ))}
              </ul>
              <DataNote
                className="mt-4"
                source="本行按一般路況及公共交通時刻表推算"
                caveat="交通時間為一般估算，實際車程視乎路況、班次及上落車地點而定，僅供參考。"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h3">校網 62（小學）</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-muted-foreground">
                深井屬荃灣 {schoolNets["62"].netCode} 校網。
              </p>
              {schoolNets["62"].primarySchools.length > 0 ? (
                <ul className="space-y-2">
                  {schoolNets["62"].primarySchools.map((s) => (
                    <li
                      key={s.name}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <span>{s.name}</span>
                      <Badge variant="outline">{s.type}</Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
              <DataNote
                className="mt-4"
                source={schoolNets["62"].source}
                sourceUrl={schoolNets["62"].sourceUrl ?? undefined}
                asOf={schoolNets["62"].verifiedOn ?? undefined}
                caveat="實際派位及校網資料以教育局最新公布為準，並因應個別地址及入學年度而有所不同。"
              >
                中學屬荃灣中學校網。
              </DataNote>
            </CardContent>
          </Card>
        </section>

        {/* Estates */}
        <section className="mt-12">
          <h2 className="text-2xl font-semibold">深井主要屋苑</h2>
          {estates.length === 0 ? (
            <EmptyState
              className="mt-4"
              title="暫未有深井屋苑專頁"
              description="屋苑資料更新後會在此列出；想先了解區內屋苑，可直接 WhatsApp 查詢。"
            />
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {estates.map((e) => (
                <Link
                  key={e.slug}
                  to="/estate/$slug"
                  params={{ slug: e.slug }}
                  className="group rounded-lg border bg-card p-4 transition-colors hover:border-primary"
                >
                  <h3 className="font-semibold group-hover:text-primary">{e.name_zh}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {e.total_units?.toLocaleString() ?? "—"} 個單位 · 平均實呎 $
                    {e.avg_saleable_psf?.toLocaleString() ?? "—"}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="mt-12 rounded-lg border bg-muted/30 p-6">
          <h2 className="text-2xl font-semibold">青山公路沿線比較</h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            深井是青山公路成熟海景屋苑核心，如想比較低密度汀九、青龍頭空間型屋苑或黃金海岸新式臨海住宅，可由青山公路總覽開始。
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              to="/castle-peak-road"
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              青山公路總覽
            </Link>
            <Link
              to="/castle-peak-road/$segment"
              params={{ segment: "ting-kau" }}
              className="inline-flex min-h-11 items-center rounded-md border bg-background px-4 py-2 text-sm font-semibold"
            >
              比較汀九
            </Link>
          </div>
        </section>
      </Container>

      <OwnerValuationPanel context={ctaContext} />
      <TrustProofPanel />

      {/* FAQ */}
      <Container className="py-10">
        <section className="max-w-3xl">
          <h2 className="text-2xl font-semibold">常見問題</h2>
          {faqs.length === 0 ? (
            <EmptyState
              className="mt-4"
              title="常見問題整理中"
              description="深井買樓租樓常見問題會陸續上載；有任何疑問可直接 WhatsApp 我們的深井地舖團隊。"
            />
          ) : (
            <Accordion type="single" collapsible className="mt-4">
              {faqs.map((f, i) => (
                <AccordionItem key={i} value={`q-${i}`}>
                  <AccordionTrigger className="text-left">{f.question}</AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">{f.answer}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </section>
      </Container>

      {/* JSON-LD FAQ */}
      {faqs.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript({
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: faqs.map((f) => ({
                "@type": "Question",
                name: f.question,
                acceptedAnswer: { "@type": "Answer", text: f.answer },
              })),
            }),
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold ${
          tone === "up" ? "text-emerald-600" : tone === "down" ? "text-red-600" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
