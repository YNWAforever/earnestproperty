import type { ReactNode } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { ArrowRight, Building2, MapPinned, School, TrainFront } from "lucide-react";

import { Container } from "@/components/layout/Container";
import { AnswerSummaryCallout } from "@/components/site/AnswerSummaryCallout";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { CorridorInventory } from "@/components/site/CorridorInventory";
import { PageHero } from "@/components/site/PageHero";
import { SiteLink } from "@/components/site/SiteLink";
import { Button } from "@/components/ui/button";
import {
  castlePeakRoadHub,
  getCastlePeakRoadSegment,
  type CorridorSegment,
} from "@/content/castle-peak-road";
import { seo, SITE_URL } from "@/content/seo";
import { whatsappUrl } from "@/config/site";
import {
  emptyCorridorInventory,
  fetchCorridorInventoryForAliases,
  type CorridorInventory as CorridorInventoryData,
} from "@/lib/queries";
import { renderableFaqs } from "@/lib/faq";
import { sanitizeListingText } from "@/lib/format";
import { jsonLdScript } from "@/lib/schema";

type SegmentLoaderData = {
  segment: CorridorSegment;
  inventory: CorridorInventoryData;
  nearbyInventory: CorridorInventoryData;
};

export const Route = createFileRoute("/castle-peak-road/$segment")({
  loader: async ({ params }): Promise<SegmentLoaderData> => {
    const segment = getCastlePeakRoadSegment(params.segment);
    if (!segment) throw notFound();

    const [inventory, nearbyInventory] = await Promise.all([
      fetchCorridorInventoryForAliases({
        districtSlugs: segment.districtSlugs,
        estateSlugs: segment.estateSlugs,
        textAliases: segment.textAliases,
        limit: 6,
      }),
      // The nearby block is bonus content, already guarded by a `length > 0`
      // check where it renders -- isolate its failure so a problem fetching
      // "附近選擇" doesn't take down the primary strict inventory, breadcrumbs,
      // intro and FAQs with it. Same pattern as fetchCmsVideos().catch(() => [])
      // in src/routes/index.tsx.
      fetchCorridorInventoryForAliases({
        districtSlugs: segment.nearbyDistrictSlugs,
        estateSlugs: segment.nearbyEstateSlugs,
        textAliases: segment.nearbyTextAliases,
        limit: 6,
      }).catch(() => emptyCorridorInventory()),
    ]);

    return { segment, inventory, nearbyInventory };
  },
  head: ({ loaderData }) =>
    seo({
      title: loaderData?.segment.title ?? castlePeakRoadHub.title,
      description: loaderData?.segment.description ?? castlePeakRoadHub.description,
      path: loaderData?.segment.path ?? castlePeakRoadHub.path,
    }),
  errorComponent: CastlePeakRoadSegmentError,
  component: CastlePeakRoadSegmentPage,
});

const supportedListingDistrictSlugs = new Set([
  "sham-tseng",
  "ting-kau",
  "tsuen-wan",
  "castle-peak-road",
]);

function getSegmentListingsHref(segment: CorridorSegment) {
  const districtSlug = segment.districtSlugs.find(
    (slug) => slug !== "castle-peak-road" && supportedListingDistrictSlugs.has(slug),
  );
  if (districtSlug) return `/listings?deal=all&district=${districtSlug}&page=1`;

  const estateSlug = segment.estateSlugs[0];
  if (estateSlug) return `/listings?deal=all&estate=${estateSlug}&page=1`;

  return "/listings?deal=all&district=castle-peak-road&page=1";
}

