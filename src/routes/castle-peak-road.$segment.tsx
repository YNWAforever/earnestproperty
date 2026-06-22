import type { ReactNode } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight, Building2, MapPinned, School, TrainFront } from "lucide-react";

import { CorridorInventory } from "@/components/site/CorridorInventory";
import { Button } from "@/components/ui/button";
import {
  castlePeakRoadHub,
  getCastlePeakRoadSegment,
  type CorridorSegment,
} from "@/content/castle-peak-road";
import { SITE_URL } from "@/content/seo";
import { whatsappUrl } from "@/config/site";
import {
  fetchCorridorInventoryForAliases,
  type CorridorInventory as CorridorInventoryData,
} from "@/lib/queries";

type SegmentLoaderData = {
  segment: CorridorSegment;
  inventory: CorridorInventoryData;
};

export const Route = createFileRoute("/castle-peak-road/$segment")({
  loader: async ({ params }): Promise<SegmentLoaderData> => {
    const segment = getCastlePeakRoadSegment(params.segment);
    if (!segment) throw notFound();

    const inventory = await fetchCorridorInventoryForAliases({
      districtSlugs: segment.districtSlugs,
      estateSlugs: segment.estateSlugs,
      textAliases: segment.textAliases,
      limit: 6,
    });

    return { segment, inventory };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.segment.title ?? castlePeakRoadHub.title },
      {
        name: "description",
        content: loaderData?.segment.description ?? castlePeakRoadHub.description,
      },
      { property: "og:title", content: loaderData?.segment.title ?? castlePeakRoadHub.title },
      {
        property: "og:description",
        content: loaderData?.segment.description ?? castlePeakRoadHub.description,
      },
    ],
  }),
  component: CastlePeakRoadSegmentPage,
});

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
  const { segment, inventory } = Route.useLoaderData() as SegmentLoaderData;
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
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: segment.faqs.map((faq) => ({
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
      name: listing.title_zh,
    })),
  };

  return (
    <main className="bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      {allListings.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
        />
      )}

      <section className="border-b bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <nav className="text-sm text-muted-foreground">
            <Link to="/castle-peak-road" className="hover:text-primary">
              青山公路
            </Link>
            <span className="mx-2">/</span>
            <span>{segment.nameZh}</span>
          </nav>
          <p className="mt-5 text-sm font-semibold text-coral">{segment.eyebrow}</p>
          <h1 className="mt-3 max-w-4xl text-3xl font-bold tracking-tight text-primary sm:text-5xl">
            {segment.h1}
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-muted-foreground">
            {segment.description}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild className="bg-coral text-coral-foreground hover:bg-coral/90">
              <a href={whatsappUrl(`你好，我想查詢${segment.nameZh}樓盤`)}>WhatsApp 查詢</a>
            </Button>
            <Button asChild variant="outline">
              <Link to="/castle-peak-road">
                返回青山公路總覽
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
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
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-4 pb-12 sm:px-6 md:grid-cols-2 lg:grid-cols-4 lg:px-8">
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
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
        <CorridorInventory
          inventory={inventory}
          inquiryText={`你好，我想查詢${segment.nameZh}樓盤`}
          listingsHref={`/listings?deal=all&district=${segment.districtSlugs[0] ?? "castle-peak-road"}&page=1`}
        />
      </section>

      <section className="border-y bg-card">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_0.8fr] lg:px-8">
          <div>
            <h2 className="text-2xl font-bold text-primary">{segment.nameZh} FAQ</h2>
            <div className="mt-5 divide-y rounded-lg border bg-background">
              {segment.faqs.map((faq) => (
                <article key={faq.question} className="p-5">
                  <h3 className="font-semibold text-primary">{faq.question}</h3>
                  <p className="mt-2 text-sm leading-7 text-muted-foreground">{faq.answer}</p>
                </article>
              ))}
            </div>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-primary">相關連結</h2>
            <div className="mt-5 grid gap-3">
              {segment.links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="flex items-center justify-between rounded-lg border bg-background px-4 py-3 text-sm font-semibold text-primary hover:border-primary"
                >
                  {link.label}
                  <ArrowRight className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
