import { MessageCircle } from "lucide-react";

import { whatsappUrl } from "@/config/site";

/**
 * Site-wide mobile-only sticky WhatsApp CTA (audit item 14: "no sticky
 * WhatsApp/bottom conversion bar — the only persistent element is the 問樓助手
 * AI chat bubble, which doesn't hand off to WhatsApp"). Mirrors the mobile
 * action bar already proven out on PropertyDecisionActions -- same
 * `bottom-16` offset so it sits above, not on top of, the 問樓助手 bubble
 * (fixed at bottom-4/bottom-5), and the same `lg:hidden` (desktop already has
 * the header's WhatsApp button and mega-menu CTA).
 */
export function StickyWhatsAppBar() {
  const href = whatsappUrl("你好，我想查詢深井／青山公路／汀九物業");

  return (
    <div
      className="fixed inset-x-0 bottom-16 z-40 border-t bg-background/95 px-3 py-2 shadow-lg backdrop-blur lg:hidden"
      data-sticky-whatsapp-bar
    >
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="mx-auto flex max-w-6xl items-center justify-center gap-2 rounded-md bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1ebe57]"
      >
        <MessageCircle className="h-4 w-4" />
        WhatsApp 即時查詢
      </a>
    </div>
  );
}
