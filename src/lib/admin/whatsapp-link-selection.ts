import type { ManagedPropertySummary } from "../neon/admin-properties.types.ts";

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
