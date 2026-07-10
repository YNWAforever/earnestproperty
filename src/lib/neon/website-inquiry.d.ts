export type WebsiteInquiryListing = {
  id: string;
  dealType: "sale" | "rent";
  agentId: string | null;
  agentActive: boolean;
};

export type WebsiteInquiryRouting = {
  propertyId: string | null;
  assignedAgentId: string | null;
  intent: "buyer" | "renter";
};

export function deriveWebsiteInquiryRouting(
  listing: WebsiteInquiryListing | null,
): WebsiteInquiryRouting;
