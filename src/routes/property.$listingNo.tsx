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
  Share2,
  Image as ImageIcon,
  Video,
  Box,
  Map as MapIcon,
  LayoutGrid,
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
import { formatHkd, formatHkDate, formatSaleDisplay } from "@/lib/format";
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
import { jsonLdScript } from "@/lib/schema";

type PropertyDetail = NonNullable<Awaited<ReturnType<typeof fetchPropertyByListingNo>>>;
type PropertyHeadData = {
  property?: Pick<
    PropertyDetail,
    "listing_no" | "title_zh" | "deal_type" | "rent" | "price" | "description" | "images"
  >;
};

export const Route = createFileRoute("/property/$listingNo")({
  loader: async ({ params }) => {
    const property = await fetchPropertyByListingNo(params.listingNo);
    if (!property) throw notFound();
    const [similar, txns] = await Promise.all([
      property.estate_id
        ? fetchSimilarListings(property.estate_id, property.deal_type, property.id, 4)
        : Promise.resolve([] as SimilarListing[]),
      property.estate_id
        ? fetchEstateTransactions(property.estate_id, 8)
        : Promise.resolve([] as EstateTransaction[]),
    ]);
    return { property, similar, txns };
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
    const title = `${p.title_zh}｜${priceStr}｜晉誠地產`;
    const desc = (p.description ?? "").slice(0, 150) || `${p.title_zh} ${priceStr}`;
    const img = p.images?.[0];
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        ...(img ? [{ property: "og:image", content: img }] : []),
        ...(img ? [{ name: "twitter:image", content: img }] : []),
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
  const { property, similar, txns } = Route.useLoaderData() as {
    property: PropertyDetail;
    similar: SimilarListing[];
    txns: EstateTransaction[];
  };
  const images: string[] = property.images?.length
    ? property.images
    : ["https://placehold.co/1200x800/e5e7eb/64748b?text=No+Image"];
  const [activeImg, setActiveImg] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [consentWhatsapp, setConsentWhatsapp] = useState(false);

  const isRent = property.deal_type === "rent";
  const rentDisplay = formatHkd(Number(property.rent));
  const saleDisplay = formatSaleDisplay(Number(property.price));
  const priceLabel = isRent
    ? rentDisplay
      ? `${rentDisplay} / 月`
      : "—"
    : saleDisplay
      ? saleDisplay
      : "—";
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
    if (navigator.share) {
      try {
        await navigator.share({ title: property.title_zh, url });
      } catch {
        /* user cancelled */
      }
    } else {
      await navigator.clipboard.writeText(url);
      toast.success("已複製連結");
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
        name: property.title_zh,
        description: property.description ?? undefined,
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
        name: property.title_zh,
        address: {
          "@type": "PostalAddress",
          streetAddress: property.address ?? undefined,
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
            name: property.title_zh,
            item: `${SITE_URL}/property/${property.listing_no}`,
          },
        ],
      },
    ],
  };

  const updatedAt = property.updated_at
    ? new Date(property.updated_at).toLocaleDateString("zh-HK")
    : null;

  const mapSrc =
    estate?.lat && estate?.lng
      ? `https://www.google.com/maps?q=${estate.lat},${estate.lng}&z=16&output=embed`
      : property.address
        ? `https://www.google.com/maps?q=${encodeURIComponent(property.address)}&z=16&output=embed`
        : null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 pb-32 lg:pb-8">
      {/* Breadcrumb + actions */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="text-sm text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            首頁
          </Link>
          <span className="mx-2">›</span>
          <Link to="/listings" className="hover:text-foreground">
            搜尋放盤
          </Link>
          <span className="mx-2">›</span>
          {estate ? (
            <>
              <Link
                to="/estate/$slug"
                params={{ slug: estate.slug }}
                className="hover:text-foreground"
              >
                {estate.name_zh}
              </Link>
              <span className="mx-2">›</span>
            </>
          ) : null}
          <span>編號 {property.listing_no}</span>
        </nav>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
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
          <span className="text-xs text-muted-foreground">編號 {property.listing_no}</span>
          {updatedAt ? (
            <span className="text-xs text-muted-foreground">最後更新：{updatedAt}</span>
          ) : null}
        </div>
        <h1 id="property-title" className="mt-3 text-3xl font-bold tracking-tight">
          {property.title_zh}
        </h1>
        {property.address ? (
          <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4" />
            {property.address}
          </p>
        ) : null}
        <p className="mt-4 text-3xl font-bold text-primary">
          {priceLabel}
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
          <Spec
            label="管理費"
            value={
              property.management_fee ? `$${Number(property.management_fee).toLocaleString()}` : "—"
            }
          />
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

            <TabsContent value="photos">
              <div className="overflow-hidden rounded-lg border bg-muted">
                <img
                  src={images[activeImg]}
                  alt={property.title_zh}
                  className="aspect-[4/3] w-full object-cover"
                  loading="eager"
                />
              </div>
              {images.length > 1 && (
                <div className="mt-3 grid grid-cols-5 gap-2">
                  {images.slice(0, 5).map((src, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setActiveImg(i)}
                      className={`aspect-[4/3] overflow-hidden rounded-md border-2 ${
                        i === activeImg ? "border-primary" : "border-transparent"
                      }`}
                    >
                      <img
                        src={src}
                        alt={`${property.title_zh} ${i + 1}`}
                        className="h-full w-full object-cover"
                        loading="lazy"
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
                  <img
                    src={floorplanUrl}
                    alt={`${property.title_zh} 平面圖`}
                    className="w-full object-contain"
                    loading="lazy"
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
          <PropertyMobileContactSummary
            agent={agent}
            branchContact={branchContact}
            fallbackWhatsapp={SITE_CONTACT.whatsappPhone}
            listingNo={property.listing_no}
            title={property.title_zh}
            dealType={property.deal_type}
            price={dealPrice}
            onInquiry={focusInquiry}
          />
        }
        details={
          <>
            {/* Description */}
            {property.description && (
              <section className="mt-6">
                <h2 className="text-xl font-semibold">物業描述</h2>
                <p className="mt-3 whitespace-pre-line text-muted-foreground">
                  {property.description}
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
                  <CardTitle className="text-base">屋苑資料</CardTitle>
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

            {/* Recent transactions */}
            {txns.length > 0 && (
              <section className="mt-6">
                <h2 className="text-xl font-semibold">屋苑近期成交</h2>
                <div className="mt-3 overflow-hidden rounded-lg border">
                  <Table>
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
                          <TableCell>
                            {t.deal_date ? new Date(t.deal_date).toLocaleDateString("zh-HK") : "—"}
                          </TableCell>
                          <TableCell>{t.unit ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            {t.saleable_area ? `${t.saleable_area} 呎` : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {t.price ? `$${(Number(t.price) / 1_000_000).toFixed(2)}M` : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {t.saleable_psf
                              ? `$${Math.round(Number(t.saleable_psf)).toLocaleString()}`
                              : "—"}
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
          <>
            <PropertyDecisionActions
              agent={agent}
              branchContact={branchContact}
              fallbackWhatsapp={SITE_CONTACT.whatsappPhone}
              listingNo={property.listing_no}
              title={property.title_zh}
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
        }
      />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
    </div>
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
  const price = isRent
    ? listing.rent
      ? `$${Number(listing.rent).toLocaleString()} / 月`
      : "—"
    : listing.price
      ? `$${(Number(listing.price) / 1_000_000).toFixed(2)}M`
      : "—";
  return (
    <Link
      to="/property/$listingNo"
      params={{ listingNo: listing.listing_no }}
      className="group block overflow-hidden rounded-lg border transition-shadow hover:shadow-md"
    >
      <div className="aspect-[4/3] overflow-hidden bg-muted">
        <img
          src={img}
          alt={listing.title_zh}
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
          loading="lazy"
        />
      </div>
      <div className="p-3">
        <p className="line-clamp-1 text-sm font-medium">{listing.title_zh}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {listing.bedrooms ? `${listing.bedrooms}房 · ` : ""}
          {listing.saleable_area ? `${listing.saleable_area} 呎` : ""}
        </p>
        <p className="mt-1 font-semibold text-primary">{price}</p>
      </div>
    </Link>
  );
}
