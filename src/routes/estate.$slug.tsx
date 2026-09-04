import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { AlertCircle, ArrowRight, CheckCircle2 } from "lucide-react";
import { AppImage } from "@/components/media/AppImage";
import { Container } from "@/components/layout/Container";
import { DataNote } from "@/components/layout/DataNote";
import { AnswerSummaryCallout } from "@/components/site/AnswerSummaryCallout";
import { Breadcrumbs, type BreadcrumbItem } from "@/components/site/Breadcrumbs";
import {
  EstateComparisonTable,
  type EstateComparisonRow,
} from "@/components/site/EstateComparisonTable";
import { EstateMarketSnapshot } from "@/components/site/EstateMarketSnapshot";
import { IntentWhatsAppCTA } from "@/components/site/IntentWhatsAppCTA";
import { OwnerValuationPanel } from "@/components/site/OwnerValuationPanel";
import { PageHero } from "@/components/site/PageHero";
import { SearchFallbackCTA } from "@/components/site/SearchFallbackCTA";
import { TrustProofPanel } from "@/components/site/TrustProofPanel";
import { whatsappIntentUrl } from "@/config/site";
import { findCastlePeakRoadSegmentByDistrictSlug } from "@/content/castle-peak-road";
import { estateRegistry, findComparableEstates } from "@/content/estate-registry";
import { buildEstateAnswerSummary, getEstatePageContent } from "@/content/estate-pages";
import { getSchoolNet } from "@/content/school-nets";
import { SITE_URL, canonicalLink, estateSeo } from "@/content/seo";
import { blogArticles, type BlogArticleMeta } from "@/content/blog-articles";
import { formatHkDate } from "@/lib/format";
import {
  fetchCmsVideos,
  fetchEstateBySlug,
  fetchEstateTransactions,
  fetchFaqs,
  fetchListingsForEstate,
  type CmsVideo,
  type EstateTransaction,
  type FaqItem,
  type ListingRow,
} from "@/lib/queries";
import { fetchNeonPublicAgentProfiles } from "@/lib/neon/public-data";
import type { NeonPublicAgentProfile } from "@/lib/neon/public-data.types";
import { deriveEstateTag } from "@/lib/video-tags.js";
import { renderableFaqs } from "@/lib/faq";
import { jsonLdScript } from "@/lib/schema";
import { buildContext, useTrackPageView } from "@/lib/analytics/events";

type EstateDetail = NonNullable<Awaited<ReturnType<typeof fetchEstateBySlug>>>;

/** Maps a registry entry's districtSlug to its school net code, mirroring
 * the data pack's `areaMeta[districtSlug].schoolNetCode`. sham-tseng and
 * tsing-lung-tau both carry net 62; castle-peak-road (the 掃管笏/青山灣/小欖
 * group) carries net 71. Any districtSlug not listed here has no known
 * school net -- getSchoolNet(undefined) returns null, which the render site
 * below already treats as "omit the section", not an error. */
const SCHOOL_NET_BY_DISTRICT: Record<string, string> = {
  "sham-tseng": "62",
  "tsing-lung-tau": "62",
  "castle-peak-road": "71",
};

