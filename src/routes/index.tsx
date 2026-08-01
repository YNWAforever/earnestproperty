import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
  Users,
  Newspaper,
  Store,
  TrendingUp,
  PlayCircle,
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
import { IntentWhatsAppCTA } from "@/components/site/IntentWhatsAppCTA";
import { OwnerValuationPanel } from "@/components/site/OwnerValuationPanel";
import heroImage from "@/assets/hero-front.jpg";
import logoMark from "@/assets/logo-earnest-mark.png";
import { whatsappUrl, SITE_BRANCHES } from "@/config/site";
import { coreEstates, estateFigure, CORE_ESTATES_PREVIEW_COUNT } from "@/content/core-estates";
import { fetchNeonPublicAgentProfiles } from "@/lib/neon/public-data";
import { toTelHref } from "@/lib/contact-links";
import { SITE_URL, SITE_LOGO_URL, pageSeo } from "@/content/seo";
import {
  fetchEstates,
  fetchFeaturedProperties,
  fetchFaqs,
  fetchListingCountsByEstate,
  fetchCmsVideos,
  fetchRecentTransactions,
  type EstateSummary,
  type FeaturedProperty,
  type FaqItem,
  type CmsVideo,
  type RecentTransaction,
} from "@/lib/queries";
import { renderableFaqs } from "@/lib/faq";
import { getYouTubeVideoId } from "@/lib/youtube-video-url.js";

/** Videos and transactions shown on the homepage before linking to the full page. */
const HOME_VIDEO_COUNT = 3;
const HOME_TRANSACTION_COUNT = 6;

// Vite resolves the import to a hashed, site-root-relative path. Facebook and X
// reject a relative og:image outright, so it is absolutised here rather than in
// the meta block — `new URL` keeps working if the asset ever moves to a CDN and
// the import starts returning a full URL.
const HERO_OG_IMAGE = new URL(heroImage, SITE_URL).href;

export const Route = createFileRoute("/")({
  loader: async () => {
    const [estates, featured, faqs, counts, agentProfiles, videos, transactions] =
      await Promise.all([
        fetchEstates(),
        fetchFeaturedProperties(),
        fetchFaqs("district:sham-tseng"),
        fetchListingCountsByEstate(),
        fetchNeonPublicAgentProfiles(),
        // Both sections are previews, so they must never take the homepage down:
        // the CMS videos table is still being rolled out, and the transactions
        // query fans out across three districts.
        fetchCmsVideos().catch(() => []),
        fetchRecentTransactions(HOME_TRANSACTION_COUNT).catch(() => []),
      ]);
    return {
      estates,
      featured,
      faqs,
      counts: Object.fromEntries(counts),
      agents: agentProfiles.slice(0, 6),
      videos: videos.slice(0, HOME_VIDEO_COUNT),
      transactions: transactions.slice(0, HOME_TRANSACTION_COUNT),
    };
  },
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-2xl font-bold">載入失敗</h1>
      <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
    </div>
  ),
  // Title and description come from the registry. They used to be duplicated
  // here with a divergent licence tail, so the rendered page and the sitemap
  // advertised two different descriptions for the same URL.
  head: () => ({
    meta: [
      { title: pageSeo.home.title },
      { name: "description", content: pageSeo.home.description },
      { property: "og:title", content: "晉誠地產 Earnest Property｜深井 青山公路 汀九物業專家" },
      {
        property: "og:description",
        content: "深井 青山公路 汀九我哋比你更熟。即時搜尋買樓租樓全部真盤。",
      },
      { property: "og:image", content: HERO_OG_IMAGE },
      { name: "twitter:image", content: HERO_OG_IMAGE },
    ],
  }),
  component: HomePage,
});

