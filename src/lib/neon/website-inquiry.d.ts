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

export const WEBSITE_LISTING_NO_PATTERN: RegExp;

export function isValidWebsiteListingNo(value: unknown): value is string;

export type WebsiteInquiryPersistenceInput = {
  submissionId?: string;
  name: string;
  phone: string;
  normalizedPhone: string | null;
  email: string | null;
  message: string | null;
  listingNo: string | null;
  propertyId: string | null;
  consentWhatsapp: boolean;
};

export type WebsiteInquiryQuery = (
  sql: string,
  params: unknown[],
) => Promise<Array<Record<string, unknown>>>;

export function persistWebsiteInquiry(
  query: WebsiteInquiryQuery,
  input: WebsiteInquiryPersistenceInput,
): Promise<{ id: string }>;
