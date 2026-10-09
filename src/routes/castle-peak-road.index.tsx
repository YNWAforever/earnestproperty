import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowRight, HelpCircle, Home, MapPin, TrendingUp, Waves } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SiteLink } from "@/components/site/SiteLink";
import { Container } from "@/components/layout/Container";
import { DataNote } from "@/components/layout/DataNote";
import { AnswerSummaryCallout } from "@/components/site/AnswerSummaryCallout";
import { PageHero } from "@/components/site/PageHero";
import {
  buildAreaComparisonRows,
  buyerFitHighlights,
  computePriceSnapshot,
  summarizeSegmentInventory,
  type PriceSnapshot,
} from "@/components/site/corridor-hub";
import {
  clientAreaEstateLabel,
  clientAreaGroupsInNavOrder,
  clientAreaGroupsInSchematicOrder,
} from "@/content/client-area-presentation";
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
  fetchEstatesForAreaGroup,
  type CorridorInventory,
  type DistrictTransaction,
} from "@/lib/queries";
import { renderableFaqs } from "@/lib/faq";
import { jsonLdScript } from "@/lib/schema";
import { publicPageCacheHeaders } from "@/lib/http/public-cache.js";

type HubLoaderData = {
  inventories: Record<string, CorridorInventory>;
  priceSnapshots: Record<string, PriceSnapshot | null>;
  /**
   * Canonical slugs of the client's approved estates that actually have a
   * live, published `estates` row. Only these are linked by 主要屋苑 -- an
   * unpublished estate is omitted rather than linked to a page that 404s.
   */
  publishedEstateSlugs: string[];
};

export const Route = createFileRoute("/castle-peak-road/")({
  loader: async (): Promise<HubLoaderData> => {
    // One bounded, batched query per approved group (fetchEstatesForAreaGroup
    // asks for that group's canonical slugs in a single round trip) rather
    // than a per-estate request loop.
    const publishedByGroup = await Promise.all(
      clientAreaGroupsInNavOrder().map((group) => fetchEstatesForAreaGroup(group.key)),
    );
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
      publishedEstateSlugs: publishedByGroup.flat().map((estate) => estate.slug),
    };
  },
  head: () =>
    seo({
      title: castlePeakRoadHub.title,
      description: castlePeakRoadHub.description,
      path: castlePeakRoadHub.path,
    }),
  errorComponent: CastlePeakRoadRouteError,
  headers: publicPageCacheHeaders,
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
      <h3 className="mt-2 text-xl font-bold text-primary">{segment.nameZh}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{segment.nameEn}</p>
      <div className="mt-4 space-y-2 text-sm leading-7 text-muted-foreground">
        {segment.zoneSummary.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      <div className="mt-5 border-t pt-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-primary">
            售 {summary.saleTotal.toLocaleString("zh-HK")} ・ 租{" "}
            {summary.rentTotal.toLocaleString("zh-HK")}
          </span>
          <ArrowRight className="h-4 w-4 text-primary transition group-hover:translate-x-1" />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{summary.scopeLabel}</p>
      </div>
    </Link>
  );
}

