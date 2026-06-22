import { MessageCircle, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { whatsappIntentUrl, type WhatsAppIntentContext } from "@/config/site";

export function SearchFallbackCTA({
  context,
  compact = false,
}: {
  context?: WhatsAppIntentContext;
  compact?: boolean;
}) {
  return (
    <div className={`rounded-lg border border-dashed bg-card p-6 ${compact ? "" : "text-center"}`}>
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Search className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-lg font-bold text-primary">搵唔到心水盤？</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            WhatsApp 講低預算、屋苑、房數同睇樓時間，晉誠代理幫你配盤。
          </p>
        </div>
        <a
          href={whatsappIntentUrl("buy", {
            ...context,
            source: context?.source ?? "listing-search-fallback",
          })}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button className="bg-coral text-coral-foreground hover:bg-coral/90">
            <MessageCircle className="h-4 w-4" />
            WhatsApp 講低預算
          </Button>
        </a>
      </div>
    </div>
  );
}
