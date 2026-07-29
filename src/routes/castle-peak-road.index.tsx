import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowRight, MapPin, Waves } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  castlePeakRoadHub,
  castlePeakRoadSegments,
  type CorridorSegment,
} from "@/content/castle-peak-road";
import { SITE_URL } from "@/content/seo";
import { fetchCorridorInventoryForAliases, type CorridorInventory } from "@/lib/queries";
import { renderableFaqs } from "@/lib/faq";

type HubLoaderData = {
  inventories: Record<string, CorridorInventory>;
};

export const Route = createFileRoute("/castle-peak-road/")({
  loader: async (): Promise<HubLoaderData> => {
    const pairs = await Promise.all(
      castlePeakRoadSegments.map(async (segment): Promise<[string, CorridorInventory]> => {
        const inventory = await fetchCorridorInventoryForAliases({
          districtSlugs: segment.districtSlugs,
          estateSlugs: segment.estateSlugs,
          textAliases: segment.textAliases,
          limit: 3,
        });

        return [segment.slug, inventory];
      }),
    );

    return { inventories: Object.fromEntries(pairs) };
  },
  head: () => ({
    meta: [
      { title: castlePeakRoadHub.title },
      { name: "description", content: castlePeakRoadHub.description },
      { property: "og:title", content: castlePeakRoadHub.title },
      { property: "og:description", content: castlePeakRoadHub.description },
    ],
    links: [{ rel: "canonical", href: `${SITE_URL}${castlePeakRoadHub.path}` }],
  }),
  errorComponent: CastlePeakRoadRouteError,
  component: CastlePeakRoadHubPage,
});

function segmentTotal(inventory?: CorridorInventory) {
  return (inventory?.saleTotal ?? 0) + (inventory?.rentTotal ?? 0);
}

function SegmentCard({
  segment,
  inventory,
}: {
  segment: CorridorSegment;
  inventory?: CorridorInventory;
}) {
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
      <div className="mt-5 flex items-center justify-between border-t pt-4 text-sm">
        <span className="font-semibold text-primary">
          {segmentTotal(inventory).toLocaleString()} 個即時放盤
        </span>
        <ArrowRight className="h-4 w-4 text-primary transition group-hover:translate-x-1" />
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

function CastlePeakRoadHubPage() {
  const { inventories } = Route.useLoaderData() as HubLoaderData;
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      {faqs.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
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
        </div>
      </section>

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