function CastlePeakRoadSegmentError({ error }: { error: Error }) {
  const router = useRouter();

  return (
    <div className="bg-background px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl rounded-lg border bg-card p-6 text-center shadow-card">
        <p className="text-sm font-semibold text-coral">青山公路 Castle Peak Road</p>
        <h1 className="mt-2 text-2xl font-bold text-primary">載入青山公路分段時遇到問題</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          這個分段的即時放盤或內容暫時未能載入。可先返回青山公路總覽，或重新整理資料再試一次。
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

function InfoCard({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <article className="rounded-lg border bg-card p-5 shadow-card">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
        {icon}
      </div>
      <h2 className="mt-4 text-lg font-semibold text-primary">{title}</h2>
      <p className="mt-2 text-sm leading-7 text-muted-foreground">{text}</p>
    </article>
  );
}

function CastlePeakRoadSegmentPage() {
  const { segment, inventory, nearbyInventory } = Route.useLoaderData() as SegmentLoaderData;
  const allListings = [...inventory.saleRows, ...inventory.rentRows];
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
      {
        "@type": "ListItem",
        position: 3,
        name: segment.nameZh,
        item: `${SITE_URL}${segment.path}`,
      },
    ],
  };
  const faqs = renderableFaqs(segment.faqs);
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: allListings.map((listing, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `${SITE_URL}/property/${listing.listing_no}`,
      name: sanitizeListingText(listing.title_zh) ?? listing.title_zh,
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
      {allListings.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(itemListJsonLd) }}
        />
      )}

      <PageHero
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: "首頁", href: "/" },
              { label: "青山公路區買樓租樓", href: "/castle-peak-road" },
              { label: segment.nameZh },
            ]}
          />
        }
        eyebrow={segment.eyebrow}
        title={segment.h1}
        lead={segment.description}
        actions={
          <>
            <Button asChild className="bg-coral text-coral-foreground hover:bg-primary-hover">
              <a
                href={whatsappUrl(`你好，我想查詢${segment.nameZh}樓盤`)}
                target="_blank"
                rel="noopener noreferrer"
              >
                WhatsApp 查詢
              </a>
            </Button>
            <Button asChild variant="outline">
              <Link to="/castle-peak-road">
                返回青山公路總覽
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </>
        }
      />

      <Container className="pt-6">
        <AnswerSummaryCallout summary={segment.answerSummary} />
      </Container>

      <Container className="py-12">
        <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <article className="space-y-4 text-base leading-8 text-muted-foreground">
            {segment.intro.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </article>
          <div className="rounded-lg border bg-card p-5 shadow-card">
            <h2 className="text-lg font-semibold text-primary">常見屋苑 / 搜尋詞</h2>
            <ul className="mt-4 grid gap-2 text-sm">
              {segment.featuredEstates.map((estate) => (
                <li key={estate} className="rounded-md border bg-background px-3 py-2">
                  {estate}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Container>

      <Container className="grid gap-5 pb-12 md:grid-cols-2 lg:grid-cols-4">
        <InfoCard
          icon={<Building2 className="h-5 w-5" />}
          title="住宅類型"
          text={segment.housingProfile}
        />
        <InfoCard
          icon={<MapPinned className="h-5 w-5" />}
          title="適合買家"
          text={segment.buyerFit}
        />
        <InfoCard icon={<TrainFront className="h-5 w-5" />} title="交通" text={segment.transport} />
        <InfoCard
          icon={<School className="h-5 w-5" />}
          title="校網"
          text={segment.schoolNet ?? "按實際地址核實校網資料。"}
        />
      </Container>

      <Container className="pb-12">
        <CorridorInventory
          inventory={inventory}
          inquiryText={`你好，我想查詢${segment.nameZh}樓盤`}
          listingsHref={getSegmentListingsHref(segment)}
        />
      </Container>

      {(nearbyInventory.saleRows.length > 0 || nearbyInventory.rentRows.length > 0) && (
        <Container className="pb-12">
          <CorridorInventory
            inventory={nearbyInventory}
            inquiryText={`你好，我想查詢${segment.nameZh}附近盤源`}
            listingsHref={getSegmentListingsHref(segment)}
            eyebrow="附近地段"
            heading="附近選擇"
            description="呢啲放盤鄰近呢個分段，但唔屬於呢個分段嘅核心範圍，可 WhatsApp 查詢實際位置。"
          />
        </Container>
      )}

      <section className="border-y bg-card">
        <Container className="grid gap-8 py-12 lg:grid-cols-[1fr_0.8fr]">
          {faqs.length > 0 && (
            <div>
              <h2 className="text-2xl font-bold text-primary">{segment.nameZh} FAQ</h2>
              <div className="mt-5 divide-y rounded-lg border bg-background">
                {faqs.map((faq) => (
                  <article key={faq.question} className="p-5">
                    <h3 className="font-semibold text-primary">{faq.question}</h3>
                    <p className="mt-2 text-sm leading-7 text-muted-foreground">{faq.answer}</p>
                  </article>
                ))}
              </div>
            </div>
          )}
          <div>
            <h2 className="text-2xl font-bold text-primary">相關連結</h2>
            <div className="mt-5 grid gap-3">
              {segment.links.map((link) => (
                <SiteLink
                  key={link.href}
                  href={link.href}
                  className="flex items-center justify-between rounded-lg border bg-background px-4 py-3 text-sm font-semibold text-primary hover:border-primary"
                >
                  {link.label}
                  <ArrowRight className="h-4 w-4" />
                </SiteLink>
              ))}
            </div>
          </div>
        </Container>
      </section>
    </div>
  );
}
