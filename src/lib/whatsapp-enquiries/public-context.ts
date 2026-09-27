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

export type WebsiteLinkCandidate = {
  propertyId: string;
  candidateCount: number;
  code: string | null;
};

/** A conflicting or invalid tracking link falls back to a contextual public action. */
export function resolveWebsiteActions(
  offers: (Omit<PublicWaOffer, "title"> & { title?: string })[],
  candidates: WebsiteLinkCandidate[],
  companyPhone: string | null | undefined,
) {
  const byId = new Map(candidates.map((candidate) => [candidate.propertyId, candidate]));
  const links = offers.map((offer) => {
    const candidate = byId.get(offer.propertyId);
    const href =
      candidate?.candidateCount === 1 && candidate.code && /^[A-Za-z0-9_-]+$/.test(candidate.code)
        ? `/w/${candidate.code}`
        : null;
    return { propertyId: offer.propertyId, href };
  });
  const hrefById = new Map(links.map((link) => [link.propertyId, link.href]));
  return {
    links,
    actions: offers.map((offer) => ({
      propertyId: offer.propertyId,
      ...resolvePublicWaAction(
        { ...offer, title: offer.title ?? "" },
        hrefById.get(offer.propertyId),
        companyPhone,
      ),
    })),
  };
}
