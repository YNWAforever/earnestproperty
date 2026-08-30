import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { AlertCircle, ArrowRight, CheckCircle2 } from "lucide-react";
import { AppImage } from "@/components/media/AppImage";
import { DataNote } from "@/components/layout/DataNote";
import { EstateMarketSnapshot } from "@/components/site/EstateMarketSnapshot";
import { IntentWhatsAppCTA } from "@/components/site/IntentWhatsAppCTA";
import { OwnerValuationPanel } from "@/components/site/OwnerValuationPanel";
import { SearchFallbackCTA } from "@/components/site/SearchFallbackCTA";
import { TrustProofPanel } from "@/components/site/TrustProofPanel";
import { whatsappIntentUrl } from "@/config/site";
import { findCastlePeakRoadSegmentByDistrictSlug } from "@/content/castle-peak-road";
import { getEstatePageContent } from "@/content/estate-pages";
import { shamTsengSchoolNet } from "@/content/school-nets";
import { SITE_URL, canonicalLink, estateSeo } from "@/content/seo";
import { formatHkDate } from "@/lib/format";
import {
  fetchEstateBySlug,
  fetchEstateTransactions,
  fetchFaqs,
  fetchListingsForEstate,
  type EstateTransaction,
  type FaqItem,
  type ListingRow,
} from "@/lib/queries";
import { renderableFaqs } from "@/lib/faq";
import { jsonLdScript } from "@/lib/schema";

type EstateDetail = NonNullable<Awaited<ReturnType<typeof fetchEstateBySlug>>>;

export const Route = createFileRoute("/estate/$slug")({
  loader: async ({ params }) => {
    const estate = await fetchEstateBySlug(params.slug);
    if (!estate) throw notFound();
    const [faqs, latestListings, transactions] = await Promise.all([
      fetchFaqs(`estate:${params.slug}`),
      fetchListingsForEstate(params.slug, 6),
      fetchEstateTransactions(estate.id, 8),
    ]);
    return { estate, faqs, latestListings, transactions };
  },
  head: ({ loaderData }) => {
    const slug = loaderData?.estate.slug as keyof typeof estateSeo | undefined;
    const seo = slug ? estateSeo[slug] : undefined;
    return {
      meta: [
        {
          title:
            loaderData?.estate.seo_title ??
            seo?.title ??
            `${loaderData?.estate.name_zh ?? "屋苑"}｜晉誠地產屋苑專頁`,
        },
        {
          name: "description",
          content:
            loaderData?.estate.seo_description ??
            seo?.description ??
            `${loaderData?.estate.name_zh ?? ""} ${loaderData?.estate.total_units ?? ""} 個單位，平均實呎 $${loaderData?.estate.avg_saleable_psf ?? ""}。即時放盤、成交、FAQ。`,
        },
      ],
      links: loaderData?.estate.slug ? [canonicalLink(`/estate/${loaderData.estate.slug}`)] : [],
    };
  },
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-2xl font-bold">載入失敗</h1>
      <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      <Link to="/" className="mt-4 inline-block text-primary underline">
        回首頁
      </Link>
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-2xl font-bold">屋苑未找到</h1>
      <Link to="/" className="mt-4 inline-block text-primary underline">
        回首頁
      </Link>
    </div>
  ),
  component: EstatePage,
});

