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
  Camera,
  Maximize,
  PlayCircle,
  Users,
  Newspaper,
  Store,
  TrendingUp,
  Video,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { EmptyState } from "@/components/layout/EmptyState";
import { FreshnessStamp } from "@/components/layout/FreshnessStamp";
import heroImage from "@/assets/hero-front.jpg";
import logoMark from "@/assets/logo-earnest-mark.png";
import { whatsappUrl, SITE_BRANCHES } from "@/config/site";
import {
  coreEstates,
  estateFigure,
  CORE_ESTATES_PREVIEW_COUNT,
  type CoreEstate,
} from "@/content/core-estates";
import { castlePeakRoadEstates } from "@/content/castle-peak-road-estates";
import { fetchNeonPublicAgentProfiles } from "@/lib/neon/public-data";
import { toTelHref } from "@/lib/contact-links";
import { formatHkd } from "@/lib/format";
import { AppImage } from "@/components/media/AppImage";
import { canonicalLink, pageSeo, SITE_URL } from "@/content/seo";
import {
  fetchCmsVideos,
  fetchEstates,
  fetchEstatesByDistrict,
  fetchFeaturedProperties,
  fetchFaqs,
  fetchListingCountsByEstate,
  type CmsVideo,
  type EstateSummary,
  type FeaturedProperty,
  type FaqItem,
} from "@/lib/queries";
import { renderableFaqs } from "@/lib/faq";
import { getYouTubeVideoId, isYouTubeVideoUrl } from "@/lib/youtube-video-url.js";
import { jsonLdScript } from "@/lib/schema";

// Vite resolves the import to a hashed, site-root-relative path. Facebook and X
// reject a relative og:image outright, so it is absolutised here rather than in
// the meta block — `new URL` keeps working if the asset ever moves to a CDN and
// the import starts returning a full URL.
const HERO_OG_IMAGE = new URL(heroImage, SITE_URL).href;

export const Route = createFileRoute("/")({
  loader: async () => {
    // `fetchCmsVideos` reads the small curated cms_videos table. Deliberately NOT
    // `fetchVideosPageData()` (what /videos uses) -- that also runs a 36-row
    // searchListings pass to find listing videos, and the homepage can derive
    // those for free from `featured`, which already selects `video_url`.
    const [estates, castlePeakRoadDbEstates, featured, faqs, counts, agentProfiles, cmsVideos] =
      await Promise.all([
        fetchEstates(),
        // Same live-figure merge as the 深井 group above, scoped to the
        // 青山公路 district -- fetchEstates() itself is hardcoded to
        // "sham-tseng" (it delegates to fetchEstatesByDistrict internally),
        // so this is the first caller to pass a different district through
        // fetchEstatesByDistrict directly.
        fetchEstatesByDistrict("castle-peak-road"),
        fetchFeaturedProperties(),
        fetchFaqs("district:sham-tseng"),
        fetchListingCountsByEstate(),
        fetchNeonPublicAgentProfiles(),
        // Decorative video section: a real DB error here (fetchCmsVideos only
        // special-cases the missing-table case and rethrows everything else)
        // must not take down the whole homepage.
        fetchCmsVideos().catch(() => []),
      ]);
    return {
      estates,
      castlePeakRoadDbEstates,
      featured,
      faqs,
      counts: Object.fromEntries(counts),
      agents: agentProfiles.slice(0, 6),
      cmsVideos,
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
    links: [canonicalLink(pageSeo.home.path)],
  }),
  component: HomePage,
});

// One row of three on desktop; more than that belongs on /videos.
const HOME_VIDEO_COUNT = 3;

type HomeVideo = {
  key: string;
  title: string;
  url: string;
  eyebrow: string;
  /** Set for listing walkthroughs, so the card can deep-link to the property. */
  listingNo: string | null;
};