function CastlePeakRoadRouteError({ error }: { error: unknown }) {
  const router = useRouter();

  return (
    <div className="bg-background px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl rounded-lg border bg-card p-6 text-center shadow-card">
        <p className="text-sm font-semibold text-coral">青山公路 Castle Peak Road</p>
        <h1 className="mt-2 text-2xl font-bold text-primary">載入青山公路總覽時遇到問題</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          晉誠地產的即時放盤資料暫時未能載入。你可以重新整理資料，或稍後再回來查看青山公路沿線真盤。
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {error instanceof Error ? error.message : "暫時未能載入資料，請稍後再試。"}
        </p>
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
 * position.
 *
 * docx p5 supplies the order directly: 油柑頭汀九 → 深井 / 青龍頭 →
 * 青山公路區小欖至三聖. That is intentionally NOT the same order as the
 * navigation shortcuts on docx p1, so both are stored separately in
 * client-area-presentation.ts and this component reads the schematic one. It
 * no longer maps castlePeakRoadSegments, which has only the two legacy
 * corridor segments and therefore could never render three steps.
 *
 * The heading is unchanged. docx p5 also carries a 深井 annotation pointing at
 * this heading, but it does not say whether the heading should become 深井走向
 * 示意, whether only part of a label changes, or whether it marks a different
 * target -- so it is recorded as an open question rather than acted on. The
 * 青山公路 hub's H1, canonical URL and metadata are untouched.
 */
function CorridorSchematic() {
  const steps = clientAreaGroupsInSchematicOrder();
  return (
    <Container className="pt-10">
      <div className="flex items-center gap-2">
        <MapPin className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold text-primary">青山公路走向示意</h2>
      </div>
      {/* Vertical steps on narrow screens (arrows rotate to point down) and a
          horizontal row from sm up. DOM order is the reading order in both
          cases -- the sequence is never produced by CSS ordering. */}
      <div className="mt-4 flex flex-col items-stretch gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-center">
        <span className="rounded-md bg-muted px-3 py-2 text-center text-xs font-semibold text-muted-foreground">
          東（近荃灣）
        </span>
        {steps.map((group, index) => (
          <div
            key={group.key}
            className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center"
          >
            <SiteLink
              href={group.href}
              className="rounded-md border bg-background px-4 py-2 text-center text-sm font-semibold text-primary transition hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {group.label}
            </SiteLink>
            {index < steps.length - 1 && (
              <ArrowRight
                aria-hidden="true"
                className="h-4 w-4 shrink-0 rotate-90 self-center text-muted-foreground sm:rotate-0"
              />
            )}
          </div>
        ))}
        <span className="rounded-md bg-muted px-3 py-2 text-center text-xs font-semibold text-muted-foreground">
          西（近屯門）
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        示意圖只反映沿線東西相對位置，並非實際地圖座標；如需準確路線及地圖，請以地圖應用程式為準。
      </p>
    </Container>
  );
}

/**
 * docx p4: the client annotated this page 「冇左主要屋苑」.
 *
 * The page did have an estate list, but it sat below the comparison table and
 * before the FAQ, and it was driven by `segment.estateSlugs` -- the two legacy
 * corridor segments' strict *inventory* membership, which does not represent
 * the client's approved presentation groups at all (青山公路's own western
 * estates are not in any segment's estateSlugs, so that section never showed
 * them). Both problems are fixed here: the section moves directly under the
 * schematic, above the long comparison/FAQ content, and its membership comes
 * from client-area-presentation.ts. The old lower 屋苑一覽 section is removed
 * rather than left as a second, contradicting directory.
 *
 * Only estates with a live, published row are linked. An estate whose row is
 * still unpublished is omitted rather than linked to a page that 404s, and a
 * group with nothing published renders an honest empty state instead of
 * invented estates padding out a third column.
 */
function MainEstatesSection({ publishedSlugs }: { publishedSlugs: string[] }) {
  const published = new Set(publishedSlugs);
  return (
    <Container className="py-12">
      {/* Anchor target for the 青山公路區小欖至三聖 shortcut in the header and
          the estate directory (client-area-presentation.ts). ASCII id so the
          fragment survives copy/paste and URL encoding. */}
      <div id="main-estates" className="flex items-center gap-2 scroll-mt-24">
        <Home className="h-6 w-6 text-primary" />
        <h2 className="text-2xl font-bold text-primary">主要屋苑</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        按晉誠地產的三個生活圈分組，點擊屋苑可睇即時放盤同屋苑詳情。
      </p>
      <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {clientAreaGroupsInNavOrder().map((group) => {
          const members = [...group.primary, ...group.secondary].filter((ref) =>
            published.has(ref.slug),
          );
          return (
            <div key={group.key} className="rounded-lg border bg-card p-5">
              <h3 className="font-bold text-primary">{group.label}</h3>
              {members.length === 0 ? (
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  呢一段暫時未有獨立屋苑檔案頁面，更多資料稍後提供。可以先 WhatsApp 晉誠地產查詢
                  {group.label}放盤。
                </p>
              ) : (
                <ul className="mt-3 divide-y">
                  {members.map((ref) => (
                    <li key={ref.slug} className="py-2 text-sm">
                      <Link
                        to="/estate/$slug"
                        params={{ slug: ref.slug }}
                        className="font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {clientAreaEstateLabel(ref)}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Container>
  );
}

/** Rows/columns straight from buildAreaComparisonRows (corridor-hub.ts) --
 * every cell is a segment's own curated copy field verbatim, not new copy. */
function AreaComparisonSection() {
  const rows = buildAreaComparisonRows(castlePeakRoadSegments);

  return (
    <Container className="py-12">
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
    </Container>
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
    <Container className="py-12">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-6 w-6 text-primary" />
        <h2 className="text-2xl font-bold text-primary">實呎價格快照</h2>
      </div>
      <div className="mt-6 grid gap-5 md:grid-cols-2">
        {entries.map(({ segment, snapshot }) => (
          <div key={segment.slug} className="rounded-lg border bg-card p-5">
            <h3 className="font-bold text-primary">{segment.nameZh}</h3>
            <p className="mt-2 text-2xl font-semibold text-primary">
              ${snapshot.latestPsf.toLocaleString("zh-HK")}{" "}
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
    </Container>
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
    <Container className="py-12">
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
    </Container>
  );
}

function CastlePeakRoadHubPage() {
  const { inventories, priceSnapshots, publishedEstateSlugs } =
    Route.useLoaderData() as HubLoaderData;
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

      {/* Second-level page, so no breadcrumb. The intro is a list of
          paragraphs, which PageHero's single-<p> lead cannot hold, so it
          renders as children in the lead's own type style. */}
      <PageHero
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            {castlePeakRoadHub.label}
          </span>
        }
        title={castlePeakRoadHub.h1}
      >
        <div className="mt-5 max-w-3xl space-y-3 text-base leading-8 text-muted-foreground">
          {castlePeakRoadHub.intro.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        <div className="mt-5 max-w-3xl">
          <AnswerSummaryCallout summary={castlePeakRoadHub.answerSummary} />
        </div>
      </PageHero>

      <CorridorSchematic />
      <MainEstatesSection publishedSlugs={publishedEstateSlugs} />

      <Container className="py-12">
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
      </Container>

      <AreaComparisonSection />
      <PriceSnapshotSection priceSnapshots={priceSnapshots} />
      <DecisionGuideSection />

      {faqs.length > 0 && (
        <section className="border-y bg-card">
          <Container className="py-12">
            <div className="max-w-3xl">
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
          </Container>
        </section>
      )}
    </div>
  );
}