export const Route = createFileRoute("/estate/$slug")({
  loader: async ({ params }) => {
    const estate = await fetchEstateBySlug(params.slug);
    if (!estate) throw notFound();
    // Task 5 (P4 plan): up to 2 registry entries sharing this estate's real
    // districtSlug/corridorSegment -- registry-only, deterministic, and safe
    // to compute even for the 3 unknown-district estates (returns []
    // instead of crashing; see findComparableEstates's own doc comment).
    const comparableEntries = findComparableEstates(estate.slug, 2);
    const [faqs, latestListings, transactions, comparableRecords, agentProfiles, cmsVideos] =
      await Promise.all([
        fetchFaqs(`estate:${params.slug}`),
        fetchListingsForEstate(params.slug, 6),
        fetchEstateTransactions(estate.id, 8),
        Promise.all(comparableEntries.map((entry) => fetchEstateBySlug(entry.slug))),
        // Non-essential entity-linking fetches: a Neon blip here shouldn't
        // fail the whole estate page, it just means that section renders
        // nothing (matches fetchNeonBranches' own catch(() => []) pattern
        // elsewhere in this route tree).
        (fetchNeonPublicAgentProfiles() as Promise<NeonPublicAgentProfile[]>).catch(() => []),
        (fetchCmsVideos() as Promise<CmsVideo[]>).catch(() => []),
      ]);
    // Reverse lookups over already-fetched data -- no new SQL. served_estate_slugs
    // already exists on every public agent profile (agents_.$slug.tsx reads
    // the forward direction); deriveEstateTag parses the same "＃屋苑名" video
    // title marker videos.tsx already filters on, matched against this
    // estate's real Chinese name; compareEstateSlugs is the static field
    // blog-articles.ts already carries per article.
    const relatedAgents = agentProfiles.filter((agent) =>
      agent.served_estate_slugs.includes(estate.slug),
    );
    const relatedVideos = cmsVideos.filter(
      (video) => deriveEstateTag(video.title)?.tag === estate.name_zh,
    );
    const relatedArticles = blogArticles.filter((article) =>
      article.compareEstateSlugs?.includes(estate.slug),
    );
    // A comparable's real facts (avg PSF / units / year / developer) live in
    // the DB, not the registry -- combine each entry with its fetched record
    // here so the route/component only ever deal with one flat shape. A
    // `null` record (e.g. an unpublished or fact-less comparable) still
    // keeps its registry name and simply renders every fact as "—" via
    // EstateComparisonTable's estateFigure-based formatting -- it is not
    // dropped from the "up to 2" slots or backfilled with a third candidate.
    const comparableEstates: EstateComparisonRow[] = comparableEntries.map((entry, index) => {
      const record = comparableRecords[index];
      return {
        slug: entry.slug,
        nameZh: entry.nameZh,
        hasPage: entry.hasPage,
        avgPsf: record ? Number(record.avg_saleable_psf ?? 0) || null : null,
        totalUnits: record?.total_units ?? null,
        yearCompleted: record?.year_completed ?? null,
        developer: record?.developer ?? null,
        asOf: record?.verified_at ?? null,
      };
    });
    return {
      estate,
      faqs,
      latestListings,
      transactions,
      comparableEstates,
      relatedAgents,
      relatedVideos,
      relatedArticles,
    };
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
  const {
    estate,
    faqs,
    latestListings,
    transactions,
    comparableEstates,
    relatedAgents,
    relatedVideos,
    relatedArticles,
  } = Route.useLoaderData() as {
    estate: EstateDetail;
    faqs: FaqItem[];
    latestListings: ListingRow[];
    transactions: EstateTransaction[];
    comparableEstates: EstateComparisonRow[];
    relatedAgents: NeonPublicAgentProfile[];
    relatedVideos: CmsVideo[];
    relatedArticles: BlogArticleMeta[];
  };
  const seo = estateSeo[estate.slug as keyof typeof estateSeo];
  const content = getEstatePageContent(estate.slug);
  // Not getEstateEntry(): that throws on a miss by design (registry drift is
  // a bug for the 22 known estates it covers), but this route also serves
  // any estate the admin CMS creates, which can carry a slug not yet present
  // in the static registry file at all -- a genuinely expected case, not
  // drift. Falls back to null and every read below degrades gracefully
  // rather than crashing the whole page for a brand-new estate.
  const registryEntry = estateRegistry.find((entry) => entry.slug === estate.slug) ?? null;
  useTrackPageView(
    () => ({
      event: {
        name: "estate_view",
        payload: { estateSlug: estate.slug, districtSlug: estate.district_slug ?? undefined },
      },
      context: buildContext({
        estateSlug: estate.slug,
        districtSlug: estate.district_slug ?? undefined,
      }),
    }),
    [estate.slug],
  );
  // Task 5 (P4 plan): the current estate's own comparison-table column.
  // avgPsf mirrors the exact conversion EstateMarketSnapshot already gets
  // below (`Number(x ?? 0) || null`), so a non-numeric/zero DB value can't
  // silently read as a real $0 psf.
  const currentComparisonRow: EstateComparisonRow = {
    slug: estate.slug,
    nameZh: seo?.nameZh ?? estate.name_zh,
    hasPage: true,
    avgPsf: Number(estate.avg_saleable_psf ?? 0) || null,
    totalUnits: estate.total_units ?? null,
    yearCompleted: estate.year_completed ?? null,
    developer: estate.developer ?? null,
    asOf: estate.verified_at ?? null,
  };
  const answerSummary = content
    ? buildEstateAnswerSummary(content, currentComparisonRow.avgPsf, comparableEstates)
    : null;
  type VisibleFaq = { question: string; answer: string };
  const visibleFaqs: VisibleFaq[] = renderableFaqs([
    ...(content?.faqs ?? []),
    ...faqs.filter((faq) => !(content?.faqs ?? []).some((item) => item.question === faq.question)),
  ]);
  const ctaContext = {
    estateName: seo?.nameZh ?? estate.name_zh,
    districtName: registryEntry?.locationLabelZh ?? "深井 / 青山公路",
    source: `estate-${estate.slug}`,
  };
  const estateFacts = [
    seo?.nameEn ?? estate.name_en ?? "",
    estate.developer ?? "",
    estate.year_completed ? `${estate.year_completed} 年落成` : "",
    estate.total_units ? `共 ${estate.total_units.toLocaleString()} 個單位` : "",
  ].filter(Boolean);
  // Task 4 (P4 plan) / Task 5 (P4 plan): transport + school-net sections
  // reuse already-curated content instead of inventing new facts.
  // transportSegment is null (not a placeholder) when the estate's district
  // isn't part of a known corridor segment -- true today of the 3
  // unknown-district estates from Task 2, none of which have a page yet, but
  // this must still degrade cleanly rather than crash if that ever changes.
  // schoolNet is resolved per-estate via the registry entry's districtSlug ->
  // SCHOOL_NET_BY_DISTRICT -> getSchoolNet(code), instead of being hardcoded
  // to a single district -- it's null (section omitted) for any district
  // without real, sourced school-net data (school-nets.ts) -- see that
  // file's own comment for why other districts intentionally render nothing
  // here rather than invented figures.
  const transportSegment = findCastlePeakRoadSegmentByDistrictSlug(estate.district_slug);
  const schoolNet = getSchoolNet(
    registryEntry?.districtSlug ? SCHOOL_NET_BY_DISTRICT[registryEntry.districtSlug] : null,
  );
  const estateName = seo?.nameZh ?? estate.name_zh;
  // The visible trail and the BreadcrumbList JSON-LD are built from the same
  // crumbs so they can never disagree. The middle crumb is the estate's own
  // district guide -- the 深井 district page for a sham-tseng estate, the
  // corridor hub for any other corridor estate -- and is omitted (not
  // defaulted to a possibly-wrong district) when the registry knows neither.
  const districtCrumb =
    registryEntry?.districtSlug === "sham-tseng"
      ? { label: "深井區買樓租樓", href: "/district/sham-tseng" }
      : registryEntry?.corridorSegment
        ? { label: "青山公路區買樓租樓", href: "/castle-peak-road" }
        : null;
  const breadcrumbItems: BreadcrumbItem[] = [
    { label: "首頁", href: "/" },
    ...(districtCrumb ? [districtCrumb] : []),
    { label: estateName },
  ];
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "首頁", item: SITE_URL },
      ...(districtCrumb
        ? [
            {
              "@type": "ListItem",
              position: 2,
              name: districtCrumb.label,
              item: `${SITE_URL}${districtCrumb.href}`,
            },
          ]
        : []),
      {
        "@type": "ListItem",
        position: districtCrumb ? 3 : 2,
        name: estateName,
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
      {/* registryEntry.heroEyebrow is non-null for every registry entry
          (see estate-registry.ts) -- the fallback below only fires for
          an estate the admin CMS created that has no registry entry yet,
          where we genuinely don't know the district, so it stays
          generic rather than defaulting to a specific (possibly wrong)
          claim. */}
      <PageHero
        tone="brand"
        breadcrumb={<Breadcrumbs tone="inverse" items={breadcrumbItems} />}
        eyebrow={registryEntry?.heroEyebrow ?? "屋苑獨立 SEO 頁"}
        title={estateName}
        lead={content?.heroPositioning ?? seo?.fit ?? "即時查看放盤、成交和屋苑資料。"}
      >
        <div className="mt-6 max-w-3xl">
          <IntentWhatsAppCTA context={ctaContext} />
        </div>
      </PageHero>

      {answerSummary ? (
        <Container className="pt-6">
          <AnswerSummaryCallout summary={answerSummary} />
        </Container>
      ) : null}

      {/* Verified-facts block: the plain "· "-joined summary this used to be
          carried no source or as-of date. estate.verified_at (P4 Task 2's
          column) is null for every estate today, including the 5 with real
          detail pages -- the DataNote shows an honest caveat rather than a
          fabricated verification date in that case. The facts themselves are
          still real DB data and still render either way. */}
      {estateFacts.length > 0 && (
        <Container className="pt-6">
          <DataNote
            source="本行屋苑資料庫"
            asOf={estate.verified_at ? (formatHkDate(estate.verified_at) ?? undefined) : undefined}
            caveat={
              estate.verified_at
                ? undefined
                : "以上資料尚待人手覆核並標註核實日期，如有出入以最新單位資料為準。"
            }
          >
            {estateFacts.join(" · ")}
          </DataNote>
        </Container>
      )}

      <EstateMarketSnapshot
        avgPsf={Number(estate.avg_saleable_psf ?? 0) || null}
        totalUnits={estate.total_units ?? null}
        phases={estate.phases ?? null}
        year={estate.year_completed ?? null}
        listings={latestListings}
        transactions={transactions}
      />

      <Container className="py-8">
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
      </Container>

      {/* Transport + school-net: both reuse already-curated content (the
          corridor segment's own transport copy, school-nets.ts) rather than
          inventing new facts for this estate specifically. Either half is
          omitted entirely (not shown as an empty placeholder) when there is
          nothing real to show -- transportSegment is null outside a known
          corridor segment, schoolNet is null outside a district with real,
          sourced school-net data. */}
      {(transportSegment || schoolNet) && (
        <Container className="py-8">
          <div
            className={transportSegment && schoolNet ? "grid gap-5 lg:grid-cols-2" : "grid gap-5"}
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
            {schoolNet && (
              <div className="rounded-lg border bg-card p-5">
                <h3 className="text-lg font-bold text-primary">校網 {schoolNet.netCode}（小學）</h3>
                <p className="mt-4 text-sm text-muted-foreground">
                  {seo?.nameZh ?? estate.name_zh}屬{schoolNet.districtLabel} {schoolNet.netCode}{" "}
                  校網。
                </p>
                {schoolNet.primarySchools.length > 0 && (
                  <ul className="mt-3 space-y-2 text-sm">
                    {schoolNet.primarySchools.map((s) => (
                      <li
                        key={s.name}
                        className="flex items-center justify-between rounded-md border px-3 py-2"
                      >
                        <span>{s.name}</span>
                        <span className="text-xs text-muted-foreground">{s.type}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <DataNote
                  className="mt-4"
                  source={schoolNet.source}
                  sourceUrl={schoolNet.sourceUrl ?? undefined}
                  asOf={schoolNet.verifiedOn ?? undefined}
                  caveat="實際派位及校網資料以教育局最新公布為準，並因應個別地址及入學年度而有所不同。"
                >
                  中學屬{schoolNet.districtLabel}中學校網。
                </DataNote>
              </div>
            )}
          </div>
        </Container>
      )}

      {/* Task 5 (P4 plan): nearby-estate comparison. EstateComparisonTable
          itself renders nothing when comparableEstates is empty -- placed
          after the transport/school-net context and before the listings
          grid, so a reader who's just learned where this estate sits sees
          how it stacks up against its neighbours before moving on to actual
          inventory. */}
      <EstateComparisonTable current={currentComparisonRow} comparables={comparableEstates} />

      {/* P7e: entity links to agent/video/article -- all three are reverse
          lookups over data the app already fetches elsewhere (agents'
          served_estate_slugs, videos' "＃屋苑名" title marker, articles'
          compareEstateSlugs), not new SQL. Renders nothing for a
          sub-section with zero matches rather than an empty placeholder. */}
      {relatedAgents.length > 0 || relatedVideos.length > 0 || relatedArticles.length > 0 ? (
        <Container className="py-8">
          <h2 className="text-xl font-bold text-primary">相關資源</h2>
          <div className="mt-4 grid gap-6 sm:grid-cols-3">
            {relatedAgents.length > 0 ? (
              <div>
                <p className="text-sm font-semibold text-foreground">熟悉呢個屋苑嘅代理</p>
                <ul className="mt-2 space-y-1.5">
                  {relatedAgents.map((agent) => (
                    <li key={agent.id}>
                      <Link
                        to="/agents/$slug"
                        params={{ slug: agent.public_slug ?? agent.id }}
                        className="text-sm text-primary underline underline-offset-2"
                      >
                        {agent.name_zh ?? agent.name_en ?? "晉誠地產代理"}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {relatedVideos.length > 0 ? (
              <div>
                <p className="text-sm font-semibold text-foreground">相關影片</p>
                <ul className="mt-2 space-y-1.5">
                  {relatedVideos.map((video) => (
                    <li key={video.id}>
                      <Link
                        to="/videos"
                        search={{ estate: estate.name_zh }}
                        className="text-sm text-primary underline underline-offset-2"
                      >
                        {video.title || "晉誠地產 YouTube影片"}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {relatedArticles.length > 0 ? (
              <div>
                <p className="text-sm font-semibold text-foreground">相關文章</p>
                <ul className="mt-2 space-y-1.5">
                  {relatedArticles.map((article) => (
                    <li key={article.slug}>
                      <Link
                        to="/blog/$slug"
                        params={{ slug: article.slug }}
                        className="text-sm text-primary underline underline-offset-2"
                      >
                        {article.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Container>
      ) : null}

      <Container className="py-8">
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
      </Container>

      {content && (
        <Container className="py-8">
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
        </Container>
      )}

      <OwnerValuationPanel context={ctaContext} estateId={estate.id} />
      <TrustProofPanel />

      {visibleFaqs.length > 0 && (
        <Container className="py-8">
          <div className="max-w-3xl">
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
          </div>
        </Container>
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
