import { MessageCircle } from "lucide-react";

import { whatsappUrl } from "@/config/site";
import { buildContext, track } from "@/lib/analytics/events";
import { mobileActionBarAttribute } from "./mobile-action-bar";

/**
 * Site-wide mobile-only sticky WhatsApp CTA (audit item 14: "no sticky
 * WhatsApp/bottom conversion bar"). FX-16 F-07: it sits at bottom-0 on the
 * safe area, and its right padding (`pr-[3.75rem]`: 44 px icon + 12 px edge +
 * 4 px gap) is the slot the docked 問樓助手 icon fills (LiveAgentLauncher
 * `docked`), so the two never stack. The page reserves the bar's height in
 * `__root.tsx`. `lg:hidden`: desktop already has the header's WhatsApp
 * button and mega-menu CTA, and keeps the floating 問樓助手 pill.
 */
export function StickyWhatsAppBar() {
  const href = whatsappUrl("你好，我想查詢深井／青山公路／汀九物業");

  return (
    <aside
      aria-label="WhatsApp 即時查詢"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pr-[3.75rem] shadow-lg backdrop-blur lg:hidden"
      data-sticky-whatsapp-bar
      {...mobileActionBarAttribute}
    >
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() =>
          track({ name: "whatsapp_cta_click", payload: { source: "sticky-bar" } }, buildContext())
        }
        className="mx-auto flex min-h-11 max-w-6xl items-center justify-center gap-2 rounded-md bg-whatsapp px-4 py-2.5 text-sm font-semibold text-white hover:bg-whatsapp-hover"
      >
        <MessageCircle className="h-4 w-4" />
        WhatsApp 即時查詢
      </a>
    </aside>
  );
}
