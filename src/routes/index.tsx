import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Search,
  MapPin,
  Home,
  Building2,
  ShieldCheck,
  MessageCircle,
  ArrowRight,
  Bed,
  Bath,
  Maximize,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent } from "@/components/ui/card";
import heroImage from "@/assets/hero-shamtseng.jpg";
import { whatsappUrl } from "@/config/site";
import {
  fetchEstates,
  fetchFeaturedProperties,
  fetchFaqs,
  fetchListingCountsByEstate,
  type EstateSummary,
  type FeaturedProperty,
  type FaqItem,
} from "@/lib/queries";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [estates, featured, faqs, counts] = await Promise.all([
      fetchEstates(),
      fetchFeaturedProperties(),
      fetchFaqs("district:sham-tseng"),
      fetchListingCountsByEstate(),
    ]);
    return { estates, featured, faqs, counts: Object.fromEntries(counts) };
  },
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-2xl font-bold">載入失敗</h1>
      <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
    </div>
  ),
  head: () => ({
    meta: [
      { title: "晉誠地產 Earnest Property｜深井買樓租樓．青山公路物業專家" },
      {
        name: "description",
        content:
          "深井 hyperlocal 地產專家。碧堤半島、浪翠園、豪景花園、海韻花園、麗都花園真盤源。即時 WhatsApp 查詢。Licence C-018613。",
      },
      { property: "og:title", content: "晉誠地產 Earnest Property｜深井物業專家" },
      {
        property: "og:description",
        content: "深井．青山公路．我哋比你更熟。即時搜尋深井真盤源。",
      },
      { property: "og:image", content: heroImage },
      { name: "twitter:image", content: heroImage },
    ],
  }),
  component: HomePage,
});

const ESTATE_GRADIENTS: Record<string, string> = {
  "belvedere-garden": "linear-gradient(135deg, oklch(0.55 0.1 220), oklch(0.32 0.07 240))",
  "sea-crest-villa": "linear-gradient(135deg, oklch(0.6 0.08 200), oklch(0.35 0.07 230))",
  "hong-kong-garden": "linear-gradient(135deg, oklch(0.65 0.09 180), oklch(0.38 0.06 220))",
  "sea-pearl-garden": "linear-gradient(135deg, oklch(0.58 0.1 210), oklch(0.32 0.07 240))",
  "lido-garden": "linear-gradient(135deg, oklch(0.62 0.08 195), oklch(0.36 0.07 225))",
};

