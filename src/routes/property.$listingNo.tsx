import { resolveWhatsappLinks } from "@/lib/neon/whatsapp-enquiries";
import {
  resolvePublicWaAction,
  resolveWebsiteActions,
} from "@/lib/whatsapp-enquiries/public-context";
import {
  activePropertyOfferings,
  selectPropertyOffering,
  publicPropertyNo,
  propertyPriceSummary,
  propertyDealLabel,
  publicPropertyTitle,
  verifiedVrTourUrl,
} from "@/lib/property-public";
import { useState } from "react";
import { createFileRoute, Link, notFound, redirect, useRouter } from "@tanstack/react-router";
import { z } from "zod";
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
import { listingOffersSchema, organizationRef, residenceSchema } from "@/lib/schema";
import {
  fetchPropertyByListingNo,
  fetchSimilarListings,
  fetchEstateTransactions,
  type SimilarListing,
  type EstateTransaction,
} from "@/lib/queries";
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
import { PropertyInquiryForm } from "@/components/property/PropertyInquiryForm";
import { PropertyMediaContactLayout } from "@/components/property/property-media-contact-layout.js";
import { getPropertyDecision } from "@/components/property/property-decision.js";
import { SITE_CONTACT, resolvePropertyBranchContact } from "@/config/site";
import { resolveEstateTransport } from "@/content/estate-pages";
import { estatePath } from "@/lib/estate-links";
import { listingSeo } from "@/lib/listing-seo";
import { resolveOldSearchCode } from "@/lib/old-search-code";
import { jsonLdScript } from "@/lib/schema";
import { shareUrl } from "@/lib/share";
import { useFavourite } from "@/lib/saved-listings";
import { buildContext, track, useTrackPageView } from "@/lib/analytics/events";
import { publicPageCacheHeaders } from "@/lib/http/public-cache.js";

