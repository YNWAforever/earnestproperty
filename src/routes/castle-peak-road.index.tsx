import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowRight, HelpCircle, Home, MapPin, TrendingUp, Waves } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataNote } from "@/components/layout/DataNote";
import { AnswerSummaryCallout } from "@/components/site/AnswerSummaryCallout";
import {
  buildAreaComparisonRows,
  buyerFitHighlights,
  computePriceSnapshot,
  estateDirectoryForSegment,
  summarizeSegmentInventory,
  type PriceSnapshot,
} from "@/components/site/corridor-hub";
import {
  castlePeakRoadHub,
  castlePeakRoadSegments,
  isWithinCorridorRegion,
  type CorridorSegment,
} from "@/content/castle-peak-road";
import { seo, SITE_URL } from "@/content/seo";
import {
  fetchCorridorInventoryForAliases,
  fetchDistrictTransactions,
  type CorridorInventory,
  type DistrictTransaction,
} from "@/lib/queries";
import { renderableFaqs } from "@/lib/faq";
import { jsonLdScript } from "@/lib/schema";

type HubLoaderData = {
  inventories: Record<string, CorridorInventory>;
  priceSnapshots: Record<string, PriceSnapshot | null>;
};

export const Route = createFileRoute("/castle-peak-road/")({
  loader: async (): Promise<HubLoaderData> => {
    const rows = await Promise.all(
      castlePeakRoadSegments.map(async (segment) => {
        const [inventory, transactionsBySlug] = await Promise.all([
          fetchCorridorInventoryForAliases({
            districtSlugs: segment.districtSlugs,
            estateSlugs: segment.estateSlugs,
            textAliases: segment.textAliases,
            limit: 3,
          }),
          // Reuses district.sham-tseng.tsx's own PSF-trend data source
          // (fetchDistrictTransactions), fanned out across this segment's own
          // districtSlugs rather than a new query -- see corridor-hub.ts's
          // computePriceSnapshot for why this reduces to a single latest-month
          // figure instead of a full per-segment chart.
          //
          // districtSlugs is NOT itself a safe scope, so it alone cannot be
          // what makes this query safe: for the sham-tseng segment it
          // includes "castle-peak-road", the MLS normalizer's catch-all for
          // anything mentioning 青山公路 that runs all the way to 屯門 (see
          // castle-peak-road.ts's own comment on that slug). Unlike
          // fetchCorridorInventoryForAliases above, whose rows are filtered
          // through isWithinCorridorRegion (queries.ts's withinCorridorScope)
          // as DR-1's fix, fetchDistrictTransactions applies no region guard
          // of its own -- its SQL is a bare `WHERE e.district_slug = $1`. The
          // single existing caller (district.sham-tseng.tsx) never hit this
          // because it only ever passes the precise "sham-tseng" slug, never
          // the catch-all. So each per-slug batch here is filtered through
          // the same isWithinCorridorRegion guard before flattening below --
          // this is what actually keeps a transaction recorded against a
          // catch-all-tagged, out-of-scope estate (e.g. 黃金海岸 Gold Coast,
          // one of Task 2's unpublished estates) from silently entering this
          // price snapshot.
          Promise.all(
            segment.districtSlugs.map(async (districtSlug): Promise<DistrictTransaction[]> => {
              const rows = await fetchDistrictTransactions(districtSlug, 12);
              return rows.filter((row) =>
                isWithinCorridorRegion({
                  districtSlug,
                  estateSlug: row.estates?.slug,
                  text: [row.estates?.name_zh],
                }),
              );
            }),
          ),
        ]);

        const transactions = transactionsBySlug.flat();
        return {
          slug: segment.slug,
          inventory,
          priceSnapshot: computePriceSnapshot(transactions),
        };
      }),
    );

    return {
      inventories: Object.fromEntries(rows.map((row) => [row.slug, row.inventory])),
      priceSnapshots: Object.fromEntries(rows.map((row) => [row.slug, row.priceSnapshot])),
    };
  },
  head: () =>
    seo({
      title: castlePeakRoadHub.title,
      description: castlePeakRoadHub.description,
      path: castlePeakRoadHub.path,
    }),
  errorComponent: CastlePeakRoadRouteError,
  component: CastlePeakRoadHubPage,
});