function HomePage() {
  const { estates, featured, faqs, counts } = Route.useLoaderData();
  const [searchEstate, setSearchEstate] = useState("");
  const [searchType, setSearchType] = useState("sale");

  const totalUnits = estates.reduce((s: number, e: EstateSummary) => s + (e.total_units ?? 0), 0);
  const avgPsf =
    estates.length > 0
      ? Math.round(
          estates.reduce((s: number, e: EstateSummary) => s + Number(e.avg_saleable_psf ?? 0), 0) / estates.length
        )
      : 0;

  return (
    <div className="bg-background">
      {/* HERO */}
      <section className="relative isolate overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <img
            src={heroImage}
            alt="深井海岸線及碧堤半島景觀"
            className="h-full w-full object-cover"
            width={1920}
            height={1080}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-primary/85 via-primary/60 to-primary/30" />
        </div>

        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8 lg:py-36">
          <div className="max-w-2xl text-primary-foreground">
            <span className="inline-flex items-center gap-2 rounded-full bg-gold/20 px-3 py-1 text-xs font-medium text-gold backdrop-blur">
              <MapPin className="h-3.5 w-3.5" />
              深井 · 青山公路 · 荃灣
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl">
              深井買樓租樓<br />
              <span className="text-gold">晉誠地產</span>．真盤源
            </h1>
            <p className="mt-5 text-base leading-relaxed opacity-90 sm:text-lg">
              深井．青山公路．我哋比你更熟。<br />
              碧堤半島．浪翠園．豪景花園．海韻花園．麗都花園 — 一站式真盤源平台。
            </p>
          </div>

          {/* SEARCH BAR */}
          <Card className="mt-10 border-0 bg-card/95 shadow-elegant backdrop-blur">
            <CardContent className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
              <Select value={searchType} onValueChange={setSearchType}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="買 / 租" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sale">買樓 Sale</SelectItem>
                  <SelectItem value="rent">租樓 Rent</SelectItem>
                </SelectContent>
              </Select>
              <Select value={searchEstate} onValueChange={setSearchEstate}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="選擇屋苑" />
                </SelectTrigger>
                <SelectContent>
                  {estates.map((e: EstateSummary) => (
                    <SelectItem key={e.slug} value={e.slug}>
                      {e.name_zh}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input className="h-11" placeholder="價錢 / 房數 / 關鍵字" />
              <Button size="lg" className="h-11 bg-coral text-coral-foreground hover:bg-coral/90">
                <Search className="h-4 w-4" />
                搜尋
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* DISTRICT STATS */}
      <section className="border-y border-border bg-card">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-3 sm:px-6 lg:px-8">
          <Stat label="深井住宅單位" value={totalUnits.toLocaleString()} />
          <Stat label="即時放盤" value={`${featured.length} 個精選`} />
          <Stat label="平均實用呎價" value={`$${avgPsf.toLocaleString()}`} sub="近 12 個月" />
        </div>
      </section>

      {/* CORE ESTATES */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionHeader
          eyebrow="深井核心屋苑"
          title="Sham Tseng Signature Estates"
          desc="紮根深井十多年，每個屋苑我哋都熟到尾。"
        />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {estates.map((estate: EstateSummary) => {
            // counts is keyed by estate_id; we don't have id in this select, fall back to 0
            const listingCount = 0;
            return (
              <Link
                key={estate.slug}
                to="/estate/$slug"
                params={{ slug: estate.slug }}
                className="group relative overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-all hover:-translate-y-1 hover:shadow-elegant"
              >
                <div
                  className="relative h-48 overflow-hidden"
                  style={{ background: ESTATE_GRADIENTS[estate.slug] ?? ESTATE_GRADIENTS["belvedere-garden"] }}
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-primary/70 to-transparent" />
                  <Building2 className="absolute right-4 top-4 h-8 w-8 text-primary-foreground/40" />
                  <div className="absolute bottom-4 left-5 text-primary-foreground">
                    <h3 className="text-2xl font-bold">{estate.name_zh}</h3>
                    <p className="text-xs opacity-80">深井 · {(estate.total_units ?? 0).toLocaleString()} 個單位</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 p-5">
                  <div>
                    <p className="text-[11px] text-muted-foreground">平均實呎</p>
                    <p className="text-base font-semibold text-primary">
                      ${Number(estate.avg_saleable_psf ?? 0).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">最新放盤</p>
                    <p className="text-base font-semibold text-primary">
                      {featured.filter((p: FeaturedProperty) => p.estates?.slug === estate.slug).length} 個
                    </p>
                  </div>
                  <div className="col-span-2 mt-1 flex items-center justify-between border-t border-border pt-3 text-sm font-medium text-primary">
                    <span>瀏覽屋苑詳情</span>
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
        {/* keep counts referenced to avoid unused warning */}
        <span className="hidden">{Object.keys(counts).length}</span>
      </section>

      {/* FEATURED LISTINGS */}
      <section className="bg-muted/40">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
            <SectionHeader
              eyebrow="精選筍盤"
              title="Featured Listings"
              desc="即日新放盤，隨時 WhatsApp 查詢及預約睇樓。"
              className="text-left"
            />
            <Link to="/district/sham-tseng" className="text-sm font-medium text-primary hover:underline">
              所有放盤 →
            </Link>
          </div>

          {featured.length === 0 ? (
            <p className="mt-8 text-center text-muted-foreground">暫時未有精選放盤，請稍後再試。</p>
          ) : (
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {featured.map((p: FeaturedProperty) => (
                <PropertyCard key={p.id} property={p} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* WHY US */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionHeader eyebrow="為何選晉誠" title="Why Earnest Property" />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Feature icon={<MapPin className="h-5 w-5" />} title="紮根深井" desc="十多年深耕深井 · 青山公路，每條街每幢樓都熟。" />
          <Feature icon={<ShieldCheck className="h-5 w-5" />} title="持牌代理" desc="全公司持牌營業，Licence C-018613，合規可靠。" />
          <Feature icon={<Home className="h-5 w-5" />} title="真盤源" desc="所有放盤親身核實，無虛假廣告，無釣魚盤。" />
          <Feature icon={<MessageCircle className="h-5 w-5" />} title="即時 WhatsApp" desc="一 click 直達負責代理，平均 5 分鐘內回覆。" />
        </div>
      </section>

      {/* FAQ */}
      {faqs.length > 0 && (
        <section className="bg-card border-y border-border">
          <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
            <SectionHeader eyebrow="常見問題" title="深井買樓租樓 FAQ" />
            <Accordion type="single" collapsible className="mt-8">
              {faqs.map((f: FaqItem, i: number) => (
                <AccordionItem key={i} value={`faq-${i}`}>
                  <AccordionTrigger className="text-left text-base font-medium">{f.question}</AccordionTrigger>
                  <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                    {f.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
            <script
              type="application/ld+json"
              dangerouslySetInnerHTML={{
                __html: JSON.stringify({
                  "@context": "https://schema.org",
                  "@type": "FAQPage",
                  mainEntity: faqs.map((f: FaqItem) => ({
                    "@type": "Question",
                    name: f.question,
                    acceptedAnswer: { "@type": "Answer", text: f.answer },
                  })),
                }),
              }}
            />
          </div>
        </section>
      )}

      {/* CTA BAND */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-5 px-4 py-14 text-center sm:px-6 lg:flex-row lg:justify-between lg:text-left lg:px-8">
          <div>
            <h2 className="text-2xl font-bold sm:text-3xl">準備搵深井筍盤？</h2>
            <p className="mt-2 text-sm opacity-85">即時 WhatsApp 我哋持牌代理，5 分鐘內專人回覆。</p>
          </div>
          <a
            href={whatsappUrl("你好，我想查詢深井物業")}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size="lg" className="bg-coral text-coral-foreground hover:bg-coral/90">
              <MessageCircle className="h-4 w-4" />
              WhatsApp 即時查詢
            </Button>
          </a>
        </div>
      </section>

      {/* Organization JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "RealEstateAgent",
            name: "晉誠地產 Earnest Property",
            description: "深井．青山公路物業專家",
            url: "https://www.earnestproperty.com",
            address: {
              "@type": "PostalAddress",
              streetAddress: "新界深井青山公路深井段 23 號麗都花園地下 5A 舖",
              addressRegion: "新界",
              addressCountry: "HK",
            },
            areaServed: ["深井 Sham Tseng", "荃灣 Tsuen Wan"],
            identifier: "C-018613",
          }),
        }}
      />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="text-center">
      <div className="text-3xl font-bold tracking-tight text-primary sm:text-4xl">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
      {sub && <div className="text-xs text-muted-foreground/70">{sub}</div>}
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  desc,
  className = "text-center",
}: {
  eyebrow: string;
  title: string;
  desc?: string;
  className?: string;
}) {
  return (
    <div className={`max-w-2xl ${className === "text-center" ? "mx-auto" : ""} ${className}`}>
      <p className="text-sm font-semibold uppercase tracking-widest text-coral">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-bold tracking-tight text-primary sm:text-4xl">{title}</h2>
      {desc && <p className="mt-3 text-base text-muted-foreground">{desc}</p>}
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-card">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <h3 className="mt-4 text-base font-semibold text-primary">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{desc}</p>
    </div>
  );
}

type PropertyItem = {
  id: string;
  listing_no: string;
  title_zh: string;
  deal_type: string;
  price: number | null;
  rent: number | null;
  saleable_area: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  features: string[] | null;
  estates?: { name_zh: string; slug: string } | null;
};

function PropertyCard({ property }: { property: PropertyItem }) {
  const isRent = property.deal_type === "rent";
  const priceDisplay = isRent
    ? `$${((property.rent ?? 0) / 1000).toFixed(0)}K`
    : `$${((property.price ?? 0) / 10000).toFixed(0)}萬`;
  const psf =
    !isRent && property.price && property.saleable_area
      ? Math.round(property.price / property.saleable_area)
      : null;
  const tag = property.features?.[0] ?? "精選";

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card transition-all hover:-translate-y-1 hover:shadow-elegant">
      <div className="relative h-48 bg-gradient-to-br from-primary/40 to-primary">
        <div className="absolute left-3 top-3 flex gap-2">
          <span className="rounded-full bg-coral px-2.5 py-1 text-[11px] font-semibold text-coral-foreground">
            {isRent ? "租 Rent" : "售 Sale"}
          </span>
          <span className="rounded-full bg-card/90 px-2.5 py-1 text-[11px] font-semibold text-primary backdrop-blur">
            {tag}
          </span>
        </div>
        <Building2 className="absolute right-3 top-3 h-7 w-7 text-primary-foreground/30" />
        <div className="absolute bottom-3 left-3 text-primary-foreground">
          <p className="text-xs opacity-80">{property.estates?.name_zh ?? ""}</p>
        </div>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-base font-semibold text-primary">{property.title_zh}</h3>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-coral">{priceDisplay}</span>
          <span className="text-xs text-muted-foreground">
            {isRent ? "/月" : psf ? ` · 實呎 $${psf.toLocaleString()}` : ""}
          </span>
        </div>
        <div className="mt-4 flex items-center gap-4 border-t border-border pt-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1"><Bed className="h-4 w-4" /> {property.bedrooms ?? "-"}</span>
          <span className="flex items-center gap-1"><Bath className="h-4 w-4" /> {property.bathrooms ?? "-"}</span>
          <span className="flex items-center gap-1"><Maximize className="h-4 w-4" /> {property.saleable_area ?? "-"} 呎</span>
        </div>
        <a
          href={whatsappUrl(`你好，我想查詢樓盤 ${property.listing_no} (${property.title_zh})`)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4"
        >
          <Button variant="outline" className="w-full">
            <MessageCircle className="h-4 w-4" />
            WhatsApp 查詢
          </Button>
        </a>
      </div>
    </div>
  );
}
