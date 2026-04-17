import { useState } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { toast } from "sonner";
import { Phone, MessageCircle, MapPin, Bed, Bath, Maximize, Calendar, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { fetchPropertyByListingNo } from "@/lib/queries";

export const Route = createFileRoute("/property/$listingNo")({
  loader: async ({ params }) => {
    const property = await fetchPropertyByListingNo(params.listingNo);
    if (!property) throw notFound();
    return property;
  },
  head: ({ loaderData }) => {
    const p = loaderData as any;
    if (!p) return { meta: [{ title: "放盤｜晉誠地產" }] };
    const priceStr =
      p.deal_type === "rent"
        ? p.rent
          ? `月租 $${Number(p.rent).toLocaleString()}`
          : ""
        : p.price
          ? `售 $${(Number(p.price) / 1_000_000).toFixed(2)}M`
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
    };
  },
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <h1 className="text-2xl font-bold">載入失敗</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <Button className="mt-6" onClick={() => router.invalidate()}>
          重試
        </Button>
      </div>
    );
  },
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

const inquirySchema = z.object({
  name: z.string().trim().min(1, "請輸入姓名").max(120, "姓名過長"),
  phone: z
    .string()
    .trim()
    .min(8, "請輸入有效電話")
    .max(30, "電話過長")
    .regex(/^[\d+\-\s()]+$/, "電話格式不正確"),
  email: z
    .string()
    .trim()
    .max(255)
    .email("電郵格式不正確")
    .optional()
    .or(z.literal("")),
  message: z.string().trim().max(1000, "訊息過長").optional(),
});

function PropertyPage() {
  const property = Route.useLoaderData() as any;
  const images: string[] = property.images?.length
    ? property.images
    : ["https://placehold.co/1200x800/e5e7eb/64748b?text=No+Image"];
  const [activeImg, setActiveImg] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const isRent = property.deal_type === "rent";
  const priceLabel = isRent
    ? property.rent
      ? `$${Number(property.rent).toLocaleString()} / 月`
      : "—"
    : property.price
      ? `$${(Number(property.price) / 1_000_000).toFixed(2)}M`
      : "—";
  const psf =
    property.price && property.saleable_area
      ? Math.round(Number(property.price) / property.saleable_area)
      : null;

  const agent = property.profiles;
  const estate = property.estates;

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
    const { error } = await supabase.from("inquiries").insert({
      name: parsed.data.name,
      phone: parsed.data.phone,
      email: parsed.data.email || null,
      message: parsed.data.message || null,
      property_id: property.id,
      assigned_agent_id: agent?.id ?? null,
      source: "website",
    });
    setSubmitting(false);
    if (error) {
      toast.error("提交失敗：" + error.message);
      return;
    }
    toast.success("已收到查詢，經紀會盡快與你聯絡。");
    (e.target as HTMLFormElement).reset();
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: property.title_zh,
    description: property.description ?? undefined,
    url: typeof window !== "undefined" ? window.location.href : undefined,
    image: images,
    datePosted: property.created_at,
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
    offers: {
      "@type": "Offer",
      price: isRent ? property.rent : property.price,
      priceCurrency: "HKD",
      availability: "https://schema.org/InStock",
    },
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Breadcrumb */}
      <nav className="mb-4 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          首頁
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

      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
        {/* Left: gallery + content */}
        <div>
          {/* Gallery */}
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

          {/* Title */}
          <div className="mt-6">
            <div className="flex items-center gap-2">
              <Badge variant={isRent ? "secondary" : "default"}>
                {isRent ? "租盤" : "售盤"}
              </Badge>
              {property.featured && <Badge variant="outline">精選</Badge>}
              <span className="text-xs text-muted-foreground">
                編號 {property.listing_no}
              </span>
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">{property.title_zh}</h1>
            {property.address && (
              <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" />
                {property.address}
              </p>
            )}
            <p className="mt-4 text-3xl font-bold text-primary">
              {priceLabel}
              {psf && !isRent && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  實呎 ${psf.toLocaleString()}
                </span>
              )}
            </p>
          </div>

          {/* Specs */}
          <Card className="mt-6">
            <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4">
              <Spec icon={<Maximize className="h-4 w-4" />} label="實用面積" value={property.saleable_area ? `${property.saleable_area} 呎` : "—"} />
              <Spec icon={<Bed className="h-4 w-4" />} label="房間" value={property.bedrooms ?? "—"} />
              <Spec icon={<Bath className="h-4 w-4" />} label="浴室" value={property.bathrooms ?? "—"} />
              <Spec icon={<Building2 className="h-4 w-4" />} label="樓層" value={property.floor ?? "—"} />
              <Spec label="建築面積" value={property.gross_area ? `${property.gross_area} 呎` : "—"} />
              <Spec label="座向" value={property.orientation ?? "—"} />
              <Spec label="管理費" value={property.management_fee ? `$${Number(property.management_fee).toLocaleString()}` : "—"} />
              <Spec icon={<Calendar className="h-4 w-4" />} label="入伙年份" value={estate?.year_completed ?? "—"} />
            </CardContent>
          </Card>

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
          {property.features?.length > 0 && (
            <section className="mt-6">
              <h2 className="text-xl font-semibold">特色</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {property.features.map((f: string) => (
                  <Badge key={f} variant="secondary">
                    {f}
                  </Badge>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right: agent + inquiry (sticky) */}
        <aside className="lg:sticky lg:top-6 lg:h-fit">
          {/* Agent card */}
          {agent && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">負責經紀</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <Avatar className="h-14 w-14">
                    <AvatarImage src={agent.avatar_url ?? undefined} alt={agent.name_zh ?? ""} />
                    <AvatarFallback>
                      {(agent.name_zh ?? "經").slice(0, 1)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold">{agent.name_zh ?? agent.name_en}</p>
                    {agent.licence_no && (
                      <p className="text-xs text-muted-foreground">牌照 {agent.licence_no}</p>
                    )}
                    {agent.branch && (
                      <p className="text-xs text-muted-foreground">{agent.branch}</p>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  {agent.phone && (
                    <Button asChild variant="outline" className="flex-1">
                      <a href={`tel:${agent.phone}`}>
                        <Phone className="mr-2 h-4 w-4" />
                        致電
                      </a>
                    </Button>
                  )}
                  {agent.whatsapp && (
                    <Button asChild className="flex-1">
                      <a
                        href={`https://wa.me/${agent.whatsapp.replace(/[^\d]/g, "")}?text=${encodeURIComponent(`你好，我想查詢編號 ${property.listing_no} ${property.title_zh}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <MessageCircle className="mr-2 h-4 w-4" />
                        WhatsApp
                      </a>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Inquiry form */}
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-base">查詢此盤</CardTitle>
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
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "提交中…" : "提交查詢"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  按提交即表示同意我們透過上述聯絡方式回覆查詢。
                </p>
              </form>
            </CardContent>
          </Card>
        </aside>
      </div>

      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
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