function SegmentCard({
  segment,
  inventory,
}: {
  segment: CorridorSegment;
  inventory?: CorridorInventory;
}) {
  const summary = summarizeSegmentInventory(segment, inventory);

  return (
    <Link
      to="/castle-peak-road/$segment"
      params={{ segment: segment.slug }}
      className="group rounded-lg border bg-card p-5 shadow-card transition hover:border-primary hover:shadow-elegant"
    >
      <p className="text-xs font-semibold uppercase text-coral">{segment.eyebrow}</p>
      <h2 className="mt-2 text-xl font-bold text-primary">{segment.nameZh}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{segment.nameEn}</p>
      <div className="mt-4 space-y-2 text-sm leading-7 text-muted-foreground">
        {segment.zoneSummary.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      <div className="mt-5 border-t pt-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-primary">
            售 {summary.saleTotal.toLocaleString()} ・ 租 {summary.rentTotal.toLocaleString()}
          </span>
          <ArrowRight className="h-4 w-4 text-primary transition group-hover:translate-x-1" />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{summary.scopeLabel}</p>
      </div>
    </Link>
  );
}

function CastlePeakRoadRouteError({ error }: { error: Error }) {
  const router = useRouter();

  return (
    <div className="bg-background px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl rounded-lg border bg-card p-6 text-center shadow-card">
        <p className="text-sm font-semibold text-coral">青山公路 Castle Peak Road</p>
        <h1 className="mt-2 text-2xl font-bold text-primary">載入青山公路總覽時遇到問題</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          晉誠地產的即時放盤資料暫時未能載入。你可以重新整理資料，或稍後再回來查看青山公路沿線真盤。
        </p>
        <p className="mt-2 text-xs text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button onClick={() => router.invalidate()}>重新載入</Button>
          <Button asChild variant="outline">
            <Link to="/castle-peak-road">返回青山公路總覽</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Deliberately NOT a literal pin map -- this session cannot confirm which,
 * if any, live estate rows have real lat/lng populated, and fabricating pins
 * is explicitly forbidden elsewhere in this plan. A simple, labelled
 * east-to-west sequence is enough to give a first-glance sense of relative
 * position; `castlePeakRoadSegments` is already ordered east-to-west (油柑頭
 * /汀九's own intro copy calls it "青山公路海景生活圈的東面入口"; 深井 /
 * 青山公路's own intro says it "由深井向西伸延至青龍頭").
 */
function CorridorSchematic() {
  return (
    <section className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
      <div className="flex items-center gap-2">
        <MapPin className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold text-primary">青山公路走向示意</h2>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
        <span className="rounded-md bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground">
          東（近荃灣）
        </span>
        {castlePeakRoadSegments.map((segment, index) => (
          <div key={segment.slug} className="flex items-center gap-3">
            <Link
              to="/castle-peak-road/$segment"
              params={{ segment: segment.slug }}
              className="rounded-md border bg-background px-4 py-2 text-sm font-semibold text-primary transition hover:border-primary"
            >
              {segment.nameZh}
            </Link>
            {index < castlePeakRoadSegments.length - 1 && (
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
          </div>
        ))}
        <span className="rounded-md bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground">
          西（近屯門）
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        示意圖只反映沿線東西相對位置，並非實際地圖座標；如需準確路線及地圖，請以地圖應用程式為準。
      </p>
    </section>
  );
}

/** Rows/columns straight from buildAreaComparisonRows (corridor-hub.ts) --
 * every cell is a segment's own curated copy field verbatim, not new copy. */
function AreaComparisonSection() {
  const rows = buildAreaComparisonRows(castlePeakRoadSegments);

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <h2 className="text-2xl font-bold text-primary">兩個生活圈比較</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        以下內容摘自各生活圈原有的地區介紹文字，方便同版面比較。
      </p>
      <div className="mt-4 max-w-full overflow-x-auto rounded-md border">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">比較項目</th>
              {castlePeakRoadSegments.map((segment) => (
                <th key={segment.slug} className="px-3 py-2 text-foreground">
                  {segment.nameZh}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t align-top">
                <td className="px-3 py-2 font-medium text-muted-foreground">{row.label}</td>
                {castlePeakRoadSegments.map((segment) => (
                  <td key={segment.slug} className="px-3 py-2 leading-6">
                    {row.values[segment.slug]}
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

/**
 * For each segment, lists only the registry entries its own `estateSlugs`
 * claims as strict inventory (estateDirectoryForSegment, corridor-hub.ts).
 * Today that's empty for "ting-kau" -- rendered as an explicit, honest
 * empty-state message rather than omitted or papered over -- and the 5
 * `hasPage: true` estates for "sham-tseng", each linked to its real detail
 * page. Never links a `hasPage: false` entry, which would 404.
 */
function EstateDirectorySection() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="flex items-center gap-2">
        <Home className="h-6 w-6 text-primary" />
        <h2 className="text-2xl font-bold text-primary">屋苑一覽</h2>
      </div>
      <div className="mt-6 grid gap-5 md:grid-cols-2">
        {castlePeakRoadSegments.map((segment) => {
          const estates = estateDirectoryForSegment(segment);
          return (
            <div key={segment.slug} className="rounded-lg border bg-card p-5">
              <h3 className="font-bold text-primary">{segment.nameZh}</h3>
              {estates.length === 0 ? (
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  呢一段暫時未有獨立屋苑檔案頁面，更多資料稍後提供。可以先睇返上面
                  {segment.nameZh}
                  即時放盤，或直接 WhatsApp 晉誠地產查詢。
                </p>
              ) : (
                <ul className="mt-3 divide-y">
                  {estates.map((estate) => (
                    <li
                      key={estate.slug}
                      className="flex items-center justify-between py-2 text-sm"
                    >
                      {estate.hasPage ? (
                        <Link
                          to="/estate/$slug"
                          params={{ slug: estate.slug }}
                          className="font-medium text-primary underline-offset-2 hover:underline"
                        >
                          {estate.nameZh}
                        </Link>
                      ) : (
                        <>
                          <span className="font-medium text-muted-foreground">{estate.nameZh}</span>
                          <span className="text-xs text-muted-foreground">更多資料稍後提供</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * A per-segment PSF snapshot (latest month's average, reduced from real
 * transaction data via computePriceSnapshot) rather than a fabricated
 * figure. Renders nothing for a segment with no real transaction data, and
 * omits the whole section when neither segment has any.
 */
function PriceSnapshotSection({
  priceSnapshots,
}: {
  priceSnapshots: Record<string, PriceSnapshot | null>;
}) {
  const entries = castlePeakRoadSegments
    .map((segment) => ({ segment, snapshot: priceSnapshots[segment.slug] }))
    .filter(
      (entry): entry is { segment: CorridorSegment; snapshot: PriceSnapshot } =>
        entry.snapshot !== null && entry.snapshot !== undefined,
    );

  if (entries.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-6 w-6 text-primary" />
        <h2 className="text-2xl font-bold text-primary">實呎價格快照</h2>
      </div>
      <div className="mt-6 grid gap-5 md:grid-cols-2">
        {entries.map(({ segment, snapshot }) => (
          <div key={segment.slug} className="rounded-lg border bg-card p-5">
            <h3 className="font-bold text-primary">{segment.nameZh}</h3>
            <p className="mt-2 text-2xl font-semibold text-primary">
              ${snapshot.latestPsf.toLocaleString()}{" "}
              <span className="text-sm font-normal">/ 呎</span>
            </p>
            <DataNote
              className="mt-3"
              source={`本行成交記錄（${snapshot.transactionCount} 宗買賣）`}
              asOf={snapshot.latestMonth}
              caveat="價格按最近一個月的平均實呎計算，僅供參考，實際成交價因單位座向、樓層及裝修而異。"
            />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Every highlight chip comes from buyerFitHighlights (corridor-hub.ts), a
 * literal substring extraction of the segment's own `buyerFit` copy -- this
 * restructures existing curated text into a scannable list, it never asserts
 * a new claim about either area.
 */
function DecisionGuideSection() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="flex items-center gap-2">
        <HelpCircle className="h-6 w-6 text-primary" />
        <h2 className="text-2xl font-bold text-primary">邊個區適合我？</h2>
      </div>
      <div className="mt-6 grid gap-5 md:grid-cols-2">
        {castlePeakRoadSegments.map((segment) => {
          const highlights = buyerFitHighlights(segment.buyerFit);
          return (
            <div key={segment.slug} className="rounded-lg border bg-card p-5">
              <p className="text-sm text-muted-foreground">如果你睇重：</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {highlights.map((item) => (
                  <li
                    key={item}
                    className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground"
                  >
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm font-semibold text-primary">
                {segment.nameZh} 會比較適合你
              </p>
              <Link
                to="/castle-peak-road/$segment"
                params={{ segment: segment.slug }}
                className="mt-1 inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
              >
                睇返 {segment.nameZh} 詳情
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CastlePeakRoadHubPage() {
  const { inventories, priceSnapshots } = Route.useLoaderData() as HubLoaderData;
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "首頁", item: SITE_URL },
      {
        "@type": "ListItem",
        position: 2,
        name: castlePeakRoadHub.label,
        item: `${SITE_URL}${castlePeakRoadHub.path}`,
      },
    ],
  };
  const faqs = renderableFaqs(castlePeakRoadHub.faqs);
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };

  return (
    <div className="bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd) }}
      />
      {faqs.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(faqJsonLd) }}
        />
      )}

      <section className="border-b bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-coral">
            <MapPin className="h-4 w-4" />
            {castlePeakRoadHub.label}
          </p>
          <h1 className="mt-3 max-w-4xl text-3xl font-bold tracking-tight text-primary sm:text-5xl">
            {castlePeakRoadHub.h1}
          </h1>
          <div className="mt-5 max-w-3xl space-y-3 text-base leading-8 text-muted-foreground">
            {castlePeakRoadHub.intro.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <div className="mt-5 max-w-3xl">
            <AnswerSummaryCallout summary={castlePeakRoadHub.answerSummary} />
          </div>
        </div>
      </section>

      <CorridorSchematic />

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <Waves className="h-6 w-6 text-primary" />
          <h2 className="text-2xl font-bold text-primary">由東至西比較青山公路</h2>
        </div>
        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {castlePeakRoadSegments.map((segment) => (
            <SegmentCard
              key={segment.slug}
              segment={segment}
              inventory={inventories[segment.slug]}
            />
          ))}
        </div>
      </section>

      <AreaComparisonSection />
      <EstateDirectorySection />
      <PriceSnapshotSection priceSnapshots={priceSnapshots} />
      <DecisionGuideSection />

      {faqs.length > 0 && (
        <section className="border-y bg-card">
          <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold text-primary">青山公路買樓 FAQ</h2>
            <div className="mt-6 divide-y rounded-lg border bg-background">
              {faqs.map((faq) => (
                <article key={faq.question} className="p-5">
                  <h3 className="font-semibold text-primary">{faq.question}</h3>
                  <p className="mt-2 text-sm leading-7 text-muted-foreground">{faq.answer}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
