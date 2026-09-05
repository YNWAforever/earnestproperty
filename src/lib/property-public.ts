import { formatHkd, formatSaleDisplay } from "./format";

export type PublicOffering = {
  id: string;
  listing_no: string;
  deal_type: "sale" | "rent";
  price: number | null;
  rent: number | null;
  status: string;
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
};
export function publicPropertyNo(
  property: Pick<PublicProperty, "listing_no" | "public_listing_no">,
) {
  return property.public_listing_no || property.listing_no;
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
  return deals.size > 1 ? "可買可租" : deals.has("rent") ? "租盤" : "售盤";
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
export function publicPropertyTitle(property: PublicProperty & { title_zh: string }) {
  return activePropertyOfferings(property).length > 1
    ? property.title_zh.replace(/售盤|租盤/g, "放盤")
    : property.title_zh;
}
