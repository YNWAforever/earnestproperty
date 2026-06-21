import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { MessageCircle } from "lucide-react";
import { whatsappUrl } from "@/config/site";
import { SITE_URL, estateSeo } from "@/content/seo";
import {
  fetchEstateBySlug,
  fetchFaqs,
  fetchListingsForEstate,
  type FaqItem,
  type ListingRow,
} from "@/lib/queries";

type EstateDetail = NonNullable<Awaited<ReturnType<typeof fetchEstateBySlug>>>;

export const Route = createFileRoute("/estate/$slug")({
  loader: async ({ params }) => {
    const estate = await fetchEstateBySlug(params.slug);
    if (!estate) throw notFound();
    const [faqs, latestListings] = await Promise.all([
      fetchFaqs(`estate:${params.slug}`),
      fetchListingsForEstate(params.slug, 6),
    ]);
    return { estate, faqs, latestListings };
  },
  head: ({ loaderData }) => {
    const slug = loaderData?.estate.slug as keyof typeof estateSeo | undefined;
    const seo = slug ? estateSeo[slug] : undefined;
    return {
      meta: [
        { title: seo?.title ?? `${loaderData?.estate.name_zh ?? "屋苑"}｜晉誠地產屋苑專頁` },
        {
          name: "description",
          content:
            seo?.description ??
            `${loaderData?.estate.name_zh ?? ""} ${loaderData?.estate.total_units ?? ""} 個單位，平均實呎 $${loaderData?.estate.avg_saleable_psf ?? ""}。即時放盤、成交、FAQ。`,
        },
      ],
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
  const { estate, faqs, latestListings } = Route.useLoaderData() as {
    estate: EstateDetail;
    faqs: FaqItem[];
    latestListings: ListingRow[];
  };
  const seo = estateSeo[estate.slug as keyof typeof estateSeo];
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
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
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
      <section className="bg-gradient-to-br from-primary to-primary/70 py-16 text-primary-foreground">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <p className="text-sm opacity-80">深井屋苑</p>
          <h1 className="mt-2 text-4xl font-bold sm:text-5xl">{seo?.nameZh ?? estate.name_zh}</h1>
          <p className="mt-3 text-base opacity-85">
            {seo?.nameEn ?? estate.name_en ?? ""} · {estate.developer ?? ""} ·{" "}
            {estate.year_completed ?? ""} 年落成 · 共 {(estate.total_units ?? 0).toLocaleString()}{" "}
            個單位
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
        <Stat
          label="平均實呎"
          value={`$${Number(estate.avg_saleable_psf ?? 0).toLocaleString()}`}
        />
        <Stat label="單位總數" value={(estate.total_units ?? 0).toLocaleString()} />
        <Stat label="期數" value={`${estate.phases ?? "-"} 期`} />
        <Stat label="落成年份" value={String(estate.year_completed ?? "-")} />
      </section>

      {estate.description && (
        <section className="mx-auto max-w-7xl px-4 pb-8 sm:px-6 lg:px-8">
          <p className="text-base leading-relaxed text-muted-foreground">
            {seo?.intro ?? estate.description}
          </p>
          {seo?.fit && (
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">{seo.fit}</p>
          )}
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
          <p className="mt-5 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            暫時未有公開放盤，歡迎 WhatsApp 查詢最新業主盤。
          </p>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {latestListings.map((listing) => (
              <EstateListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </section>

      {faqs.length > 0 && (
        <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-primary">常見問題</h2>
          <Accordion type="single" collapsible className="mt-6">
            {faqs.map((f: FaqItem, i: number) => (
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

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <p className="text-muted-foreground">完整放盤、近期成交、平面圖即將推出。</p>
        <a
          href={whatsappUrl(`你好，我想查詢${estate.name_zh}物業`)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-block"
        >
          <Button className="bg-coral text-coral-foreground hover:bg-coral/90">
            <MessageCircle className="h-4 w-4" />
            WhatsApp 查詢 {estate.name_zh}
          </Button>
        </a>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-primary">{value}</p>
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
        {listing.images?.[0] && (
          <img
            src={listing.images[0]}
            alt={listing.title_zh}
            className="h-full w-full object-cover"
          />
        )}
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
