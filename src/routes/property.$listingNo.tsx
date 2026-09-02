import { useState } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { toast } from "sonner";
import {
  MapPin,
  Bed,
  Bath,
  Maximize,
  Calendar,
  Building2,
  Heart,
  Share2,
  Image as ImageIcon,
  Video,
  Box,
  Map as MapIcon,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  TrainFront,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SITE_URL, canonicalLink } from "@/content/seo";
import {
  fetchPropertyByListingNo,
  fetchSimilarListings,
  fetchEstateTransactions,
  type SimilarListing,
  type EstateTransaction,
} from "@/lib/queries";
import { createWebsiteInquiry } from "@/lib/neon/admin-data";
import { fetchNeonBranches } from "@/lib/neon/public-data";
import type { NeonBranchRecord } from "@/lib/neon/public-data.types";
import {
  formatArea,
  formatHkd,
  formatHkDate,
  formatSaleDisplay,
  sanitizeListingText,
} from "@/lib/format";
import { AppImage } from "@/components/media/AppImage";
import { Container } from "@/components/layout/Container";
import { FreshnessStamp } from "@/components/layout/FreshnessStamp";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import {
  PropertyDecisionActions,
  PropertyMobileContactSummary,
} from "@/components/property/PropertyDecisionActions";
import { PropertyMediaContactLayout } from "@/components/property/property-media-contact-layout.js";
import {
  buildPropertyInquiryPayload,
  getPropertyDecision,
} from "@/components/property/property-decision.js";
import { SITE_CONTACT, resolvePropertyBranchContact } from "@/config/site";
import { findCastlePeakRoadSegmentByDistrictSlug } from "@/content/castle-peak-road";
import { jsonLdScript } from "@/lib/schema";
import { shareUrl } from "@/lib/share";
import { useFavourite } from "@/lib/saved-listings";
import { buildContext, track, useTrackPageView } from "@/lib/analytics/events";

type PropertyDetail = NonNullable<Awaited<ReturnType<typeof fetchPropertyByListingNo>>>;
type PropertyHeadData = {
  property?: Pick<
    PropertyDetail,
    "listing_no" | "title_zh" | "deal_type" | "rent" | "price" | "description" | "images" | "status"
  >;
};

// `active` renders normally. `sold`/`rented` is a distinct "still real, no
// longer available" state -- basic info stays visible but the enquiry
// form/CTAs are replaced (see PropertyUnavailableNotice below) and the page
// is noindex'd. Every other status (offline/inactive/draft -- "never really
// public" or "pulled") keeps today's exact behavior: the loader throws
// notFound() and the generic notFoundComponent renders, same as a listing_no
// that doesn't exist at all.
const UNAVAILABLE_STATUSES = new Set(["sold", "rented"]);

function formatDealPrice(isRent: boolean, rent: number | null, price: number | null): string {
  if (isRent) {
    const rentDisplay = formatHkd(rent);
    return rentDisplay ? `${rentDisplay} / 月` : "—";
  }
  return formatSaleDisplay(price) ?? "—";
}

