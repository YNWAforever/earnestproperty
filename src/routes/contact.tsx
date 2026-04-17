import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { MapPin, Phone, MessageCircle, Mail } from "lucide-react";

export const Route = createFileRoute("/contact")({
  head: () => ({ meta: [{ title: "聯絡晉誠地產｜深井物業專家" }] }),
  component: () => (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <h1 className="text-3xl font-bold text-primary">聯絡我們</h1>
      <p className="mt-3 text-muted-foreground">深井．青山公路．我哋比你更熟。</p>

      <div className="mt-8 grid gap-4">
        <Row icon={<MapPin className="h-5 w-5" />} label="地址" value="新界深井青山公路深井段 23 號麗都花園地下 5A 舖" />
        <Row icon={<Phone className="h-5 w-5" />} label="電話" value="+852 0000 0000" href="tel:+85200000000" />
        <Row icon={<Mail className="h-5 w-5" />} label="電郵" value="info@earnestproperty.com" href="mailto:info@earnestproperty.com" />
      </div>

      <a
        href="https://wa.me/852XXXXXXXX?text=你好，我想查詢深井物業"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-8 inline-block"
      >
        <Button size="lg" className="bg-coral text-coral-foreground hover:bg-coral/90">
          <MessageCircle className="h-4 w-4" />
          WhatsApp 即時查詢
        </Button>
      </a>
    </div>
  ),
});

function Row({ icon, label, value, href }: { icon: React.ReactNode; label: string; value: string; href?: string }) {
  return (
    <div className="flex items-start gap-4 rounded-lg border border-border bg-card p-4">
      <div className="text-coral">{icon}</div>
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        {href ? (
          <a href={href} className="text-base font-medium text-primary hover:underline">{value}</a>
        ) : (
          <p className="text-base font-medium text-primary">{value}</p>
        )}
      </div>
    </div>
  );
}