function EstatePage() {
  const { estate, faqs, latestListings, transactions } = Route.useLoaderData() as {
    estate: EstateDetail;
    faqs: FaqItem[];
    latestListings: ListingRow[];
    transactions: EstateTransaction[];
  };
  const seo = estateSeo[estate.slug as keyof typeof estateSeo];
  const content = getEstatePageContent(estate.slug);
  type VisibleFaq = { question: string; answer: string };
  const visibleFaqs: VisibleFaq[] = renderableFaqs([
    ...(content?.faqs ?? []),
    ...faqs.filter((faq) => !(content?.faqs ?? []).some((item) => item.question === faq.question)),
  ]);
  const ctaContext = {
    estateName: seo?.nameZh ?? estate.name_zh,
    districtName: "深井 / 青山公路",
    source: `estate-${estate.slug}`,
  };
  const estateFacts = [
    seo?.nameEn ?? estate.name_en ?? "",
    estate.developer ?? "",
    estate.year_completed ? `${estate.year_completed} 年落成` : "",
    estate.total_units ? `共 ${estate.total_units.toLocaleString()} 個單位` : "單位數待查",
  ].filter(Boolean);
  // Task 4 (P4 plan): transport + school-net sections reuse already-curated
  // content instead of inventing new facts. transportSegment is null (not a
  // placeholder) when the estate's district isn't part of a known corridor
  // segment -- true today of the 3 unknown-district estates from Task 2, none
  // of which have a page yet, but this must still degrade cleanly rather than
  // crash if that ever changes. showSchoolNet is only true for the one
  // district with real, sourced school-net data (school-nets.ts) -- see that
  // file's own comment for why other districts intentionally render nothing
  // here rather than invented figures.
  const transportSegment = findCastlePeakRoadSegmentByDistrictSlug(
    estate.district_slug,
  );
  const showSchoolNet = estate.district_slug === "sham-tseng";
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "首頁", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "屋苑", item: `${SITE_URL}/district/sham-tseng` },
      {
        "@type": "ListItem",
        position: 3,
        name: seo?.nameZh ?? estate.name_zh,
        item: `${SITE_URL}/estate/${estate.slug}`,
      },
    ],
  };
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: visibleFaqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };
  return (
    <div className="bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd) }}
      />
      {visibleFaqs.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(faqJsonLd) }}
        />
      )}
      <section className="bg-gradient-to-br from-primary to-primary/70 py-16 text-primary-foreground">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <p className="text-sm opacity-80">深井屋苑獨立 SEO 頁</p>
          <h1 className="mt-2 text-4xl font-bold sm:text-5xl">{seo?.nameZh ?? estate.name_zh}</h1>
          <p className="mt-5 max-w-3xl text-base leading-relaxed opacity-90">
            {content?.heroPositioning ?? seo?.fit ?? "即時查看放盤、成交和屋苑資料。"}
          </p>
          <div className="mt-6 max-w-3xl">
            <IntentWhatsAppCTA context={ctaContext} />
          </div>
        </div>
      </section>

      {/* Verified-facts block: the plain "· "-joined summary this used to be
          carried no source or as-of date. estate.verified_at (P4 Task 2's
          column) is null for every estate today, including the 5 with real
          detail pages -- the DataNote shows an honest caveat rather than a
          fabricated verification date in that case. The facts themselves are
          still real DB data and still render either way. */}
      {estateFacts.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
          <DataNote
            source="本行屋苑資料庫"
            asOf={
              estate.verified_at
                ? (formatHkDate(estate.verified_at) ?? undefined)
                : undefined
            }
            caveat={
              estate.verified_at
                ? undefined
                : "以上資料尚待人手覆核並標註核實日期，如有出入以最新單位資料為準。"
            }
          >
            {estateFacts.join(" · ")}
          </DataNote>
        </section>
      )}

      <EstateMarketSnapshot
        avgPsf={Number(estate.avg_saleable_psf ?? 0) || null}
        totalUnits={estate.total_units ?? null}
        phases={estate.phases ?? null}
        year={estate.year_completed ?? null}
        listings={latestListings}
        transactions={transactions}
      />

      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="text-sm font-semibold text-coral">屋苑介紹</p>
            <h2 className="mt-2 text-2xl font-bold text-primary">
              {seo?.nameZh ?? estate.name_zh} 值得點睇？
            </h2>
            <div className="mt-4 space-y-4 text-base leading-relaxed text-muted-foreground">
              {(content?.overview ?? [seo?.intro ?? estate.description ?? ""])
                .filter(Boolean)
                .map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              {content?.transportLifestyle && <p>{content.transportLifestyle}</p>}
            </div>
          </div>
          <div className="rounded-lg border bg-card p-5">
            <h3 className="text-lg font-bold text-primary">適合邊類買家 / 租客？</h3>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              {(content?.buyerFit ?? [seo?.fit ?? "適合想比較深井核心屋苑的買家。"]).map((item) => (
                <li key={item} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {content && (
          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            <div className="rounded-lg border bg-card p-5">
              <h3 className="text-lg font-bold text-primary">優點</h3>
              <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                {content.pros.map((item) => (
                  <li key={item} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border bg-card p-5">
              <h3 className="text-lg font-bold text-primary">要留意</h3>
              <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                {content.watchouts.map((item) => (
                  <li key={item} className="flex gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-coral" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>

      {/* Transport + school-net: both reuse already-curated content (the
          corridor segment's own transport copy, school-nets.ts) rather than
          inventing new facts for this estate specifically. Either half is
          omitted entirely (not shown as an empty placeholder) when there is
          nothing real to show -- transportSegment is null outside a known
          corridor segment, showSchoolNet is only true in sham-tseng. */}
      {(transportSegment || showSchoolNet) && (
        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div
            className={
              transportSegment && showSchoolNet
                ? "grid gap-5 lg:grid-cols-2"
                : "grid gap-5"
            }
          >
            {transportSegment && (
              <div className="rounded-lg border bg-card p-5">
                <h3 className="text-lg font-bold text-primary">附近交通</h3>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  {transportSegment.transport}
                </p>
                <Link
                  to="/castle-peak-road/$segment"
                  params={{ segment: transportSegment.slug }}
                  className="mt-4 inline-block text-sm font-semibold text-primary underline"
                >
                  查看{transportSegment.nameZh}交通及生活資訊 →
                </Link>
              </div>
            )}
            {showSchoolNet && (
              <div className="rounded-lg border bg-card p-5">
                <h3 className="text-lg font-bold text-primary">
                  校網 {shamTsengSchoolNet.netCode}（小學）
                </h3>
                <p className="mt-4 text-sm text-muted-foreground">
                  {seo?.nameZh ?? estate.name_zh}屬
                  {shamTsengSchoolNet.districtLabel}{" "}
                  {shamTsengSchoolNet.netCode} 校網。
                </p>
                {shamTsengSchoolNet.primarySchools.length > 0 && (
                  <ul className="mt-3 space-y-2 text-sm">
                    {shamTsengSchoolNet.primarySchools.map((s) => (
                      <li
                        key={s.name}
                        className="flex items-center justify-between rounded-md border px-3 py-2"
                      >
                        <span>{s.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {s.type}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <DataNote
                  className="mt-4"
                  source={shamTsengSchoolNet.source}
                  sourceUrl={shamTsengSchoolNet.sourceUrl ?? undefined}
                  asOf={shamTsengSchoolNet.verifiedOn ?? undefined}
                  caveat="實際派位及校網資料以教育局最新公布為準，並因應個別地址及入學年度而有所不同。"
                >
                  中學屬{shamTsengSchoolNet.districtLabel}中學校網。
                </DataNote>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-primary">最新放盤</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              已接入舊站公開 MLS 匯入流程，盤源會以最新抓取時間排序。
            </p>
          </div>
          <Link
            to="/listings"
            search={{ deal: "all", estate: estate.slug, page: 1 }}
            className="text-sm font-semibold text-primary"
          >
            查看全部
          </Link>
        </div>
        {latestListings.length === 0 ? (
          <div className="mt-5">
            <SearchFallbackCTA
              context={{
                ...ctaContext,
                searchSummary: `${seo?.nameZh ?? estate.name_zh} 暫未有公開匹配放盤`,
                source: `estate-${estate.slug}-empty-listings`,
              }}
            />
          </div>
        ) : (
          <>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {latestListings.map((listing) => (
                <EstateListingCard key={listing.id} listing={listing} />
              ))}
            </div>
            <div className="mt-6">
              <SearchFallbackCTA
                compact
                context={{
                  ...ctaContext,
                  searchSummary: `${seo?.nameZh ?? estate.name_zh} 最新放盤後備配盤`,
                  source: `estate-${estate.slug}-listing-backup`,
                }}
              />
            </div>
          </>
        )}
      </section>

      {content && (
        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="rounded-lg border bg-card p-5">
            <h2 className="text-xl font-bold text-primary">下一步</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <a
                href={whatsappIntentUrl("buy", ctaContext)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-28 flex-col justify-between rounded-md border bg-background p-4 text-sm transition hover:border-primary hover:shadow-card"
              >
                <span className="font-semibold text-primary">{content.saleCta}</span>
                <ArrowRight className="mt-3 h-4 w-4 text-coral" />
              </a>
              <a
                href={whatsappIntentUrl("rent", ctaContext)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-28 flex-col justify-between rounded-md border bg-background p-4 text-sm transition hover:border-primary hover:shadow-card"
              >
                <span className="font-semibold text-primary">{content.rentCta}</span>
                <ArrowRight className="mt-3 h-4 w-4 text-coral" />
              </a>
              <a
                href={whatsappIntentUrl("valuation", ctaContext)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-28 flex-col justify-between rounded-md border bg-background p-4 text-sm transition hover:border-primary hover:shadow-card"
              >
                <span className="font-semibold text-primary">{content.valuationCta}</span>
                <ArrowRight className="mt-3 h-4 w-4 text-coral" />
              </a>
            </div>
          </div>
        </section>
      )}

      <OwnerValuationPanel context={ctaContext} />
      <TrustProofPanel />

      {visibleFaqs.length > 0 && (
        <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-primary">常見問題</h2>
          <Accordion type="single" collapsible className="mt-6">
            {visibleFaqs.map((f: VisibleFaq, i: number) => (
              <AccordionItem key={i} value={`faq-${i}`}>
                <AccordionTrigger className="text-left text-base font-medium">
                  {f.question}
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                  {f.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      )}
    </div>
  );
}

function EstateListingCard({ listing }: { listing: ListingRow }) {
  const isRent = listing.deal_type === "rent";
  const price = isRent
    ? listing.rent
      ? `HK$${listing.rent.toLocaleString()}/月`
      : "查詢租金"
    : listing.price
      ? `HK$${(listing.price / 1_000_000).toFixed(2)}M`
      : "查詢售價";
  return (
    <Link
      to="/property/$listingNo"
      params={{ listingNo: listing.listing_no }}
      className="overflow-hidden rounded-lg border bg-card transition hover:shadow-card"
    >
      <div className="aspect-[4/3] bg-muted">
        <AppImage
          src={listing.images?.[0]}
          alt={listing.title_zh}
          width={400}
          height={300}
          className="h-full w-full object-cover"
        />
      </div>
      <div className="p-4">
        <p className="text-lg font-bold text-primary">{price}</p>
        <h3 className="mt-1 line-clamp-1 text-sm font-semibold">{listing.title_zh}</h3>
        <p className="mt-2 text-xs text-muted-foreground">
          {listing.saleable_area ? `${listing.saleable_area} 呎 · ` : ""}
          {listing.bedrooms ?? "-"} 房
        </p>
      </div>
    </Link>
  );
}
