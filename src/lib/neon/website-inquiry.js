export function deriveWebsiteInquiryRouting(listing) {
  if (!listing) {
    return {
      propertyId: null,
      assignedAgentId: null,
      intent: "buyer",
    };
  }

  return {
    propertyId: listing.id,
    assignedAgentId: listing.agentActive && listing.agentId ? listing.agentId : null,
    intent: listing.dealType === "rent" ? "renter" : "buyer",
  };
}
