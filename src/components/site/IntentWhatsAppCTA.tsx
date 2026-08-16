import { Home, KeyRound, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { whatsappIntentUrl, type WhatsAppIntent, type WhatsAppIntentContext } from "@/config/site";

const intentItems: Array<{
  intent: WhatsAppIntent;
  label: string;
  icon: typeof MessageCircle;
}> = [
  {
    intent: "buy",
    label: "我要買樓",
    icon: Home,
  },
  {
    intent: "rent",
    label: "我要租樓",
    icon: KeyRound,
  },
  {
    intent: "valuation",
    label: "我要放盤估價",
    icon: MessageCircle,
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
    <div className={`grid gap-2 ${compact ? "grid-cols-1" : "sm:grid-cols-3"}`}>
      {intentItems.map((item) => {
        const Icon = item.icon;
        return (
          <Button
            key={item.intent}
            asChild
            variant="brand"
            size={compact ? "sm" : "lg"}
            className="w-full"
          >
            <a
              href={whatsappIntentUrl(item.intent, context)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </a>
          </Button>
        );
      })}
    </div>
  );
}