export const Route = createFileRoute("/property/$listingNo")({
  loader: async ({ params }) => {
    const property = await fetchPropertyByListingNo(params.listingNo);
    // offline/inactive/draft never was, or no longer is, genuinely public --
    // treat identically to a listing_no that doesn't exist. sold/rented falls
    // through to the normal branch below and gets its own real state.
    if (!property || (!UNAVAILABLE_STATUSES.has(property.status) && property.status !== "active")) {
      throw notFound();
    }
    const [similar, txns, branches] = await Promise.all([
      property.estate_id
        ? fetchSimilarListings(property.estate_id, property.deal_type, property.id, 4)
        : Promise.resolve([] as SimilarListing[]),
      property.estate_id
        ? fetchEstateTransactions(property.estate_id, 8)
        : Promise.resolve([] as EstateTransaction[]),
      // Non-essential: resolves property.profiles' branch_id to a real
      // branches.name (see agentBranchName in src/lib/agent-directory.ts) --
      // a failed fetch just falls back to the agent's free-text `branch`,
      // exactly like before this table existed.
      fetchNeonBranches().catch(() => [] as NeonBranchRecord[]),
    ]);
    return { property, similar, txns, branches };
  },
  head: ({ loaderData }) => {
    const p = (loaderData as PropertyHeadData | undefined)?.property;
    if (!p) return { meta: [{ title: "放盤｜晉誠地產" }] };
    const canonical = canonicalLink(`/property/${p.listing_no}`);
    const rentDisplay = formatHkd(Number(p.rent));
    const saleDisplay = formatSaleDisplay(Number(p.price));
    const priceStr =
      p.deal_type === "rent"
        ? rentDisplay
          ? `月租 ${rentDisplay}`
          : ""
        : saleDisplay
          ? `售 ${saleDisplay}`
          : "";
    const safeTitle = sanitizeListingText(p.title_zh) ?? p.title_zh;
    const title = `${safeTitle}｜${priceStr}｜晉誠地產`;
    const safeDescription = sanitizeListingText(p.description);
    const desc = (safeDescription ?? "").slice(0, 150) || `${safeTitle} ${priceStr}`;
    const img = p.images?.[0];
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        ...(img ? [{ property: "og:image", content: img }] : []),
        ...(img ? [{ name: "twitter:image", content: img }] : []),
        // A sold/rented listing is a permanently-gone page kept live for
        // trust/continuity, not something worth ranking -- an indexed page
        // that will never transact again is exactly the thin/stale content
        // DR-9 flags elsewhere. offline/inactive/draft never render this
        // head fn at all (loader 404s first), so no branch needed for those.
        ...(UNAVAILABLE_STATUSES.has(p.status)
          ? [{ name: "robots", content: "noindex,follow" }]
          : []),
      ],
      links: [canonical],
    };
  },
  errorComponent: PropertyErrorComponent,
  notFoundComponent: () => (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-2xl font-bold">放盤未找到</h1>
      <p className="mt-2 text-sm text-muted-foreground">該盤源可能已售出或下架。</p>
      <Link to="/" className="mt-4 inline-block text-primary underline">
        返回首頁
      </Link>
    </div>
  ),
  component: PropertyPage,
});

function PropertyErrorComponent() {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-2xl font-bold">載入失敗</h1>
      <p role="alert" className="mt-2 text-sm text-muted-foreground">
        暫時未能載入樓盤資料，請稍後再試。
      </p>
      <Button className="mt-6" onClick={() => router.invalidate()}>
        重試
      </Button>
    </div>
  );
}

const inquirySchema = z.object({
  name: z.string().trim().min(1, "請輸入姓名").max(120, "姓名過長"),
  phone: z
    .string()
    .trim()
    .min(8, "請輸入有效電話")
    .max(30, "電話過長")
    .regex(/^[\d+\-\s()]+$/, "電話格式不正確"),
  email: z.string().trim().max(255).email("電郵格式不正確").optional().or(z.literal("")),
  message: z.string().trim().max(1000, "訊息過長").optional(),
});

function isVrUrl(u?: string | null) {
  if (!u) return false;
  return /vr|kuula|matterport|panor|360|my\.matterport/i.test(u);
}

function toEmbed(u: string) {
  // YouTube
  const yt = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  return u;
}

