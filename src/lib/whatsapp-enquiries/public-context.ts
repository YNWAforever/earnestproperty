import { toWhatsAppHref } from "../contact-links.ts";

export type PublicWaOffer = {
  propertyId: string;
  publicListingNo: string;
  dealType: "sale" | "rent";
  title: string;
};

export type PublicWaAction = {
  href: string;
  mode: "tracked" | "untracked" | "contact";
  publicListingNo: string;
  dealType: "sale" | "rent";
};

function customerNumber(value: string): string | null {
  const number = value.trim();
  if (
    !number ||
    /^SYNC(?:[-_]|$)/i.test(number) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(number)
  )
    return null;
  return number;
}

export function buildPublicWhatsappMessage(offer: PublicWaOffer): string {
  return `您好，我想查詢樓盤 ${offer.publicListingNo.trim()}（${offer.dealType === "rent" ? "出租" : "出售"}）：${offer.title.trim()}。`;
}

export function resolvePublicWaAction(
  offer: PublicWaOffer,
  trackedHref: string | null | undefined,
  companyPhone: string | null | undefined,
): PublicWaAction {
  const publicListingNo = customerNumber(offer.publicListingNo) ?? "";
  const identity = { publicListingNo, dealType: offer.dealType };
  if (!publicListingNo || !offer.title.trim())
    return { href: "/contact", mode: "contact", ...identity };
  if (trackedHref && /^\/w\/[A-Za-z0-9_-]+$/.test(trackedHref))
    return { href: trackedHref, mode: "tracked", ...identity };
  const href = toWhatsAppHref(companyPhone, buildPublicWhatsappMessage(offer));
  return href
    ? { href, mode: "untracked", ...identity }
    : { href: "/contact", mode: "contact", ...identity };
}