type PropertyDetail = NonNullable<Awaited<ReturnType<typeof fetchPropertyByListingNo>>>;
// The head builds its title/description from the listing's own structured
// facts (see src/lib/listing-seo.ts), so it needs the fact columns as well as
// the CMS SEO pair -- all of them already arrive on the row, this only widens
// what the head is allowed to read.
type PropertyHeadData = {
  property?: Pick<
    PropertyDetail,
    | "public_listing_no"
    | "offerings"
    | "listing_no"
    | "title_zh"
    | "deal_type"
    | "rent"
    | "price"
    | "description"
    | "images"
    | "status"
    | "seo_title"
    | "seo_description"
    | "video_url"
    | "estates"
    | "district_slug"
    | "saleable_area"
    | "gross_area"
    | "bedrooms"
    | "bathrooms"
    | "floor"
    | "orientation"
    | "features"
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
  validateSearch: z.object({ deal: z.enum(["sale", "rent"]).optional() }),
  loader: async ({ params }) => {
    const property = await fetchPropertyByListingNo(params.listingNo);
    // Old-site search URLs (/property/b<estate>$) are tried only after the real
    // lookup misses, so a real listing number is never mistaken for one.
    if (!property) {
      const legacy = resolveOldSearchCode(params.listingNo);
      if (legacy) throw redirect({ href: legacy.href, statusCode: legacy.status });
    }
    // offline/inactive/draft never was, or no longer is, genuinely public --
    // treat identically to a listing_no that doesn't exist. sold/rented falls
    // through to the normal branch below and gets its own real state.
    if (!property || (!UNAVAILABLE_STATUSES.has(property.status) && property.status !== "active")) {
      throw notFound();
    }
    if (property.public_listing_no && params.listingNo !== property.public_listing_no) {
      throw redirect({
        to: "/property/$listingNo",
        params: { listingNo: property.public_listing_no },
        statusCode: 301,
        search: (previous) => ({
          ...previous,
          deal:
            previous.deal === "sale" || previous.deal === "rent"
              ? previous.deal
              : params.listingNo.endsWith("-R")
                ? "rent"
                : "sale",
        }),
      });
    }
    const offers = activePropertyOfferings(property)
      .filter(() => publicPropertyNo(property))
      .map((offer) => ({
        propertyId: offer.id,
        publicListingNo: publicPropertyNo(property),
        dealType: offer.deal_type,
        title: sanitizeListingText(publicPropertyTitle(property)) ?? property.title_zh,
      }));
    const [similar, txns, branches, enquiryLinks] = await Promise.all([
      property.estate_id
        ? fetchSimilarListings(property.estate_id, property.deal_type, property.id, 4).catch(
            () => [] as SimilarListing[],
          )
        : Promise.resolve([] as SimilarListing[]),
      property.estate_id
        ? fetchEstateTransactions(property.estate_id, 8).catch(() => [] as EstateTransaction[])
        : Promise.resolve([] as EstateTransaction[]),
      // Non-essential: resolves property.profiles' branch_id to a real
      // branches.name (see agentBranchName in src/lib/agent-directory.ts) --
      // a failed fetch just falls back to the agent's free-text `branch`,
      // exactly like before this table existed.
      fetchNeonBranches().catch(() => [] as NeonBranchRecord[]),
      resolveWhatsappLinks({ data: { offers } }).catch((error) => {
        console.error("WA_TRACKING_RESOLVER_FAILED", error);
        return {
          enabled: false,
          fallbackHref: null,
          links: [],
          actions: resolveWebsiteActions(offers, [], SITE_CONTACT.whatsappPhone).actions,
        };
      }),
    ]);
    return { property, similar, txns, branches, enquiryLinks };
  },
  head: ({ loaderData }) => {
    const p = (loaderData as PropertyHeadData | undefined)?.property;
    // Reached only while the loader is still resolving -- an unknown or pulled
    // listing throws notFound() before head() runs -- but it is still a real
    // rendered head, so it carries a description like every other page.
    if (!p)
      return {
        meta: [
          { title: "放盤｜晉誠地產" },
          {
            name: "description",
            content:
              "深井、汀九及青山公路買樓租樓放盤詳情。實用面積、房數、成交呎價及睇樓預約，WhatsApp 即時查詢。晉誠地產 C-018613。",
          },
        ],
      };
    const canonical = canonicalLink(`/property/${publicPropertyNo(p)}`);
    // The admin CMS collects seo_title/seo_description per listing and nothing
    // populates them for an ingested row, so both strings are assembled from
    // the listing's own facts when they are blank -- a hand-written value still
    // wins, exactly as estate.$slug.tsx does with `estates.seo_title`. See
    // src/lib/listing-seo.ts for why the previous `.slice(0, 150)` of the body
    // copy had to go.
    const { title, description: desc } = listingSeo(p);
    // Scrapers reject a relative og:image outright (see index.tsx); listing
    // photos come from the CMS/blob store and are normally absolute already,
    // but a site-relative path must be absolutised here, not passed through.
    const rawImg = p.images?.[0];
    const img = rawImg ? (rawImg.startsWith("http") ? rawImg : `${SITE_URL}${rawImg}`) : undefined;
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:url", content: canonical.href },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: desc },
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
  headers: (ctx) => publicPageCacheHeaders(ctx, { require: (d) => Boolean(d?.property) }),
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

function toEmbed(u: string) {
  // YouTube
  const yt = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  return u;
}

function PropertyPage() {
  const {
    property: baseProperty,
    similar,
    txns,
    branches,
    enquiryLinks,
  } = Route.useLoaderData() as {
    property: PropertyDetail;
    similar: SimilarListing[];
    txns: EstateTransaction[];
    branches: NeonBranchRecord[];
    enquiryLinks: Awaited<ReturnType<typeof resolveWhatsappLinks>>;
  };
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const selectedDeal = search.deal ?? baseProperty.deal_type;
  const offerings = activePropertyOfferings(baseProperty);
  const selectedOffering = selectPropertyOffering(baseProperty, selectedDeal);
  const property = selectedOffering
    ? { ...baseProperty, ...selectedOffering, description: baseProperty.description }
    : baseProperty;
  // Imported listing text can arrive malformed (raw CSV artifacts, stray
  // quotes, exact "NaN"/"null"/"$0" tokens) -- sanitize once here and reuse
  // the sanitized values everywhere below rather than re-sanitizing at every
  // interpolation site. Title falls back to the raw value so a listing never
  // shows a fully blank title; description/address can legitimately end up
  // null and are guarded at their render sites instead.
  const safeTitle = sanitizeListingText(publicPropertyTitle(property)) ?? property.title_zh;
  const safeDescription = sanitizeListingText(property.description);
  const offeringDescription = sanitizeListingText(selectedOffering?.description);
  const safeOfferingDescription =
    offeringDescription !== safeDescription ? offeringDescription : null;
  const safeAddress = sanitizeListingText(property.address);

  // No third-party "No Image" stub: AppImage renders its branded fallback for
  // a null src, and the JSON-LD below omits `image` rather than claiming a
  // placeholder is a photo of the flat.
  const images: (string | null)[] = property.images?.length ? property.images : [null];
  const realImages = images.filter((src): src is string => Boolean(src));
  const imageVariant = (src: string | null) => (src ? property.image_variants?.[src] : null);
  const [activeImg, setActiveImg] = useState(0);
  const { favourited, toggle: toggleFavourited } = useFavourite(
    publicPropertyNo(property),
    property.listing_aliases,
  );
  // Use the canonical public number consistently in customer-facing surfaces.
  const publicListingNo = publicPropertyNo(property);

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
  // Only a usable slug yields estate links (FX-13 L-05: /estate/null hits).
  const estateHref = estatePath(estate?.slug);
  const estateSlug = estateHref ? estate?.slug : undefined;
  const decision = getPropertyDecision({ dealType: property.deal_type, price: property.price });
  const branchContact = resolvePropertyBranchContact({
    estateSlug,
    districtSlug: estate?.district_slug ?? property.district_slug,
  });
  const transportInfo = estate?.slug ? resolveEstateTransport(estate.slug) : null;
  const vrUrl = verifiedVrTourUrl(property.video_url);
  const videoUrl = property.video_url && !vrUrl ? property.video_url : null;
  const floorplanUrl = property.floorplan_url ?? null;
  const hasVideo = videoUrl !== null;
  const hasVR = vrUrl !== null;
  const hasFloorplan = floorplanUrl !== null;
  const hasMap = !!(estate?.lat && estate?.lng) || !!property.address;

  async function handleShare() {
    const url = `${SITE_URL}/property/${publicPropertyNo(property)}`;
    await shareUrl(safeTitle, url);
    track(
      { name: "listing_share", payload: { listingNo: publicListingNo } },
      buildContext({ listingNo: publicListingNo }),
    );
  }

  useTrackPageView(
    () => ({
      event: {
        name: "listing_view",
        payload: { listingNo: publicListingNo, dealType: property.deal_type },
      },
      context: buildContext({ listingNo: publicListingNo, estateSlug }),
    }),
    [publicListingNo],
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

  function focusInquiry() {
    const element = document.getElementById("name");
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => element?.focus(), 400);
  }

  const propertyUrl = `${SITE_URL}/property/${publicPropertyNo(property)}`;
  const residenceId = `${propertyUrl}#residence`;
  const schemaOffers = listingOffersSchema({
    propertyUrl,
    residenceId,
    offerings,
    fallback: { isRent, price: property.price, rent: property.rent },
  });
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "RealEstateListing",
        "@id": `${propertyUrl}#listing`,
        name: safeTitle,
        description: safeDescription ?? undefined,
        url: propertyUrl,
        mainEntityOfPage: { "@type": "WebPage", "@id": propertyUrl },
        ...(realImages.length ? { image: realImages } : {}),
        datePosted: property.created_at,
        ...(property.updated_at ? { dateModified: property.updated_at } : {}),
        about: { "@id": residenceId },
        offers: schemaOffers,
        provider: organizationRef(),
      },
      residenceSchema({
        residenceId,
        propertyUrl,
        name: safeTitle,
        images: realImages,
        streetAddress: safeAddress,
        districtSlug: estate?.district_slug ?? property.district_slug ?? null,
        estate: estate ? { name_zh: estate.name_zh, lat: estate.lat, lng: estate.lng } : null,
        saleableArea: property.saleable_area,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
      }),
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "首頁", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "搜尋放盤", item: `${SITE_URL}/listings` },
          ...(estate && estateHref
            ? [
                {
                  "@type": "ListItem",
                  position: 3,
                  name: estate.name_zh,
                  item: `${SITE_URL}${estateHref}`,
                },
              ]
            : []),
          {
            "@type": "ListItem",
            position: estateHref ? 4 : 3,
            name: safeTitle,
            item: `${SITE_URL}/property/${publicPropertyNo(property)}`,
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
    <Container className="py-8">
      {/* Breadcrumb + actions */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Breadcrumbs
          items={[
            { label: "首頁", href: "/" },
            { label: "搜尋放盤", href: "/listings" },
            ...(estate && estateHref ? [{ label: estate.name_zh, href: estateHref }] : []),
            { label: publicListingNo ? `編號 ${publicListingNo}` : "樓盤資料待核實" },
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
          <Badge variant={isRent ? "secondary" : "default"}>
            {propertyDealLabel(baseProperty)}
          </Badge>
          {property.featured ? <Badge variant="outline">精選</Badge> : null}
          {isUnavailable ? <Badge variant="destructive">{unavailableLabel}</Badge> : null}
          <span className="text-xs text-muted-foreground">
            物業編號 {publicPropertyNo(property)}
          </span>
          <FreshnessStamp updatedAt={property.updated_at} />
        </div>
        <h1 id="property-title" className="mt-3 text-3xl font-bold">
          {safeTitle}
        </h1>
        {safeAddress ? (
          <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4" />
            {safeAddress}
          </p>
        ) : null}
        {offerings.length > 1 && (
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="選擇買樓或租樓查詢">
            {offerings.map((offer) => (
              <Button
                key={offer.id}
                type="button"
                variant={property.id === offer.id ? "default" : "outline"}
                aria-pressed={property.id === offer.id}
                onClick={() => void navigate({ search: { deal: offer.deal_type }, replace: true })}
              >
                {propertyPriceSummary({ ...offer, offerings: [offer] })}
              </Button>
            ))}
          </div>
        )}
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
                  variantSet={imageVariant(images[activeImg])}
                  alt={safeTitle}
                  width={1200}
                  height={900}
                  sizes="(min-width: 1024px) 800px, 100vw"
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
                        variantSet={imageVariant(src)}
                        alt={`${safeTitle} ${i + 1}`}
                        width={80}
                        height={60}
                        sizes="80px"
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
              enquiryHref={
                enquiryLinks.actions.find((action) => action.propertyId === property.id)?.href
              }
              fallbackWhatsapp={SITE_CONTACT.whatsappPhone}
              listingNo={publicListingNo}
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

            {safeOfferingDescription && (
              <section className="mt-6">
                <h2 className="text-xl font-semibold">
                  {property.deal_type === "rent" ? "出租補充資料" : "出售補充資料"}
                </h2>
                <p className="mt-3 whitespace-pre-line text-muted-foreground">
                  {safeOfferingDescription}
                </p>
              </section>
            )}
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
                  {estatePath(estate.slug) && (
                    <div className="mt-4">
                      <Link
                        to="/estate/$slug"
                        params={{ slug: estate.slug }}
                        className="text-sm text-primary underline"
                      >
                        查看屋苑詳情 →
                      </Link>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Exact estate mapping controls curated corridor copy. Other estates
                receive a neutral guide link while their transport detail is checked. */}
            {transportInfo && (
              <Card className="mt-6" data-property-transport-card>
                <CardHeader>
                  <CardTitle as="h2" className="flex items-center gap-2 text-base">
                    <TrainFront className="h-4 w-4" />
                    附近交通
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-7 text-muted-foreground">{transportInfo.text}</p>
                  <div className="mt-4">
                    <Link
                      to="/castle-peak-road/$segment"
                      params={{ segment: transportInfo.segmentSlug }}
                      className="text-sm text-primary underline"
                    >
                      查看{transportInfo.nameZh}交通及生活資訊 →
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )}

            {!transportInfo && estate?.slug && (
              <Card className="mt-6" data-property-transport-fallback>
                <CardHeader>
                  <CardTitle as="h2" className="flex items-center gap-2 text-base">
                    <TrainFront className="h-4 w-4" />
                    地區交通
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Link
                    to="/castle-peak-road"
                    className="mt-4 inline-block text-sm text-primary underline"
                  >
                    查看地區指南 →
                  </Link>
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
            <p className="mt-8 text-sm leading-relaxed text-muted-foreground">
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
                enquiryHref={
                  enquiryLinks.actions.find((action) => action.propertyId === property.id)?.href
                }
                fallbackWhatsapp={SITE_CONTACT.whatsappPhone}
                listingNo={publicListingNo}
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
                  <PropertyInquiryForm
                    key={property.id}
                    propertyId={property.id}
                    listingNo={publicListingNo}
                  />
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
  const price = propertyPriceSummary(listing);
  const safeTitle = sanitizeListingText(publicPropertyTitle(listing)) ?? listing.title_zh;
  return (
    <Link
      to="/property/$listingNo"
      params={{ listingNo: publicPropertyNo(listing) }}
      search={{ deal: listing.deal_type === "rent" ? "rent" : "sale" }}
      className="group block overflow-hidden rounded-lg border transition-shadow hover:shadow-md"
    >
      <div className="aspect-[4/3] overflow-hidden bg-muted">
        <AppImage
          src={img}
          variantSet={img ? listing.image_variants?.[img] : null}
          sizes="(min-width: 1024px) 260px, 50vw"
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
