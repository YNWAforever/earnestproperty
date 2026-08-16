import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { MapPin, Phone, MessageCircle, Mail, Clock } from "lucide-react";
import { SITE_BRANCHES, SITE_CONTACT, whatsappUrl, type SiteBranch } from "@/config/site";
import { toWhatsAppHref } from "@/lib/contact-links";
import { canonicalLink, pageSeo } from "@/content/seo";
import { branchLocalBusinessSchema, jsonLdScript } from "@/lib/schema";
import { createWebsiteInquiry } from "@/lib/neon/admin-data";

const branchesSchema = {
  "@context": "https://schema.org",
  "@graph": SITE_BRANCHES.map((branch) =>
    branchLocalBusinessSchema({
      name: branch.name,
      address: branch.address,
      telephone: branch.phone,
    }),
  ),
};

// Prefer a client-supplied `mapUrl`; otherwise build a no-API-key embed from
// the branch address, the same `output=embed` technique already used for the
// listing-detail map (property.$listingNo.tsx), so branches render a working
// map before the client ever supplies one.
function branchMapEmbedUrl(branch: SiteBranch) {
  return (
    branch.mapUrl ||
    `https://www.google.com/maps?q=${encodeURIComponent(branch.address)}&z=16&output=embed`
  );
}

const contactInquirySchema = z.object({
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

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [{ title: "聯絡晉誠地產｜深井 青山公路 汀九物業專家" }],
    links: [canonicalLink(pageSeo.contact.path)],
  }),
  component: ContactPage,
});

function ContactPage() {
  const [submitting, setSubmitting] = useState(false);
  const [consentWhatsapp, setConsentWhatsapp] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw = {
      name: String(fd.get("name") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      email: String(fd.get("email") ?? ""),
      message: String(fd.get("message") ?? ""),
    };
    const parsed = contactInquirySchema.safeParse(raw);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "請檢查輸入");
      return;
    }
    setSubmitting(true);
    const result = await createWebsiteInquiry({
      data: {
        name: parsed.data.name,
        phone: parsed.data.phone,
        email: parsed.data.email || "",
        message: parsed.data.message || "",
        consentWhatsapp,
      },
    }).catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));
    setSubmitting(false);
    if ("error" in result && result.error) {
      toast.error("提交失敗：" + result.error);
      return;
    }
    toast.success("已收到查詢，我們會盡快聯絡你。");
    (e.target as HTMLFormElement).reset();
    setConsentWhatsapp(false);
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(branchesSchema) }}
      />
      <h1 className="text-3xl font-bold text-primary">聯絡晉誠地產</h1>
      <p className="mt-3 text-muted-foreground">深井．青山公路．汀九我哋比你更熟。</p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {SITE_BRANCHES.map((branch) => {
          const branchWhatsappHref = toWhatsAppHref(
            branch.whatsapp,
            `你好，我想查詢${branch.name}物業`,
          );
          return (
            <div
              key={branch.phone}
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
                <p className="text-xs uppercase tracking-wider text-muted-foreground">門市</p>
                <h2 className="mt-1 text-lg font-semibold text-primary">{branch.name}</h2>
                <p className="mt-4 flex items-start gap-2 text-sm leading-6 text-muted-foreground">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  {branch.address}
                </p>
                <a
                  href={`tel:${branch.phone}`}
                  className="mt-3 flex items-center gap-2 text-base font-semibold text-primary hover:underline"
                >
                  <Phone className="h-4 w-4 text-primary" />
                  {branch.phone}
                </a>
                {branch.hours ? (
                  <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4 shrink-0 text-primary" />
                    {branch.hours}
                  </p>
                ) : null}
                {branchWhatsappHref ? (
                  <a
                    href={branchWhatsappHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 flex items-center gap-2 text-sm font-medium text-[#25D366] hover:underline"
                  >
                    <MessageCircle className="h-4 w-4 shrink-0" />
                    WhatsApp 查詢
                  </a>
                ) : null}
              </div>
              <iframe
                src={branchMapEmbedUrl(branch)}
                title={`${branch.name}地圖位置`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="h-48 w-full border-0"
              />
            </div>
          );
        })}
      </div>

      <div className="mt-8 grid gap-4">
        <Row
          icon={<Phone className="h-5 w-5" />}
          label="總機"
          value={SITE_CONTACT.phoneDisplay || "聯絡我們"}
          href={SITE_CONTACT.phoneTel ? `tel:${SITE_CONTACT.phoneTel}` : "/contact"}
        />
        <Row
          icon={<Mail className="h-5 w-5" />}
          label="電郵"
          value={SITE_CONTACT.email}
          href={`mailto:${SITE_CONTACT.email}`}
        />
      </div>

      <a
        href={whatsappUrl("你好，我想查詢深井／青山公路／汀九物業")}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-8 inline-block"
      >
        <Button size="lg" variant="brand">
          <MessageCircle className="h-4 w-4" />
          WhatsApp 即時查詢
        </Button>
      </a>

      <div className="mt-10 rounded-lg border border-border bg-card p-6">
        <h2 className="text-xl font-semibold text-primary">留言查詢</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          唔想打電話？填寫以下表格，我們會盡快回覆你。
        </p>
        <form onSubmit={handleSubmit} className="mt-4 max-w-md space-y-3">
          <div>
            <Label htmlFor="contact-name">姓名 *</Label>
            <Input id="contact-name" name="name" required maxLength={120} placeholder="陳先生" />
          </div>
          <div>
            <Label htmlFor="contact-phone">電話 *</Label>
            <Input
              id="contact-phone"
              name="phone"
              required
              type="tel"
              maxLength={30}
              placeholder="9123 4567"
            />
          </div>
          <div>
            <Label htmlFor="contact-email">電郵</Label>
            <Input id="contact-email" name="email" type="email" maxLength={255} />
          </div>
          <div>
            <Label htmlFor="contact-message">訊息</Label>
            <Textarea
              id="contact-message"
              name="message"
              maxLength={1000}
              rows={3}
              placeholder="想查詢買樓／放盤／租務"
            />
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="contact-consentWhatsapp"
              checked={consentWhatsapp}
              onCheckedChange={(checked) => setConsentWhatsapp(checked === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="contact-consentWhatsapp"
              className="text-xs font-normal leading-snug text-muted-foreground"
            >
              我同意透過 WhatsApp 接收樓盤資訊及推廣訊息。
            </Label>
          </div>
          <Button type="submit" className="w-full sm:w-auto" disabled={submitting}>
            {submitting ? "提交中…" : "提交查詢"}
          </Button>
          <p className="text-xs text-muted-foreground">
            按提交即表示同意我們透過上述聯絡方式回覆查詢。
          </p>
        </form>
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="flex items-start gap-4 rounded-lg border border-border bg-card p-4">
      <div className="text-coral">{icon}</div>
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        {href ? (
          <a href={href} className="text-base font-medium text-primary hover:underline">
            {value}
          </a>
        ) : (
          <p className="text-base font-medium text-primary">{value}</p>
        )}
      </div>
    </div>
  );
}