function PropertyPage() {
  const { property, similar, txns, branches } = Route.useLoaderData() as {
    property: PropertyDetail;
    similar: SimilarListing[];
    txns: EstateTransaction[];
    branches: NeonBranchRecord[];
  };
  // Imported listing text can arrive malformed (raw CSV artifacts, stray
  // quotes, exact "NaN"/"null"/"$0" tokens) -- sanitize once here and reuse
  // the sanitized values everywhere below rather than re-sanitizing at every
  // interpolation site. Title falls back to the raw value so a listing never
  // shows a fully blank title; description/address can legitimately end up
  // null and are guarded at their render sites instead.
  const safeTitle = sanitizeListingText(property.title_zh) ?? property.title_zh;
  const safeDescription = sanitizeListingText(property.description);
  const safeAddress = sanitizeListingText(property.address);

  const images: string[] = property.images?.length
    ? property.images
    : ["https://placehold.co/1200x800/e5e7eb/64748b?text=No+Image"];
  const [activeImg, setActiveImg] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [consentWhatsapp, setConsentWhatsapp] = useState(false);
  const { favourited, toggle: toggleFavourited } = useFavourite(property.listing_no);
  // The breadcrumb shows the short id the title already uses (#C024131); the
  // full "C024131-6714584-S" wrapped onto a second line on phones and is
  // repeated verbatim in the badge row just below.
  const shortListingNo = property.listing_no.split("-")[0] || property.listing_no;

  const isRent = property.deal_type === "rent";
  const priceLabel = formatDealPrice(isRent, Number(property.rent), Number(property.price));
  const psf =
    property.price && property.saleable_area
      ? Math.round(Number(property.price) / property.saleable_area)
      : null;
  const grossPsf =
    property.price && property.gross_area
      ? Math.round(Number(property.price) / property.gross_area)
      : null;
  // WhatsApp/mortgage-widget price, deal-aware: property.price is only ever set
  // on sale rows and property.rent only on rent rows (see normalize-old-site.mjs),
  // so a rental's enquiry prefill needs property.rent, not the always-null
  // property.price. getPropertyDecision still gates hasMortgagePrice on
  // dealType !== "rent", so passing the rent amount here doesn't turn on the
  // mortgage widget for rentals.
  const dealPrice = isRent ? property.rent : property.price;

  const agent = property.profiles;
  const estate = property.estates;
  const decision = getPropertyDecision({ dealType: property.deal_type, price: property.price });
  const branchContact = resolvePropertyBranchContact({
    estateSlug: estate?.slug,
    districtSlug: estate?.district_slug ?? property.district_slug,
  });
  // Nearby transport: reuses the corridor content's already-curated copy, keyed
  // by segment rather than district_slug directly (a segment can absorb more
  // than one district_slug -- see findCastlePeakRoadSegmentByDistrictSlug's own
  // comment). Renders nothing (not a placeholder) when the listing's district
  // isn't part of a corridor segment.
  const transportSegment = findCastlePeakRoadSegmentByDistrictSlug(
    estate?.district_slug ?? property.district_slug,
  );

  // Narrowed values rather than booleans: TypeScript cannot carry a
  // `!!property.video_url` guard through a separate const into the JSX below,
  // so the nullable field was being passed straight into src/toEmbed.
  const videoUrl = property.video_url && !isVrUrl(property.video_url) ? property.video_url : null;
  const vrUrl = property.video_url && isVrUrl(property.video_url) ? property.video_url : null;
  const floorplanUrl = property.floorplan_url ?? null;
  const hasVideo = videoUrl !== null;
  const hasVR = vrUrl !== null;
  const hasFloorplan = floorplanUrl !== null;
  const hasMap = !!(estate?.lat && estate?.lng) || !!property.address;

  async function handleShare() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    await shareUrl(safeTitle, url);
    track(
      { name: "listing_share", payload: { listingNo: property.listing_no } },
      buildContext({ listingNo: property.listing_no }),
    );
  }

  useTrackPageView(
    () => ({
      event: {
        name: "listing_view",
        payload: { listingNo: property.listing_no, dealType: property.deal_type },
      },
      context: buildContext({ listingNo: property.listing_no, estateSlug: estate?.slug }),
    }),
    [property.listing_no],
  );

  // Cycles through ALL images (not just the visible thumbnails), wrapping at
  // both ends -- both the arrow buttons and Left/Right keys funnel through
  // this so the main viewer and the thumbnail strip stay in sync.
  function stepImage(delta: number) {
    setActiveImg((i) => (i + delta + images.length) % images.length);
  }

  function handleGalleryKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (images.length <= 1) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      stepImage(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      stepImage(1);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw = {
      name: String(fd.get("name") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      email: String(fd.get("email") ?? ""),
      message: String(fd.get("message") ?? ""),
    };
    const parsed = inquirySchema.safeParse(raw);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "請檢查輸入");
      return;
    }
    setSubmitting(true);
    const result = await createWebsiteInquiry({
      data: buildPropertyInquiryPayload({
        form: {
          name: parsed.data.name,
          phone: parsed.data.phone,
          email: parsed.data.email || "",
          message: parsed.data.message || "",
        },
        propertyId: property.id,
        consentWhatsapp,
      }),
    }).catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));
    setSubmitting(false);
    if ("error" in result && result.error) {
      toast.error("提交失敗：" + result.error);
      return;
    }
    toast.success("已收到查詢，經紀會盡快與你聯絡。");
    (e.target as HTMLFormElement).reset();
    setConsentWhatsapp(false);
  }

  function focusInquiry() {
    const element = document.getElementById("name");
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => element?.focus(), 400);
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "RealEstateListing",
        name: safeTitle,
        description: safeDescription ?? undefined,
        url: `${SITE_URL}/property/${property.listing_no}`,
        image: images,
        datePosted: property.created_at,
        offers: {
          "@type": "Offer",
          price: isRent ? property.rent : property.price,
          priceCurrency: "HKD",
          availability: "https://schema.org/InStock",
        },
      },
      {
        "@type": "Residence",
        name: safeTitle,
        address: {
          "@type": "PostalAddress",
          streetAddress: safeAddress ?? undefined,
          addressLocality: estate?.name_zh ?? undefined,
          addressRegion: "Hong Kong",
        },
        floorSize: property.saleable_area
          ? { "@type": "QuantitativeValue", value: property.saleable_area, unitCode: "FTK" }
          : undefined,
        numberOfRooms: property.bedrooms ?? undefined,
        numberOfBathroomsTotal: property.bathrooms ?? undefined,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "首頁", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "搜尋放盤", item: `${SITE_URL}/listings` },
          ...(estate
            ? [
                {
                  "@type": "ListItem",
                  position: 3,
                  name: estate.name_zh,
                  item: `${SITE_URL}/estate/${estate.slug}`,
                },
              ]
            : []),
          {
            "@type": "ListItem",
            position: estate ? 4 : 3,
            name: safeTitle,
            item: `${SITE_URL}/property/${property.listing_no}`,
          },
        ],
      },
    ],
  };

  const isUnavailable = UNAVAILABLE_STATUSES.has(property.status);
  const unavailableLabel = property.status === "rented" ? "已租出" : "已售出";

  const mapSrc =
    estate?.lat && estate?.lng
      ? `https://www.google.com/maps?q=${estate.lat},${estate.lng}&z=16&output=embed`
      : property.address
        ? `https://www.google.com/maps?q=${encodeURIComponent(property.address)}&z=16&output=embed`
        : null;

  return (
    <Container className="py-8 pb-32 lg:pb-8">
      {/* Breadcrumb + actions */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Breadcrumbs
          items={[
            { label: "首頁", href: "/" },
            { label: "搜尋放盤", href: "/listings" },
            ...(estate ? [{ label: estate.name_zh, href: `/estate/${estate.slug}` }] : []),
            { label: `編號 ${shortListingNo}` },
          ]}
        />
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Button variant="outline" size="sm" onClick={toggleFavourited} aria-pressed={favourited}>
            <Heart className={`mr-1.5 h-3.5 w-3.5 ${favourited ? "fill-coral text-coral" : ""}`} />
            {favourited ? "已加入心水" : "加入心水"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleShare}>
            <Share2 className="mr-1.5 h-3.5 w-3.5" />
            分享
          </Button>
        </div>
      </div>

      <section aria-labelledby="property-title">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isRent ? "secondary" : "default"}>{isRent ? "租盤" : "售盤"}</Badge>
          {property.featured ? <Badge variant="outline">精選</Badge> : null}
          {isUnavailable ? <Badge variant="destructive">{unavailableLabel}</Badge> : null}
          <span className="text-xs text-muted-foreground">編號 {property.listing_no}</span>
          <FreshnessStamp updatedAt={property.updated_at} />
        </div>
        <h1 id="property-title" className="mt-3 text-3xl font-bold tracking-tight">
          {safeTitle}
        </h1>
        {safeAddress ? (
          <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4" />
            {safeAddress}
          </p>
        ) : null}
        <p className="mt-4 text-3xl font-bold text-primary">
          {priceLabel}
          {/* psf/grossPsf guard the raw value, not formatHkd's return -- a negative
              property.price (no DB CHECK stops one; see 872c338/f9eeeb2) makes
              formatHkd return null, which React drops silently as a bare JSX child,
              leaving a dangling "實呎 "/"建呎 " label with no number (not literal
              "null" text, unlike index.tsx's PropertyCard, commit bd9f1bf). */}
          {psf && !isRent ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              實呎 {formatHkd(psf)}
            </span>
          ) : null}
          {grossPsf && !isRent ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              · 建呎 {formatHkd(grossPsf)}
            </span>
          ) : null}
        </p>

        <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-y py-5 sm:grid-cols-4">
          <Spec
            icon={<Maximize className="h-4 w-4" />}
            label="實用面積"
            value={property.saleable_area ? `${property.saleable_area} 呎` : "—"}
          />
          <Spec icon={<Bed className="h-4 w-4" />} label="房間" value={property.bedrooms ?? "—"} />
          <Spec
            icon={<Bath className="h-4 w-4" />}
            label="浴室"
            value={property.bathrooms ?? "—"}
          />
          <Spec
            icon={<Building2 className="h-4 w-4" />}
            label="樓層"
            value={property.floor ?? "—"}
          />
          <Spec label="建築面積" value={property.gross_area ? `${property.gross_area} 呎` : "—"} />
          <Spec label="座向" value={property.orientation ?? "—"} />
          <Spec label="管理費" value={formatHkd(property.management_fee) ?? "—"} />
          <Spec
            icon={<Calendar className="h-4 w-4" />}
            label="入伙年份"
            value={estate?.year_completed ?? "—"}
          />
        </div>
      </section>

      <PropertyMediaContactLayout
        media={
          <Tabs defaultValue="photos">
            <TabsList className="flex h-auto flex-wrap justify-start">
              <TabsTrigger value="photos">
                <ImageIcon className="mr-1.5 h-4 w-4" />
                相片
              </TabsTrigger>
              {hasVideo && (
                <TabsTrigger value="video">
                  <Video className="mr-1.5 h-4 w-4" />
                  影片
                </TabsTrigger>
              )}
              {hasVR && (
                <TabsTrigger value="vr">
                  <Box className="mr-1.5 h-4 w-4" />
                  VR睇樓
                </TabsTrigger>
              )}
              {hasFloorplan && (
                <TabsTrigger value="floorplan">
                  <LayoutGrid className="mr-1.5 h-4 w-4" />
                  平面圖
                </TabsTrigger>
              )}
              {hasMap && (
                <TabsTrigger value="map">
                  <MapIcon className="mr-1.5 h-4 w-4" />
                  地圖
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="photos" onKeyDown={handleGalleryKeyDown}>
              <div
                className="relative overflow-hidden rounded-lg border bg-muted"
                tabIndex={images.length > 1 ? 0 : undefined}
                role={images.length > 1 ? "group" : undefined}
                aria-label={
                  images.length > 1
                    ? `${safeTitle} 相片 ${activeImg + 1} / ${images.length}，可用左右方向鍵切換`
                    : undefined
                }
              >
                <AppImage
                  src={images[activeImg]}
                  alt={safeTitle}
                  width={1200}
                  height={900}
                  className="aspect-[4/3] w-full object-cover"
                  loading="eager"
                  fetchPriority="high"
                />
                {images.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => stepImage(-1)}
                      aria-label="上一張相片"
                      className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-1.5 text-foreground shadow hover:bg-background"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => stepImage(1)}
                      aria-label="下一張相片"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-1.5 text-foreground shadow hover:bg-background"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                    <span className="absolute bottom-2 right-2 rounded bg-background/80 px-1.5 py-0.5 text-xs text-foreground">
                      {activeImg + 1} / {images.length}
                    </span>
                  </>
                )}
              </div>
              {images.length > 1 && (
                // Every image gets a thumbnail here (no slice/cap) -- with
                // more than 5 photos this scrolls horizontally instead of
                // silently dropping the rest, which used to leave them
                // unreachable entirely.
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {images.map((src, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setActiveImg(i)}
                      aria-current={i === activeImg ? "true" : undefined}
                      aria-label={`檢視第 ${i + 1} 張相片`}
                      className={`aspect-[4/3] w-20 flex-shrink-0 overflow-hidden rounded-md border-2 ${
                        i === activeImg ? "border-primary" : "border-transparent"
                      }`}
                    >
                      <AppImage
                        src={src}
                        alt={`${safeTitle} ${i + 1}`}
                        width={200}
                        height={150}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </TabsContent>

            {videoUrl && (
              <TabsContent value="video">
                <div className="aspect-video overflow-hidden rounded-lg border bg-muted">
                  <iframe
                    src={toEmbed(videoUrl)}
                    title="物業影片"
                    className="h-full w-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              </TabsContent>
            )}

            {vrUrl && (
              <TabsContent value="vr">
                <div className="aspect-video overflow-hidden rounded-lg border bg-muted">
                  <iframe
                    src={vrUrl}
                    title="VR睇樓"
                    className="h-full w-full"
                    allow="xr-spatial-tracking; gyroscope; accelerometer; fullscreen"
                    allowFullScreen
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">滑動或拖曳以360°觀看單位內部。</p>
              </TabsContent>
            )}

            {floorplanUrl && (
              <TabsContent value="floorplan">
                <div className="overflow-hidden rounded-lg border bg-muted">
                  <AppImage
                    src={floorplanUrl}
                    alt={`${safeTitle} 平面圖`}
                    width={1200}
                    height={900}
                    className="w-full object-contain"
                  />
                </div>
              </TabsContent>
            )}

            {hasMap && mapSrc && (
              <TabsContent value="map">
                <div className="aspect-video overflow-hidden rounded-lg border bg-muted">
                  <iframe
                    src={mapSrc}
                    title="位置地圖"
                    className="h-full w-full"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                </div>
              </TabsContent>
            )}
          </Tabs>
        }
        mobileContact={
          isUnavailable ? (
            <PropertyUnavailableNotice
              label={unavailableLabel}
              dealType={property.deal_type}
              estateSlug={estate?.slug}
            />
          ) : (
            <PropertyMobileContactSummary
              agent={agent}
              branchContact={branchContact}
              branches={branches}
              fallbackWhatsapp={SITE_CONTACT.whatsappPhone}
              listingNo={property.listing_no}
              title={safeTitle}
              dealType={property.deal_type}
              price={dealPrice}
              onInquiry={focusInquiry}
            />
          )
        }
        details={
          <>
            {/* Description -- always renders a fallback so a malformed or
                missing description never leaves a bare heading or the
                literal word "null"/"NaN". */}
            <section className="mt-6">
              <h2 className="text-xl font-semibold">物業描述</h2>
              <p className="mt-3 whitespace-pre-line text-muted-foreground">
                {safeDescription ?? "暫無詳細描述"}
              </p>
            </section>

            {/* Features */}
            {(property.features?.length ?? 0) > 0 && (
              <section className="mt-6">
                <h2 className="text-xl font-semibold">物業特點</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(property.features ?? []).map((f: string) => (
                    <Badge key={f} variant="secondary">
                      {f}
                    </Badge>
                  ))}
                </div>
              </section>
            )}

            {/* Estate info */}
            {estate && (
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle as="h2" className="text-base">
                    屋苑資料
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Spec label="屋苑" value={estate.name_zh} />
                    <Spec label="發展商" value={estate.developer ?? "—"} />
                    <Spec label="入伙年份" value={estate.year_completed ?? "—"} />
                    <Spec label="總單位" value={estate.total_units ?? "—"} />
                  </div>
                  <div className="mt-4">
                    <Link
                      to="/estate/$slug"
                      params={{ slug: estate.slug }}
                      className="text-sm text-primary underline"
                    >
                      查看屋苑詳情 →
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Nearby transport -- omitted entirely (not a placeholder) when the
                listing's district isn't part of a known corridor segment. */}
            {transportSegment && (
              <Card className="mt-6" data-property-transport-card>
                <CardHeader>
                  <CardTitle as="h2" className="flex items-center gap-2 text-base">
                    <TrainFront className="h-4 w-4" />
                    附近交通
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-7 text-muted-foreground">
                    {transportSegment.transport}
                  </p>
                  <div className="mt-4">
                    <Link
                      to="/castle-peak-road/$segment"
                      params={{ segment: transportSegment.slug }}
                      className="text-sm text-primary underline"
                    >
                      查看{transportSegment.nameZh}交通及生活資訊 →
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Recent transactions */}
            {txns.length > 0 && (
              <section className="mt-6">
                <h2 className="text-xl font-semibold">屋苑近期成交</h2>
                {/* overflow-x-auto (not overflow-hidden): five columns do not fit a
                    phone, and clipping hid the price/實呎 columns entirely. */}
                <div className="mt-3 overflow-x-auto rounded-lg border">
                  <Table className="min-w-[520px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>成交日期</TableHead>
                        <TableHead>單位</TableHead>
                        <TableHead className="text-right">實用面積</TableHead>
                        <TableHead className="text-right">成交價</TableHead>
                        <TableHead className="text-right">實呎</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {txns.map((t, i) => (
                        <TableRow key={i}>
                          <TableCell>{formatHkDate(t.deal_date) ?? "—"}</TableCell>
                          <TableCell>{t.unit ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            {formatArea(t.saleable_area) ?? "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatSaleDisplay(Number(t.price)) ?? "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatHkd(Number(t.saleable_psf)) ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            )}

            {/* Similar listings */}
            {similar.length > 0 && (
              <section className="mt-6">
                <h2 className="text-xl font-semibold">同類放盤</h2>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  {similar.map((s) => (
                    <SimilarCard key={s.id} listing={s} />
                  ))}
                </div>
              </section>
            )}

            {/* Disclaimer */}
            <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
              免責聲明：以上資料只供參考，實際以業主提供及現場為準。本公司不會就資料的準確性、完整性負責。圖片可能經美化處理，買家或租客應親身核實所有資料。
            </p>
          </>
        }
        sidebar={
          isUnavailable ? (
            <PropertyUnavailableNotice
              label={unavailableLabel}
              dealType={property.deal_type}
              estateSlug={estate?.slug}
            />
          ) : (
            <>
              <PropertyDecisionActions
                agent={agent}
                branchContact={branchContact}
                branches={branches}
                fallbackWhatsapp={SITE_CONTACT.whatsappPhone}
                listingNo={property.listing_no}
                title={safeTitle}
                dealType={property.deal_type}
                price={dealPrice}
                onInquiry={focusInquiry}
              />

              <Card className="mt-4">
                <CardHeader>
                  <CardTitle className="text-base">{decision.inquiryLabel}</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-3">
                    <div>
                      <Label htmlFor="name">姓名 *</Label>
                      <Input id="name" name="name" required maxLength={120} placeholder="陳先生" />
                    </div>
                    <div>
                      <Label htmlFor="phone">電話 *</Label>
                      <Input
                        id="phone"
                        name="phone"
                        required
                        type="tel"
                        maxLength={30}
                        placeholder="9123 4567"
                      />
                    </div>
                    <div>
                      <Label htmlFor="email">電郵</Label>
                      <Input id="email" name="email" type="email" maxLength={255} />
                    </div>
                    <div>
                      <Label htmlFor="message">訊息</Label>
                      <Textarea
                        id="message"
                        name="message"
                        maxLength={1000}
                        rows={3}
                        placeholder={`想查詢編號 ${property.listing_no}`}
                      />
                    </div>
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="consentWhatsapp"
                        checked={consentWhatsapp}
                        onCheckedChange={(checked) => setConsentWhatsapp(checked === true)}
                        className="mt-0.5"
                      />
                      <Label
                        htmlFor="consentWhatsapp"
                        className="text-xs font-normal leading-snug text-muted-foreground"
                      >
                        我同意透過 WhatsApp 接收樓盤資訊及推廣訊息。
                      </Label>
                    </div>
                    <Button type="submit" className="w-full" disabled={submitting}>
                      {submitting ? "提交中…" : "提交查詢"}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      按提交即表示同意我們透過上述聯絡方式回覆查詢。
                    </p>
                  </form>
                </CardContent>
              </Card>
            </>
          )
        }
      />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
    </Container>
  );
}

// Renders in place of the enquiry form/contact CTAs (both the desktop
// sidebar and the mobile summary slot) once a listing is sold/rented -- the
// listing's own photo/title/address stay visible elsewhere on the page
// (builds trust vs. a blank 404), but there is nothing left to enquire
// about, so this points the visitor at similar still-active listings
// instead. The "同類放盤" section further down the page (fetchSimilarListings,
// still called for non-active properties since estate_id/deal_type are
// known regardless of status) covers the same listings inline; this is the
// above-the-fold call to action.
function PropertyUnavailableNotice({
  label,
  dealType,
  estateSlug,
}: {
  label: string;
  dealType: "sale" | "rent";
  estateSlug?: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          呢個盤源已經{label}，暫時未能透過此頁查詢或預約睇樓，歡迎瀏覽同類放盤。
        </p>
        <Button asChild className="w-full">
          <Link
            to="/listings"
            search={{ deal: dealType, estate: estateSlug ?? undefined, page: 1 }}
          >
            瀏覽同類放盤
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function Spec({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

function SimilarCard({ listing }: { listing: SimilarListing }) {
  const img = listing.images?.[0] ?? "https://placehold.co/600x400/e5e7eb/64748b?text=No+Image";
  const isRent = listing.deal_type === "rent";
  const price = formatDealPrice(isRent, Number(listing.rent), Number(listing.price));
  const safeTitle = sanitizeListingText(listing.title_zh) ?? listing.title_zh;
  return (
    <Link
      to="/property/$listingNo"
      params={{ listingNo: listing.listing_no }}
      className="group block overflow-hidden rounded-lg border transition-shadow hover:shadow-md"
    >
      <div className="aspect-[4/3] overflow-hidden bg-muted">
        <AppImage
          src={img}
          alt={safeTitle}
          width={400}
          height={300}
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
        />
      </div>
      <div className="p-3">
        <p className="line-clamp-1 text-sm font-medium">{safeTitle}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {listing.bedrooms ? `${listing.bedrooms}房 · ` : ""}
          {listing.saleable_area ? `${listing.saleable_area} 呎` : ""}
        </p>
        <p className="mt-1 font-semibold text-primary">{price}</p>
      </div>
    </Link>
  );
}
