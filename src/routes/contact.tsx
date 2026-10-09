import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { MapPin, Phone, MessageCircle, Mail, Clock } from "lucide-react";
import { SITE_BRANCHES, SITE_CONTACT, whatsappUrl, type SiteBranch } from "@/config/site";
import { toTelHref, toWhatsAppHref } from "@/lib/contact-links";
import { canonicalLink, pageSeo } from "@/content/seo";
import { districtLabelForSlug } from "@/lib/listing-seo";
import { branchLocalBusinessSchema, jsonLdScript } from "@/lib/schema";
import { AppImage } from "@/components/media/AppImage";
import { Container } from "@/components/layout/Container";
import { ContactInquiryForm } from "@/components/site/ContactInquiryForm";
import { PageHero } from "@/components/site/PageHero";

const branchesSchema = {
  "@context": "https://schema.org",
  "@graph": SITE_BRANCHES.map((branch) =>
    branchLocalBusinessSchema({
      id: branch.id,
      name: branch.name,
      address: branch.address,
      telephone: branch.phone,
      addressLocality: branch.addressLocality,
      areaServed: branch.districtSlugs.flatMap((slug) => districtLabelForSlug(slug) ?? []),
      image: branch.photo,
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

const CONTACT_TITLE = pageSeo.contact.title;

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: CONTACT_TITLE },
      { name: "description", content: pageSeo.contact.description },
      { property: "og:title", content: CONTACT_TITLE },
      { property: "og:description", content: pageSeo.contact.description },
      { name: "twitter:title", content: CONTACT_TITLE },
      { name: "twitter:description", content: pageSeo.contact.description },
    ],
    links: [canonicalLink(pageSeo.contact.path)],
  }),
  component: ContactPage,
});

function ContactPage() {
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
                  loading="lazy"
                  sizes="(min-width: 1280px) 400px, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
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
                    href={toTelHref(branch.phone) ?? undefined}
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
                      className="mt-2 flex items-center gap-2 text-sm font-medium text-whatsapp hover:underline"
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
            href={toTelHref(SITE_CONTACT.phoneTel) ?? "/contact"}
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
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            我們只會使用你於下方提供的資料回覆你的查詢及提供相關服務，詳情請參閱
            <a href="/privacy" className="text-primary underline underline-offset-2">
              《私隱政策》
            </a>
            。
          </p>
          <ContactInquiryForm />
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
