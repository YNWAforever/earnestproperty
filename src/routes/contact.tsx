import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MapPin, Phone, MessageCircle, Mail, Clock } from "lucide-react";
import { SITE_BRANCHES, SITE_CONTACT, whatsappUrl, type SiteBranch } from "@/config/site";
import { toWhatsAppHref } from "@/lib/contact-links";
import { canonicalLink, pageSeo } from "@/content/seo";
import { branchLocalBusinessSchema, jsonLdScript } from "@/lib/schema";
import { createWebsiteInquiry } from "@/lib/neon/admin-data";
import { buildContext, track } from "@/lib/analytics/events";
import {
  createSubmitGuard,
  ENQUIRY_TYPE_OPTIONS,
  PREFERRED_CONTACT_OPTIONS,
  submitContactInquiry,
} from "@/lib/contact-inquiry-form";
import { AppImage } from "@/components/media/AppImage";
import { Container } from "@/components/layout/Container";
import { PageHero } from "@/components/site/PageHero";

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

const CONTACT_TITLE = "聯絡晉誠地產｜深井 青山公路 汀九物業專家";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: CONTACT_TITLE },
      { name: "description", content: pageSeo.contact.description },
      { property: "og:title", content: CONTACT_TITLE },
      { property: "og:description", content: pageSeo.contact.description },
    ],
    links: [canonicalLink(pageSeo.contact.path)],
  }),
  component: ContactPage,
});

function ContactPage() {
  const [submitting, setSubmitting] = useState(false);
  const [consentWhatsapp, setConsentWhatsapp] = useState(false);
  const [enquiryType, setEnquiryType] = useState("");
  const [preferredContact, setPreferredContact] = useState("");
  // A plain ref, not React state -- see contact-inquiry-form.ts's
  // createSubmitGuard doc comment for why. `submitting` state above only
  // drives the button's disabled/label UI; it does NOT gate re-entrancy,
  // because a fast double-click/double-Enter can fire a second handleSubmit
  // before the first setSubmitting(true) commits and re-renders. The guard
  // instance must be stable across renders (one guard per mounted form), so
  // it's created once and stashed in a ref; `submitGuard` itself is a plain
  // non-null local so handleSubmit's closure doesn't need an `undefined`
  // check on every `.current` access.
  const submitGuardRef = useRef<ReturnType<typeof createSubmitGuard> | null>(null);
  if (submitGuardRef.current === null) {
    submitGuardRef.current = createSubmitGuard();
  }
  const submitGuard = submitGuardRef.current;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Guard check FIRST, before any React state is touched -- if a
    // near-simultaneous second submit lands here while the first is still in
    // flight, it is dropped immediately with no state churn at all (no
    // flicker of the submit button's disabled/label state, no double toast).
    if (!submitGuard.tryStart()) {
      return;
    }

    const form = e.currentTarget;
    const fd = new FormData(form);
    const raw = {
      name: String(fd.get("name") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      email: String(fd.get("email") ?? ""),
      message: String(fd.get("message") ?? ""),
      enquiryType,
      preferredContact,
    };

    setSubmitting(true);
    try {
      const outcome = await submitContactInquiry({
        raw,
        consentWhatsapp,
        submitFn: (payload) => createWebsiteInquiry({ data: payload }),
      });

      switch (outcome.status) {
        case "validation-error":
          toast.error(outcome.message);
          return;
        case "server-error":
          toast.error("提交失敗：" + outcome.message);
          return;
        case "success":
          toast.success("已收到查詢，我們會盡快聯絡你。");
          track(
            { name: "contact_form_submit", payload: { hasPhone: raw.phone.trim().length > 0 } },
            buildContext(),
          );
          form.reset();
          setConsentWhatsapp(false);
          setEnquiryType("");
          setPreferredContact("");
          return;
      }
    } finally {
      submitGuard.finish();
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(branchesSchema) }}
      />
      <PageHero
        eyebrow="聯絡我們"
        title="聯絡晉誠地產"
        lead="深井．青山公路．汀九我哋比你更熟。"
        actions={
          <a
            href={whatsappUrl("你好，我想查詢深井／青山公路／汀九物業")}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size="lg" variant="brand">
              <MessageCircle className="h-4 w-4" />
              WhatsApp 即時查詢
            </Button>
          </a>
        }
      />

      <Container className="py-12">
        <div className="grid gap-4 md:grid-cols-3">
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

        <div className="mt-10 rounded-lg border border-border bg-card p-6">
          <h2 className="text-xl font-semibold text-primary">留言查詢</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            唔想打電話？填寫以下表格，我們會盡快回覆你。
          </p>
          {/*
          PICS (Personal Information Collection Statement) summary -- kept
          deliberately short and links out to /privacy for the full policy,
          rather than restating every clause here. Placed above the form
          fields (not folded into the marketing checkbox or the operational
          disclaimer below) so it reads as "here's what we do with your data"
          before the visitor starts typing, and stays visually distinct from
          both consent-related elements per this task's structural
          requirement.
        */}
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            我們只會使用你於下方提供的資料回覆你的查詢及提供相關服務，詳情請參閱
            <a href="/privacy" className="text-primary underline underline-offset-2">
              《私隱政策》
            </a>
            。
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
              <Label htmlFor="contact-enquiryType">查詢類型 *</Label>
              <Select
                value={enquiryType}
                onValueChange={setEnquiryType}
                name="enquiryType"
                required
              >
                <SelectTrigger id="contact-enquiryType">
                  <SelectValue placeholder="請選擇查詢類型" />
                </SelectTrigger>
                <SelectContent>
                  {ENQUIRY_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="contact-preferredContact">偏好聯絡方式 *</Label>
              <Select
                value={preferredContact}
                onValueChange={setPreferredContact}
                name="preferredContact"
                required
              >
                <SelectTrigger id="contact-preferredContact">
                  <SelectValue placeholder="請選擇偏好聯絡方式" />
                </SelectTrigger>
                <SelectContent>
                  {PREFERRED_CONTACT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            {/*
            Direct-marketing consent -- structurally separate from the
            operational-reply disclaimer below (a real, unchecked-by-default
            opt-in control here vs. plain inline text after the submit
            button). Adding enquiryType/preferredContact above must not blur
            this distinction, so nothing marketing-related was added to
            either of those two fields.
          */}
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
      </Container>
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
