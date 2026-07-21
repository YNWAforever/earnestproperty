import { ClipboardCheck, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { whatsappIntentUrl, type WhatsAppIntentContext } from "@/config/site";

export function OwnerValuationPanel({
  context,
  id,
}: {
  context?: WhatsAppIntentContext;
  id?: string;
}) {
  return (
    <section id={id} className="bg-card">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[1.2fr_0.8fr] lg:px-8">
        <div>
          <p className="text-sm font-semibold text-coral">業主放盤 / 免費估價</p>
          <h2 className="mt-2 text-2xl font-bold text-primary">索取深井業主估價報告</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            提供屋苑、實用面積、樓層景觀同放售或放租意向，晉誠地舖團隊會按近期放盤、成交和可睇盤情況回覆。
          </p>
        </div>
        <div className="rounded-lg border bg-background p-5">
          <div className="flex items-start gap-3">
            <ClipboardCheck className="mt-1 h-5 w-5 text-gold" />
            <div>
              <p className="font-semibold text-primary">WhatsApp-first，不用填長表格</p>
              <p className="mt-1 text-sm text-muted-foreground">
                適合業主先快速了解估值、叫價策略和租售兩邊選擇。
              </p>
            </div>
          </div>
          <Button asChild variant="brand" className="mt-5 w-full">
            <a
              href={whatsappIntentUrl("valuation", {
                ...context,
                source: context?.source ?? "owner-valuation-panel",
              })}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle className="h-4 w-4" />
              我要放盤估價
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}