// Staff sometimes promote a listing's own walkthrough to the official channel,
// so the same YouTube video can appear once via `featured` and once via
// `cmsVideos` -- dedupe by video id (falling back to the raw URL for anything
// that isn't a recognised YouTube link) before the section is capped to three.
function dedupeVideosByUrl(videos: HomeVideo[]): HomeVideo[] {
  const seen = new Set<string>();
  return videos.filter((video) => {
    const id = getYouTubeVideoId(video.url) ?? video.url;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

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
    castlePeakRoadDbEstates,
    featured,
    faqs: faqRows,
    counts,
    agents,
    cmsVideos,
  } = Route.useLoaderData();
  const faqs = renderableFaqs(faqRows as FaqItem[]);
  const navigate = useNavigate({ from: "/" });
  const [searchType, setSearchType] = useState("sale");
  const [searchKeyword, setSearchKeyword] = useState("");

  // 精選樓盤影片 prefers real listing walkthroughs (derived free from `featured`,
  // which already selects video_url) and tops up from the curated channel videos,
  // so the section stays populated whichever of the two the client has filled in.
  const homeVideos: HomeVideo[] = dedupeVideosByUrl([
    ...featured
      .filter((p: FeaturedProperty) => isYouTubeVideoUrl(p.video_url))
      .map((p: FeaturedProperty) => ({
        key: `listing-${p.id}`,
        title: p.title_zh,
        url: p.video_url as string,
        eyebrow: `${p.estates?.name_zh ?? "深井 / 青山公路"} · ${p.deal_type === "rent" ? "租" : "售"}`,
        listingNo: p.listing_no,
      })),
    ...cmsVideos.map((video: CmsVideo) => ({
      key: `cms-${video.id}`,
      title: video.title || "晉誠地產 YouTube影片",
      url: video.video_url,
      eyebrow: "官方頻道",
      listingNo: null,
    })),
  ]).slice(0, HOME_VIDEO_COUNT);

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
          <AppImage
            src={heroImage}
            alt="深井海岸線及屋苑景觀"
            className="h-full w-full object-cover"
            width={2048}
            height={1370}
            loading="eager"
            fetchPriority="high"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/30 to-transparent" />
        </div>

        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8 lg:py-28">
          <div className="max-w-2xl text-primary-foreground">
            {/* Solid green pill: a translucent fill over the photo scrim tops out
                at 3.5:1, under the 4.5:1 AA floor for this 12px label. */}
            <span className="inline-flex items-center gap-2 rounded-full bg-primary/90 px-3 py-1 text-xs font-medium text-primary-foreground backdrop-blur">
              <MapPin className="h-3.5 w-3.5" />
              深井 · 青山公路 · 汀九
            </span>
            <h1 className="mt-5 text-balance text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl">
              深井 青山公路 汀九買樓租樓{" "}
              <span className="whitespace-nowrap text-brand-bright">晉誠地產</span> ‧ 全部真盤
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
          thing after the hero, ahead of the evergreen estate directory. The
          district-stats strip that used to sit above this was removed at the
          client's request; bg-muted/40 still reads as a band against the hero
          above and the plain estates section below. */}
      <section className="bg-muted/40">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
            <SectionHeader
              title="精選筍盤"
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
            <EmptyState
              className="mt-8"
              icon={Building2}
              title="暫時未有精選放盤"
              description="請稍後再試，或直接 WhatsApp 我哋查詢最新盤源。"
              action={
                <a
                  href={whatsappUrl("你好，想查詢深井、青山公路最新放盤")}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="outline">
                    <MessageCircle className="h-4 w-4" />
                    WhatsApp 查詢
                  </Button>
                </a>
              }
            />
          ) : (
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {featured.map((p: FeaturedProperty) => (
                <PropertyCard key={p.id} property={p} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* FEATURED VIDEOS — sits directly after 精選筍盤 so a buyer who just
          scanned the live stock can immediately see the same listings walked
          through on video. Hidden entirely when neither the CMS videos nor any
          featured listing has a video, rather than shipping an empty band. */}
      {homeVideos.length > 0 ? (
        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
            <SectionHeader
              title="精選樓盤影片"
              desc="睇樓前先睇片，了解實際景觀、間隔同屋苑環境。"
              className="text-left"
            />
            <Button asChild variant="outline">
              <Link to="/videos">
                所有影片
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>

          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {homeVideos.map((video) => (
              <HomeVideoCard key={video.key} video={video} />
            ))}
          </div>
        </section>
      ) : null}

      {/* CORE ESTATES */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionHeader title="深井核心屋苑" desc="紮根深井青山公路廿多年，每個屋苑我哋都非常熟悉" />
        <CoreEstateGrid
          estates={estates}
          counts={counts}
          staticEstates={coreEstates}
          districtLabel="深井"
        />
      </section>

      {/* CASTLE PEAK ROAD ESTATES */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionHeader title="青山公路屋苑" desc="掃管笏、青山灣、小欖一帶屋苑，我哋同樣熟悉" />
        <CoreEstateGrid
          estates={castlePeakRoadDbEstates}
          counts={counts}
          staticEstates={castlePeakRoadEstates}
          districtLabel="青山公路"
        />
      </section>

      {/* WHY US */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionHeader title="為何選晉誠" />
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
            {/* No `desc` -- the tagline this used to carry ("熟悉深井、青山
                公路及汀九市場，直接 WhatsApp 查詢。") restated the hero/WHY US
                claims; the agent cards below demonstrate "real, licensed
                people" better than a repeated sentence would. */}
            <SectionHeader eyebrow="專業代理" title="認識晉誠代理團隊" className="text-left" />
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
                    <AppImage
                      src={agent.avatar_url}
                      alt={`${name} 個人相片`}
                      width={160}
                      height={160}
                      className="h-full w-full object-cover"
                      fallback={
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <UserRound className="h-9 w-9" aria-hidden="true" />
                        </div>
                      }
                    />
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
            title="晉誠地產最新成交"
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
              <AppImage
                src={logoMark}
                alt=""
                width={44}
                height={44}
                className="h-11 w-11 object-contain"
              />
              <p className="text-sm font-semibold text-primary">關於晉誠地產</p>
            </div>
            {/* One-line teaser only -- the full trust pitch already lives in
                the hero subhead and the WHY US tiles above; /about carries
                the fuller version below the fold for anyone who wants it. */}
            <h2 className="mt-3 text-2xl font-bold sm:text-3xl">
              想知多啲晉誠點解咁熟深井、青山公路？
            </h2>
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
                <AppImage
                  src={branch.photo}
                  alt={`${branch.name}舖面`}
                  // photoWidth/photoHeight are optional in SiteBranch (a branch may
                  // ship without a photo at all) -- AppImage's width/height are
                  // required intrinsic-size hints, not the rendered box (that's
                  // fixed by className below), so these fallbacks are never seen,
                  // only used to satisfy the type when src is also absent.
                  width={branch.photoWidth ?? 1600}
                  height={branch.photoHeight ?? 1200}
                  className="h-64 w-full object-cover sm:h-72"
                />
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
                __html: jsonLdScript({
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
  staticEstates,
  districtLabel,
}: {
  estates: EstateSummary[];
  counts: Record<string, number>;
  staticEstates: CoreEstate[];
  districtLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const live = new Map(estates.map((estate) => [estate.slug, estate]));
  // hasPage:true means the route/content/SEO plumbing exists for this estate
  // (estate-registry.ts's own doc comment); it does NOT mean the estate is
  // actually published -- the 2026-09-01 17-estate expansion gave all 22
  // registry entries hasPage:true while 17 of them stay published=false in
  // Neon until a human clears each one individually. A card must only link
  // (or count toward the grid at all) once its live DB row actually exists
  // in `estates` -- gating on hasPage alone would ship a link to a page that
  // 404s. This also naturally reproduces the original "no detail page yet"
  // behavior: filter unreachable estates out of the grid entirely rather
  // than shipping thin, non-clickable cards next to real ones.
  const linkableEstates = staticEstates.filter((estate) => estate.hasPage && live.has(estate.slug));
  const visible = expanded ? linkableEstates : linkableEstates.slice(0, CORE_ESTATES_PREVIEW_COUNT);

  // Mirrors the already-established pattern for "this section has nothing
  // real to show yet" elsewhere in this codebase (estate-reviews.tsx's own
  // 屋苑文章 section, and this same file's 精選筍盤 EmptyState above) --
  // rendering the section heading with a bare, cardless grid underneath
  // looks broken, not like an honest "nothing here yet" state. This is a
  // real, currently-live case: the 青山公路屋苑 group's own estates all stay
  // published=false until each individually clears its publish gate, so
  // this section shows the EmptyState until at least one of them does.
  if (linkableEstates.length === 0) {
    return (
      <EmptyState
        className="mt-10"
        icon={Building2}
        title={`暫未有${districtLabel}屋苑專頁`}
        description="屋苑專頁陸續上線，歡迎先直接 WhatsApp 我哋查詢最新放盤。"
        action={
          <a
            href={whatsappUrl(`你好，想查詢${districtLabel}屋苑放盤`)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline">
              <MessageCircle className="h-4 w-4" />
              WhatsApp 查詢
            </Button>
          </a>
        }
      />
    );
  }

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
                <AppImage
                  src={estate.photo}
                  alt={`${estate.name} ${districtLabel} 放盤`}
                  width={1600}
                  height={900}
                  // The first row is above the fold on desktop; the rest are not.
                  loading={index < 4 ? "eager" : "lazy"}
                  className="h-full w-full object-cover"
                  // No src (or a runtime error) must let the parent's per-estate
                  // ESTATE_GRADIENTS background show through -- AppImage's opaque
                  // default fallback would otherwise paint over it.
                  fallback={<></>}
                />
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
                {dbRow ? (
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

          // dbRow presence (not estate.hasPage alone) gates the link -- see
          // linkableEstates's own comment above. visible is already filtered
          // to entries with a live dbRow, so this is always true here today;
          // kept as an explicit per-card check so this stays safe even if
          // that upstream filter is ever loosened without updating this line.
          return dbRow ? (
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

      {linkableEstates.length > CORE_ESTATES_PREVIEW_COUNT && !expanded ? (
        <div className="mt-8 flex justify-center">
          <Button variant="outline" onClick={() => setExpanded(true)}>
            查看更多屋苑
          </Button>
        </div>
      ) : null}
    </>
  );
}

function SectionHeader({
  eyebrow,
  title,
  desc,
  className = "text-center",
}: {
  eyebrow?: string;
  title: string;
  desc?: string;
  className?: string;
}) {
  return (
    <div className={`max-w-2xl ${className === "text-center" ? "mx-auto" : ""} ${className}`}>
      {eyebrow ? (
        <p className="text-sm font-semibold uppercase tracking-widest text-coral">{eyebrow}</p>
      ) : null}
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

/**
 * Thumbnail facade rather than an embedded player: three YouTube iframes on the
 * homepage would each pull in the full player bundle before the visitor has
 * asked for any video. The card links out to where the video actually plays
 * (the listing page for a walkthrough, /videos for a channel clip), so the
 * homepage cost is three images.
 */
function HomeVideoCard({ video }: { video: HomeVideo }) {
  const videoId = getYouTubeVideoId(video.url);
  const thumbnail = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;

  const media = (
    <div className="relative aspect-video overflow-hidden bg-primary/10">
      {/* Decorative: the card's own title/eyebrow/CTA text already labels the
          link, so a repeated "<title> 影片預覽" alt would be announced twice. */}
      <AppImage
        src={thumbnail}
        alt=""
        width={480}
        height={360}
        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
      {/* The ring pulses only while hovered, so the affordance animates in
          response to the pointer instead of drawing the eye unprompted. */}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-background/90 text-primary shadow-lg transition-transform duration-300 group-hover:scale-110">
          {/* No transition-opacity here: animate-ping's own keyframes drive
              opacity, and a transition on the same property fought it for the
              first 300ms, producing a flash instead of a smooth pulse. */}
          <span className="absolute inset-0 rounded-full ring-2 ring-background/70 opacity-0 group-hover:animate-ping group-hover:opacity-100" />
          <PlayCircle className="h-8 w-8" />
        </span>
      </span>
    </div>
  );

  const body = (
    <div className="p-5">
      <p className="text-xs font-semibold text-coral">{video.eyebrow}</p>
      <h3 className="mt-2 line-clamp-2 text-base font-semibold text-primary">{video.title}</h3>
      <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
        {video.listingNo ? "睇片睇樓" : "觀看影片"}
        <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
      </span>
    </div>
  );

  const cardClass =
    "group block overflow-hidden rounded-xl border border-border bg-card shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-elegant focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  if (video.listingNo) {
    return (
      <Link to="/property/$listingNo" params={{ listingNo: video.listingNo }} className={cardClass}>
        {media}
        {body}
      </Link>
    );
  }

  // A curated channel video has no listing to deep-link to. Point straight at
  // the video itself (same pattern /videos' own VideoFrame fallback uses)
  // instead of a bare /videos link that would put every such card at the same
  // undifferentiated destination.
  return (
    <a href={video.url} target="_blank" rel="noopener noreferrer" className={cardClass}>
      {media}
      {body}
    </a>
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
  images?: string[] | null;
  video_url?: string | null;
  // Already selected by `listingColumns` / carried on `FeaturedProperty` --
  // surfaced here so the featured card can show a freshness stamp the same
  // way listings.tsx's ListingCard does (gated on source_site: only imported
  // listings get a meaningfully maintained last_seen_at).
  last_seen_at?: string | null;
  source_site?: string | null;
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

  // The card used to render a bare gradient and ignore `images` entirely, so
  // listings with real photography still looked like placeholders. Showing the
  // cover shot with a media count is the credibility win; the gradient stays as
  // the fallback for listings the MLS import left without photos.
  const photoCount = property.images?.length ?? 0;
  // AppImage's own internal onError/fallback handling now covers what
  // coverFailed used to do locally -- see AppImage.tsx.
  const cover = property.images?.[0] ?? null;
  // `video_url` is shared with VR-tour links (matterport/kuula) elsewhere in
  // this codebase (see property.$listingNo.tsx's isVrUrl) -- a bare truthiness
  // check badged those as "影片" too, promising a video tab the listing page
  // doesn't have.
  const hasVideo = isYouTubeVideoUrl(property.video_url);

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-elegant">
      {/* Decorative/mouse-only: the title link below is the sole keyboard and
          screen-reader path to the listing, so this photo doesn't need (and
          shouldn't have) its own focus stop or announced name. */}
      <Link
        to="/property/$listingNo"
        params={{ listingNo: property.listing_no }}
        tabIndex={-1}
        aria-hidden="true"
        className="relative block h-48 overflow-hidden bg-gradient-to-br from-primary/40 to-primary"
      >
        <AppImage
          src={cover}
          alt={`${property.title_zh} 相片`}
          width={640}
          height={480}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          // No cover (MLS-imported listings can lack photos) or a runtime error
          // must let the parent Link's gradient-to-br placeholder and Building2
          // icon show through -- AppImage's opaque default fallback would
          // otherwise paint over both.
          fallback={<></>}
        />
        {/* Scrim strong enough to hold text contrast regardless of how bright
            the underlying photo is. */}
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/75 to-transparent" />
        <div className="absolute left-3 top-3 flex gap-2">
          <span className="rounded-full bg-foreground/90 px-2.5 py-1 text-[11px] font-semibold text-background">
            {isRent ? "租 Rent" : "售 Sale"}
          </span>
          {/* Opaque: this used to be bg-card/90 over a fixed gradient, but now
              sits over an arbitrary photo, where the 90%-alpha fill could drop
              its contrast below AA on a dark cover. */}
          <span className="rounded-full bg-card px-2.5 py-1 text-[11px] font-semibold text-primary">
            {tag}
          </span>
        </div>
        {cover || photoCount > 0 || hasVideo ? null : (
          <Building2 className="absolute right-3 top-3 h-7 w-7 text-primary-foreground/30" />
        )}
        {/* Media affordance: badges are always visible (they carry the count, so
            they must survive touch, where there is no hover), and only the
            "查看更多" hint animates in on hover. */}
        {photoCount > 0 || hasVideo ? (
          <div className="absolute right-3 top-3 flex items-center gap-1.5">
            {photoCount > 0 ? (
              <Badge
                variant="outline"
                className="gap-1 rounded-full border-transparent bg-foreground/80 px-2 py-1 text-[11px] font-semibold text-background backdrop-blur"
              >
                <Camera className="h-3 w-3" aria-hidden="true" />
                {photoCount}
              </Badge>
            ) : null}
            {hasVideo ? (
              <Badge
                variant="outline"
                className="gap-1 rounded-full border-transparent bg-coral px-2 py-1 text-[11px] font-semibold text-coral-foreground"
              >
                <Video className="h-3 w-3" aria-hidden="true" />
                影片
              </Badge>
            ) : null}
          </div>
        ) : null}
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2 text-primary-foreground">
          <p className="text-xs">{property.estates?.name_zh ?? ""}</p>
          {photoCount > 1 || hasVideo ? (
            <span className="text-[11px] font-medium">
              查看更多{photoCount > 1 ? "相片" : ""}
              {photoCount > 1 && hasVideo ? "、" : ""}
              {hasVideo ? "影片" : ""}
            </span>
          ) : null}
        </div>
      </Link>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-base font-semibold text-primary">
          <Link
            to="/property/$listingNo"
            params={{ listingNo: property.listing_no }}
            className="rounded-sm underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {property.title_zh}
          </Link>
        </h3>
        {property.source_site && (
          <FreshnessStamp updatedAt={property.last_seen_at} className="mt-1 block" />
        )}
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-coral">{priceDisplay}</span>
          <span className="text-xs text-muted-foreground">
            {/* `psf ?` guards the raw number, not formatHkd's return -- a negative
                property.price (no DB CHECK stops one; see 872c338/f9eeeb2) would
                make formatHkd(psf) return null, rendering the literal text "null". */}
            {isRent ? "/月" : psf ? ` · 實呎 ${formatHkd(psf)}` : ""}
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
