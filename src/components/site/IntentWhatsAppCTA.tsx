import { Home, KeyRound, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { whatsappIntentUrl, type WhatsAppIntent, type WhatsAppIntentContext } from "@/config/site";

const intentItems: Array<{
  intent: WhatsAppIntent;
  label: string;
  icon: typeof MessageCircle;
  className: string;
}> = [
  {
    intent: "buy",
    label: "我要買樓",
    icon: Home,
    className: "bg-primary text-primary-foreground hover:bg-primary/90",
  },
  {
    intent: "rent",
    label: "我要租樓",
    icon: KeyRound,
    className: "bg-gold text-primary hover:bg-gold/90",
  },
  {
    intent: "valuation",
    label: "我要放盤估價",
    icon: MessageCircle,
    className: "bg-coral text-coral-foreground hover:bg-coral/90",
  },
];

export function IntentWhatsAppCTA({
  context,
  compact = false,
}: {
  context?: WhatsAppIntentContext;
  compact?: boolean;
}) {
  return (
    <div className={`grid gap-2 ${compact ? "sm:grid-cols-3" : "sm:grid-cols-3"}`}>
      {intentItems.map((item) => {
        const Icon = item.icon;
        return (
          <a
            key={item.intent}
            href={whatsappIntentUrl(item.intent, context)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size={compact ? "sm" : "lg"} className={`w-full ${item.className}`}>
              <Icon className="h-4 w-4" />
              {item.label}
            </Button>
          </a>
        );
      })}
    </div>
  );
}