// Card placeholders until 屋苑相片 land. Hues sit in a ±13° band around the brand
// green (157°) so each estate stays distinguishable without drifting off-palette.
const ESTATE_GRADIENTS: Record<string, string> = {
  bellagio: "linear-gradient(135deg, oklch(0.62 0.1 159.5), oklch(0.4 0.09 156.5))",
  "sea-crest-villa": "linear-gradient(135deg, oklch(0.65 0.09 169.5), oklch(0.42 0.08 162.5))",
  "hong-kong-garden": "linear-gradient(135deg, oklch(0.68 0.08 144.5), oklch(0.44 0.07 152.5))",
  "rhine-garden": "linear-gradient(135deg, oklch(0.6 0.1 164.5), oklch(0.4 0.09 156.5))",
  "lido-garden": "linear-gradient(135deg, oklch(0.65 0.08 149.5), oklch(0.43 0.08 154.5))",
};

function HomePage() {
  const {
    estates,
    featured,
    faqs: faqRows,
    counts,
    agents,
    videos,
    transactions,
  } = Route.useLoaderData();
  const faqs = renderableFaqs(faqRows as FaqItem[]);
  const navigate = useNavigate({ from: "/" });
  const [searchType, setSearchType] = useState("sale");
  const [searchKeyword, setSearchKeyword] = useState("");

  function submitHeroSearch() {
    navigate({
      to: "/listings",
      search: {
        deal: searchType as "sale" | "rent",
        keyword: searchKeyword.trim() || undefined,
        page: 1,
      },
    });
  }

  return (
    <div className="bg-background">
      {/* HERO — brand-led, search demoted to a small optional entry point */}
      <section className="relative isolate overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <img
            src={heroImage}
            alt="深井海岸線及屋苑景觀"
            className="h-full w-full object-cover"
            width={2048}
            height={1370}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/30 to-transparent" />
        </div>

        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8 lg:py-36">
          <div className="max-w-2xl text-primary-foreground">
            {/* Solid green pill: a translucent fill over the photo scrim tops out
                at 3.5:1, under the 4.5:1 AA floor for this 12px label. */}
            <span className="inline-flex items-center gap-2 rounded-full bg-primary/90 px-3 py-1 text-xs font-medium text-primary-foreground backdrop-blur">
              <MapPin className="h-3.5 w-3.5" />
              深井 · 青山公路 · 汀九
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl">
              深井 青山公路 汀九買樓租樓
              <br />
              <span className="text-brand-bright">晉誠地產</span> ‧ 全部真盤
            </h1>
            <p className="mt-5 text-base leading-relaxed opacity-90 sm:text-lg">
              由熟悉深井、青山公路及汀九嘅持牌代理，為你提供買樓、租樓及放盤貼身服務。
              <br />
              碧堤半島．浪翠園．豪景花園．海韻花園．麗都花園 — 我哋逐個屋苑都熟。
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                asChild
                size="lg"
                className="bg-background text-foreground hover:bg-background/90"
              >
                <Link to="/agents">
                  <Users className="h-4 w-4" />
                  認識代理團隊
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10"
              >
                <Link to="/blog">
                  睇最新市場資訊
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>

          {/* Small, optional search entry point — full filters live on /listings */}
          <div className="mt-10 max-w-md rounded-lg border border-border bg-card/95 p-3 shadow-card backdrop-blur">
            <p className="px-1 text-xs font-medium text-muted-foreground">或直接搜尋放盤</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Select value={searchType} onValueChange={setSearchType}>
                <SelectTrigger className="h-10 sm:w-32" aria-label="買樓或租樓">
                  <SelectValue placeholder="買 / 租" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sale">買樓 Sale</SelectItem>
                  <SelectItem value="rent">租樓 Rent</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="h-10"
                aria-label="預算、房數或關鍵字"
                placeholder="預算 / 房數 / 關鍵字"
                value={searchKeyword}
                onChange={(event) => setSearchKeyword(event.target.value)}
              />
              <Button type="button" onClick={submitHeroSearch} className="h-10">
                <Search className="h-4 w-4" />
                搜尋
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURED LISTINGS — 精選筍盤置頂 (client p2): live stock is the first
          thing after the hero, ahead of the evergreen estate directory. It keeps
          bg-muted/40 so it still reads as a band against the white stats strip
          above and the plain estates section below. */}
      <section className="bg-muted/40">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
            <SectionHeader
              eyebrow="精選筍盤"
              title="Featured Listings"
              desc="即日新放盤，隨時 WhatsApp 查詢及預約睇樓。"
              className="text-left"
            />
            <Link
              to="/district/sham-tseng"
              className="text-sm font-medium text-primary hover:underline"
            >
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

      {/* YOUTUBE VIDEOS — sits directly under 精選筍盤 per the client. Renders
          thumbnails rather than embeds: three YouTube iframes above the fold
          would cost far more than the section is worth, and the brief forbids
          regressing Lighthouse/CLS. The section hides itself when the CMS has no
          videos rather than shipping an empty band. */}
      {videos.length > 0 ? (
        <section className="border-y border-border bg-muted/40">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
            <SectionHeader
              eyebrow="YouTube影片"
              title="Video Tours"
              desc="睇片了解屋苑實景、座向同周邊配套。"
            />
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {videos.map((video: CmsVideo) => (
                <HomeVideoCard key={video.id} video={video} />
              ))}
            </div>
            <div className="mt-8">
              <Button asChild variant="outline">
                <Link to="/videos">
                  查看全部影片
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {/* CORE ESTATES */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionHeader
          eyebrow="深井核心屋苑"
          title="Sham Tseng Signature Estates"
          desc="紮根深井青山公路廿多年，每個屋苑我哋都非常熟悉"
        />
        <CoreEstateGrid estates={estates} counts={counts} />
      </section>

      {/* RECENT TRANSACTIONS — under 深井核心屋苑 per the client. Same
          hide-when-empty rule as the video section above. */}
      {transactions.length > 0 ? (
        <section className="border-y border-border bg-muted/40">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
            <SectionHeader
              eyebrow="成交快訊"
              title="Recent Transactions"
              desc="追蹤近期成交及區內價格走勢。"
            />
            <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {transactions.map((transaction: RecentTransaction, index: number) => (
                <HomeTransactionCard
                  key={`${transaction.estates?.slug ?? "unknown"}-${transaction.unit ?? index}`}
                  transaction={transaction}
                />
              ))}
            </div>
            <div className="mt-8">
              <Button asChild variant="outline">
                <Link to="/transactions">
                  查看全部成交
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {/* WHY US */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionHeader eyebrow="為何選晉誠" title="Why Earnest Property" />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Feature
            icon={<MapPin className="h-5 w-5" />}
            title="紮根深井"
            desc="廿多年深耕深井 · 青山公路，每條街每幢樓都熟。"
          />
          <Feature
            icon={<ShieldCheck className="h-5 w-5" />}
            title="持牌代理"
            desc="全公司持牌營業，Licence C-018613，合規可靠。"
          />
          <Feature
            icon={<Home className="h-5 w-5" />}
            title="全部真盤"
            desc="所有放盤親身核實，無虛假廣告，無釣魚盤。"
          />
          <Feature
            icon={<MessageCircle className="h-5 w-5" />}
            title="即時 WhatsApp"
            desc="一 click 直達負責代理，平均 5 分鐘內回覆。"
          />
        </div>
      </section>

      {/* AGENT TEAM PREVIEW */}
      <section className="bg-muted/40">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
            <SectionHeader
              eyebrow="專業代理"
              title="認識晉誠代理團隊"
              desc="熟悉深井、青山公路及汀九市場，直接 WhatsApp 查詢。"
              className="text-left"
            />
            <Button asChild variant="outline">
              <Link to="/agents">
                查看全部代理
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>

          <div className="mt-8 grid gap-5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            {agents.map((agent) => {
              const name = agent.name_zh || agent.name_en || "晉誠地產代理";
              return (
                <div key={agent.id} className="text-center">
                  <div className="mx-auto aspect-square w-full overflow-hidden rounded-full bg-muted">
                    {agent.avatar_url ? (
                      <img
                        src={agent.avatar_url}
                        alt={`${name} 個人相片`}
                        loading="lazy"
                        width={160}
                        height={160}
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm font-semibold">{name}</p>
                  {agent.job_title ? (
                    <p className="text-xs text-muted-foreground">{agent.job_title}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* MARKET INFO */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionHeader eyebrow="市場資訊" title="最新樓市動態" />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Feature
            icon={<Newspaper className="h-5 w-5" />}
            title="市場分析"
            desc="深井、青山公路、汀九樓市觀察。"
            href="/blog"
          />
          <Feature
            icon={<TrendingUp className="h-5 w-5" />}
            title="成交快訊"
            desc="追蹤近期成交及區內價格走勢。"
            href="/transactions"
          />
          <Feature
            icon={<Building2 className="h-5 w-5" />}
            title="屋苑開箱"
            desc="以實地內容了解屋苑優劣。"
            href="/estate-reviews"
          />
        </div>
      </section>

      {/* ABOUT PREVIEW */}
      <section className="border-y border-border bg-card">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1fr_auto] lg:items-center lg:px-8">
          <div>
            <div className="flex items-center gap-3">
              <img
                src={logoMark}
                alt=""
                width={44}
                height={44}
                className="h-11 w-11 object-contain"
              />
              <p className="text-sm font-semibold text-primary">關於晉誠地產</p>
            </div>
            <h2 className="mt-3 text-2xl font-bold sm:text-3xl">
              深井、青山公路物業專家，全部真盤、即時回覆、持牌可靠
            </h2>
            <p className="mt-4 max-w-2xl text-muted-foreground">
              我哋係一間以深井、青山公路為核心的本地地產代理，日常接觸同管理區內真實買賣、租務和業主委託。
              對每個屋苑座向、樓層景觀、車位、會所和近期叫價都有第一手理解。
            </p>
          </div>
          <Button asChild variant="outline" className="w-fit">
            <Link to="/about">
              了解晉誠地產
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      {/* BRANCH NETWORK */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionHeader eyebrow="分行網絡" title="我們的分行" desc="歡迎親臨門市傾盤。" />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SITE_BRANCHES.map((branch) => {
            const phoneHref = toTelHref(branch.phone);
            return (
              <div
                key={branch.id}
                className="overflow-hidden rounded-lg border border-border bg-card"
              >
                {branch.photo ? (
                  <img
                    src={branch.photo}
                    alt={`${branch.name}舖面`}
                    loading="lazy"
                    width={branch.photoWidth}
                    height={branch.photoHeight}
                    className="h-64 w-full object-cover sm:h-72"
                  />
                ) : null}
                <div className="p-5">
                  <h3 className="text-lg font-semibold text-primary">
                    <Store className="mr-2 inline h-4 w-4" />
                    {branch.name}
                  </h3>
                  <p className="mt-2 flex items-start gap-2 text-sm leading-6 text-muted-foreground">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {branch.address}
                  </p>
                  {phoneHref ? (
                    <a
                      href={phoneHref}
                      className="mt-3 flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
                    >
                      <Building2 className="h-4 w-4" />
                      {branch.phone}
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
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
                  <AccordionTrigger className="text-left text-base font-medium">
                    {f.question}
                  </AccordionTrigger>
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

      <OwnerValuationPanel
        id="owner-valuation"
        context={{
          districtName: "深井 / 青山公路 / 汀九",
          source: "homepage-owner-valuation",
        }}
      />

      {/* CTA BAND */}
      <section className="border-y border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-5 px-4 py-14 text-center sm:px-6 lg:flex-row lg:justify-between lg:text-left lg:px-8">
          <div>
            <h2 className="text-2xl font-bold text-foreground sm:text-3xl">
              準備搵深井 青山公路筍盤？
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              即時 WhatsApp 我哋持牌代理，5 分鐘內專人回覆。
            </p>
          </div>
          <div className="w-full max-w-xl">
            <IntentWhatsAppCTA
              context={{
                districtName: "深井 / 青山公路 / 汀九",
                searchSummary: searchKeyword || undefined,
                source: "homepage-final-cta",
              }}
            />
          </div>
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
            description: "深井．青山公路．汀九物業專家",
            url: SITE_URL,
            logo: SITE_LOGO_URL,
            address: {
              "@type": "PostalAddress",
              streetAddress: "新界深井青山公路深井段 23 號麗都花園地下 5A 舖",
              addressRegion: "新界",
              addressCountry: "HK",
            },
            areaServed: ["深井 Sham Tseng", "青山公路 Castle Peak Road", "汀九 Ting Kau"],
            identifier: "C-018613",
          }),
        }}
      />
    </div>
  );
}

/**
 * The client's ten approved estates (docx p13/p15), not just the five the DB
 * knows about. Live figures are merged in by slug; the five the client added
 * have none, so their cards show 「—」 and do not link — they have no page, and
 * linking to an empty one is worse than not linking at all.
 */
function CoreEstateGrid({
  estates,
  counts,
}: {
  estates: EstateSummary[];
  counts: Record<string, number>;
}) {
  const [expanded, setExpanded] = useState(false);
  const live = new Map(estates.map((estate) => [estate.slug, estate]));
  const visible = expanded ? coreEstates : coreEstates.slice(0, CORE_ESTATES_PREVIEW_COUNT);

  return (
    <>
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {visible.map((estate, index) => {
          const dbRow = live.get(estate.slug);
          const units = dbRow?.total_units ?? estate.units;
          const psf = dbRow ? Number(dbRow.avg_saleable_psf) : estate.avgPsf;
          const listingCount = dbRow ? counts[estate.slug] : estate.listingCount;
          const meta = [estate.district, `${estateFigure(units)} 個單位`]
            .filter(Boolean)
            .join(" · ");

          const card = (
            <>
              <div
                className="relative h-48 overflow-hidden"
                style={
                  estate.photo
                    ? undefined
                    : { background: ESTATE_GRADIENTS[estate.slug] ?? ESTATE_GRADIENTS.bellagio }
                }
              >
                {estate.photo ? (
                  <img
                    src={estate.photo}
                    alt={`${estate.name} 深井 放盤`}
                    width={1600}
                    height={900}
                    // The first row is above the fold on desktop; the rest are not.
                    loading={index < 4 ? "eager" : "lazy"}
                    className="h-full w-full object-cover"
                  />
                ) : null}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <Building2 className="absolute right-4 top-4 h-8 w-8 text-primary-foreground/40" />
                <div className="absolute bottom-4 left-5 text-primary-foreground">
                  <h3 className="text-2xl font-bold">{estate.name}</h3>
                  <p className="text-xs opacity-80">{meta}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 p-5">
                <div>
                  <p className="text-[11px] text-muted-foreground">平均實呎</p>
                  <p className="text-base font-semibold text-primary">
                    {psf === null || psf === undefined || !Number.isFinite(psf)
                      ? "—"
                      : `$${estateFigure(psf)}`}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">最新放盤</p>
                  <p className="text-base font-semibold text-primary">
                    {listingCount === null || listingCount === undefined
                      ? "—"
                      : `${listingCount} 個`}
                  </p>
                </div>
                {estate.hasPage ? (
                  <div className="col-span-2 mt-1 flex items-center justify-between border-t border-border pt-3 text-sm font-medium text-primary">
                    <span>瀏覽屋苑詳情</span>
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </div>
                ) : null}
              </div>
            </>
          );

          const shell =
            "group relative overflow-hidden rounded-2xl border border-border bg-card shadow-card";

          return estate.hasPage ? (
            <Link
              key={estate.slug}
              to="/estate/$slug"
              params={{ slug: estate.slug }}
              className={`${shell} transition-all hover:-translate-y-1 hover:shadow-elegant`}
            >
              {card}
            </Link>
          ) : (
            <div key={estate.slug} className={shell}>
              {card}
            </div>
          );
        })}
      </div>

      {coreEstates.length > CORE_ESTATES_PREVIEW_COUNT && !expanded ? (
        <div className="mt-8 flex justify-center">
          <Button variant="outline" onClick={() => setExpanded(true)}>
            查看更多屋苑
          </Button>
        </div>
      ) : null}
    </>
  );
}

/**
 * A YouTube thumbnail linking to /videos, not an embed. Three iframes here would
 * pull in the YouTube player on every homepage load; the thumbnail is one image
 * off a CDN that already has to be warm for the video page anyway.
 */
function HomeVideoCard({ video }: { video: CmsVideo }) {
  const videoId = getYouTubeVideoId(video.video_url);
  return (
    <Link
      to="/videos"
      className="group overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-all hover:-translate-y-1 hover:shadow-elegant"
    >
      <div className="relative aspect-video overflow-hidden bg-muted">
        {videoId ? (
          <img
            src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
            alt={`${video.title} 影片縮圖`}
            loading="lazy"
            width={480}
            height={360}
            className="h-full w-full object-cover"
          />
        ) : null}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-primary/90 p-3 text-primary-foreground">
            <PlayCircle className="h-6 w-6" aria-hidden="true" />
          </span>
        </span>
      </div>
      <div className="p-5">
        <h3 className="font-semibold leading-snug">{video.title}</h3>
        {video.description ? (
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{video.description}</p>
        ) : null}
      </div>
    </Link>
  );
}

function HomeTransactionCard({ transaction }: { transaction: RecentTransaction }) {
  // Every figure is nullable in the source table, so each one is guarded
  // individually — a partially-recorded deal still renders the parts it has.
  const psf = transaction.saleable_psf;
  const price = transaction.price;
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{transaction.estates?.name_zh ?? "區內成交"}</h3>
          {transaction.unit ? (
            <p className="mt-1 text-sm text-muted-foreground">{transaction.unit}</p>
          ) : null}
        </div>
        {transaction.deal_date ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {transaction.deal_date.slice(0, 10)}
          </span>
        ) : null}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3">
        <div>
          <p className="text-[11px] text-muted-foreground">成交價</p>
          <p className="text-base font-semibold text-primary">
            {price === null || price === undefined ? "—" : `$${price.toLocaleString()}`}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">實用呎價</p>
          <p className="text-base font-semibold text-primary">
            {psf === null || psf === undefined ? "—" : `$${Math.round(psf).toLocaleString()}`}
          </p>
        </div>
      </div>
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

function Feature({
  icon,
  title,
  desc,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  href?: "/blog" | "/transactions" | "/estate-reviews";
}) {
  const content = (
    <>
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <h3 className="mt-4 text-base font-semibold text-primary">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{desc}</p>
    </>
  );

  if (href) {
    return (
      <Link
        to={href}
        className="block rounded-xl border border-border bg-card p-6 shadow-card transition-shadow hover:shadow-elegant"
      >
        {content}
      </Link>
    );
  }

  return <div className="rounded-xl border border-border bg-card p-6 shadow-card">{content}</div>;
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
          <span className="rounded-full bg-foreground/90 px-2.5 py-1 text-[11px] font-semibold text-background">
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
          <span className="flex items-center gap-1">
            <Bed className="h-4 w-4" /> {property.bedrooms ?? "-"}
          </span>
          <span className="flex items-center gap-1">
            <Bath className="h-4 w-4" /> {property.bathrooms ?? "-"}
          </span>
          <span className="flex items-center gap-1">
            <Maximize className="h-4 w-4" /> {property.saleable_area ?? "-"} 呎
          </span>
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
