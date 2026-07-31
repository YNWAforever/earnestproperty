import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { MapPin, Phone, MessageCircle, Mail } from "lucide-react";
import { SITE_BRANCHES, SITE_CONTACT, whatsappUrl } from "@/config/site";

export const Route = createFileRoute("/contact")({
  head: () => ({ meta: [{ title: "聯絡晉誠地產｜深井 青山公路 汀九物業專家" }] }),
  component: () => (
    <div className="mx-auto max-w-5xl px-6 py-20">
      <h1 className="text-3xl font-bold text-primary">聯絡晉誠地產</h1>
      <p className="mt-3 text-muted-foreground">深井．青山公路．汀九我哋比你更熟。</p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {SITE_BRANCHES.map((branch) => (
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
            </div>
          </div>
        ))}
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
    </div>
  ),
});

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
