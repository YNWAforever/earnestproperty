import type { ManagedPropertySummary } from "../neon/admin-properties.types.ts";
import { formatPrice } from "../format.ts";

export type LinkOfferSelection = {
  propertyId: string;
  publicListingNo: string;
  dealType: "sale" | "rent";
  title: string;
  price: number | null;
  agentId: string | null;
  agentName: string | null;
};

export function linkOffersFromGroups(groups: ManagedPropertySummary[]): LinkOfferSelection[] {
  return groups.flatMap((group) => {
    if (group.unlinked) return [];
    return (["sale", "rent"] as const).flatMap((dealType) => {
      const offer = group.offerings[dealType];
      if (!offer || offer.status !== "active") return [];
      return [
        {
          propertyId: offer.id,
          publicListingNo: group.propertyNo,
          dealType,
          title: offer.title || group.title,
          price: dealType === "sale" ? offer.price : offer.rent,
          agentId: offer.agentId,
          agentName: offer.agentName,
        },
      ];
    });
  });
}

export const linkSeedKey = "earnest:whatsapp-link-seed:v1";

/** The wizard's offer label. Staff confirm links against it, so the price is exact
 *  (formatPrice exact), a stored 0 shows as HK$0, and only a missing price says 價格待核實. */
export function linkOfferLabel(offer: LinkOfferSelection): string {
  const price =
    offer.price === 0
      ? "HK$0"
      : (formatPrice(offer.price, { dealType: offer.dealType, exact: true }) ?? "價格待核實");
  return `${offer.publicListingNo} · ${offer.dealType === "sale" ? "售" : "租"} · ${offer.title} · ${price}`;
}
