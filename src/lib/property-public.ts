import { formatHkd, formatSaleDisplay } from "./format";

export type PublicOffering = {
  id: string;
  listing_no: string;
  deal_type: "sale" | "rent";
  price: number | null;
  rent: number | null;
  status: string;
  description?: string | null;
};
type PublicProperty = {
  id?: string;
  listing_no: string;
  public_listing_no?: string;
  deal_type: string;
  price: number | null;
  rent: number | null;
  status?: string;
  offerings?: PublicOffering[];
  video_url?: string | null;
};
export function publicPropertyNo(
  property: Pick<PublicProperty, "listing_no" | "public_listing_no">,
) {
  const candidate = (property.public_listing_no || property.listing_no).trim();
  // Imported SYNC IDs and raw UUIDs are storage identities, not customer
  // listing numbers. Surfaces without a verified public number use contact.
  return /^SYNC(?:[-_]|$)/i.test(candidate) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)
    ? ""
    : candidate;
}
export function activePropertyOfferings(property: PublicProperty): PublicOffering[] {
  const offerings = property.offerings ?? [
    {
      ...property,
      id: property.id ?? "",
      deal_type: property.deal_type === "rent" ? ("rent" as const) : ("sale" as const),
      status: property.status ?? "active",
    },
  ];
  return offerings.filter((offer) => offer.status === "active");
}
export function selectPropertyOffering(
  property: PublicProperty,
  deal: string,
): PublicOffering | undefined {
  const offerings = activePropertyOfferings(property);
  return offerings.find((offer) => offer.deal_type === deal) ?? offerings[0];
}
export function propertyDealLabel(property: PublicProperty) {
  const deals = new Set(activePropertyOfferings(property).map((offer) => offer.deal_type));
  return deals.size > 1
    ? "可買可租"
    : deals.has("rent") || (!deals.size && property.deal_type === "rent")
      ? "租盤"
      : "售盤";
}
export function propertyPriceSummary(property: PublicProperty) {
  const offers = activePropertyOfferings(property);
  return (
    offers
      .map((offer) =>
        offer.deal_type === "rent"
          ? `租 ${formatHkd(offer.rent) ?? "—"} / 月`
          : `售 ${formatSaleDisplay(offer.price) ?? "—"}`,
      )
      .join(" · ") || "暫無放盤"
  );
}
// A display-only cleanup. Source titles and manual CMS overrides are never rewritten.
// Bedroom and helper-room numbers remain untouched until a human verifies them.
export function verifiedVrTourUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (host === "my.matterport.com" && url.pathname === "/show/" && url.searchParams.has("m"))
      return url.href;
    if (host === "kuula.co" && /^\/post\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return url.href;
  } catch {
    return null;
  }
  return null;
}
export function stripUnsupportedVrClaim(raw: string, videoUrl?: string | null): string {
  if (verifiedVrTourUrl(videoUrl)) return raw;
  return raw
    .replace(/【\s*VR\s*(?:實景|睇樓|全景)\s*】/gi, " ")
    .replace(/\bVR\s*(?:實景|睇樓|全景)/gi, " ")
    .replace(/(?:^|\s)VR(?=\s|$|[!！])/gi, " ");
}
export function normalizePublicListingTitle(raw: string, videoUrl?: string | null) {
  const cleaned = stripUnsupportedVrClaim(raw, videoUrl)
    .replace(/^(?:[!！★☆🔥✨\s]|【(?:筍盤|獨家|急售|推介)】)+/gu, "")
    .replace(/\bPatry\b/gi, "Party")
    .replace(/(?:\s*[!！]){2,}/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "物業放盤";
}
export function publicPropertyTitle(property: PublicProperty & { title_zh: string }) {
  const title =
    activePropertyOfferings(property).length > 1
      ? property.title_zh.replace(/售盤|租盤/g, "放盤")
      : property.title_zh;
  return normalizePublicListingTitle(title, property.video_url);
}

/** Latest actual record update or source check; never substitutes the current clock. */
export function propertyUpdatedAt(property: {
  updated_at?: string | null;
  last_seen_at?: string | null;
  created_at?: string | null;
}): string | null {
  let latest: string | null = null;
  for (const value of [property.updated_at, property.last_seen_at, property.created_at]) {
    if (
      value &&
      Number.isFinite(Date.parse(value)) &&
      (!latest || Date.parse(value) > Date.parse(latest))
    )
      latest = value;
  }
  return latest;
}
