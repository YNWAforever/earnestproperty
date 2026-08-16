import { SITE_BRANCHES, resolveBranchContact, type SiteBranch } from "./site-branches.js";

const whatsappPhone = import.meta.env.VITE_CONTACT_WHATSAPP_PHONE ?? "";
const phoneDisplay = import.meta.env.VITE_CONTACT_PHONE_DISPLAY ?? "";
const phoneTel = import.meta.env.VITE_CONTACT_PHONE_TEL ?? "";

// True once VITE_CONTACT_WHATSAPP_PHONE is configured. Components should check
// this explicitly rather than compare a built URL against the literal string
// "/contact" -- that comparison only ever worked by coincidence (see the
// SiteHeader mobile-menu dedupe, which relied on two independently-built
// wa.me messages happening to both degrade to the same fallback string).
export const hasWhatsAppPhone = Boolean(whatsappPhone);

if (!hasWhatsAppPhone) {
  // Not a throw: this module is imported by nearly every route (via
  // SiteHeader/SiteFooter), so throwing here would 500 the entire site on
  // first request rather than just leaving WhatsApp CTAs pointed at /contact.
  // A misconfigured production/preview deploy is instead caught before it
  // ships by scripts/check-required-env.mjs (wired as the `prebuild` step),
  // which fails the Vercel build outright. This warning is the local-dev
  // signal for the same problem.
  console.warn(
    "[site.ts] VITE_CONTACT_WHATSAPP_PHONE is not set -- every WhatsApp CTA will fall back " +
      "to /contact instead of opening WhatsApp. See .env.example.",
  );
}

export const SITE_CONTACT = {
  id: "general",
  name: "晉誠地產",
  whatsappPhone,
  phoneDisplay,
  phoneTel,
  email: "info@earnestproperty.com",
  address: "新界深井青山公路深井段 23 號麗都花園地下 5A 舖",
  licenceNo: "C-018613",
};

export { SITE_BRANCHES };
export type { SiteBranch };

export type PropertyBranchContact = SiteBranch | typeof SITE_CONTACT;

export function resolvePropertyBranchContact(input: {
  estateSlug?: string | null;
  districtSlug?: string | null;
}): PropertyBranchContact {
  return resolveBranchContact({
    branches: SITE_BRANCHES,
    fallback: SITE_CONTACT,
    estateSlug: input.estateSlug,
    districtSlug: input.districtSlug,
  });
}

export const SITE_YOUTUBE_CHANNEL = {
  name: "晉誠地產 Earnest Property",
  handleLabel: "@晉誠地產-EarnestProperty",
  url: "https://www.youtube.com/@%E6%99%89%E8%AA%A0%E5%9C%B0%E7%94%A2-EarnestProperty",
} as const;

export type WhatsAppIntent = "buy" | "rent" | "valuation";

export type WhatsAppIntentContext = {
  estateName?: string;
  districtName?: string;
  searchSummary?: string;
  source?: string;
};

function contextLine(label: string, value: string | undefined) {
  return value ? `\n${label}：${value}` : "";
}

export function whatsappUrl(message: string) {
  const encoded = encodeURIComponent(message);
  return whatsappPhone ? `https://wa.me/${whatsappPhone}?text=${encoded}` : "/contact";
}

export function whatsappIntentMessage(intent: WhatsAppIntent, context: WhatsAppIntentContext = {}) {
  if (intent === "buy") {
    return [
      "你好，我要買樓，想請晉誠地產幫我配盤。",
      contextLine("心水屋苑", context.estateName),
      contextLine("目標地區", context.districtName),
      contextLine("搜尋條件", context.searchSummary),
      "\n預算：",
      "\n房數：",
      "\n睇樓時間：",
      contextLine("來源", context.source),
    ].join("");
  }

  if (intent === "rent") {
    return [
      "你好，我要租樓，想請晉誠地產幫我搵合適租盤。",
      contextLine("心水屋苑", context.estateName),
      contextLine("目標地區", context.districtName),
      contextLine("搜尋條件", context.searchSummary),
      "\n月租預算：",
      "\n入住日期：",
      "\n房數：",
      contextLine("來源", context.source),
    ].join("");
  }

  return [
    "你好，我要放盤估價，想索取深井業主估價報告。",
    contextLine("屋苑/大廈", context.estateName),
    contextLine("地區", context.districtName),
    contextLine("搜尋條件", context.searchSummary),
    "\n實用面積：",
    "\n樓層/景觀：",
    "\n打算放售或放租：",
    "\n方便聯絡時間：",
    contextLine("來源", context.source),
  ].join("");
}

export function whatsappIntentUrl(intent: WhatsAppIntent, context: WhatsAppIntentContext = {}) {
  return whatsappUrl(whatsappIntentMessage(intent, context));
}

function formatWhatsAppPrice(dealType: "sale" | "rent", price: number | null) {
  if (price === null) return "";
  const amount =
    dealType === "rent"
      ? `$${price.toLocaleString("zh-HK")}/月`
      : `$${price.toLocaleString("zh-HK")}`;
  return `（${amount}）`;
}

/**
 * The listing-detail-page enquiry prefill. Distinct from whatsappIntentMessage
 * (which drives the site-wide buy/rent/valuation CTAs): this one is a single
 * short line carrying enough context for an agent to recognise the property
 * without opening the site, per the audit's example:
 * 「你好，想查詢 麗都花園 第03座 售盤 #C024131（$600萬）」.
 *
 * `title` is expected to be the listing's `title_zh`, which
 * src/lib/mls/normalize-old-site.mjs already builds as
 * `${building} ${售盤|租盤} #${listingNo}` -- so the deal label and listing
 * number are already inside it. Re-adding them here would duplicate them.
 */
export function propertyEnquiryMessage(input: {
  title: string;
  dealType: "sale" | "rent";
  price: number | null;
}) {
  return `你好，想查詢 ${input.title}${formatWhatsAppPrice(input.dealType, input.price)}`;
}
