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
  chosenAgentId?: string | null,
  options?: {
    /** The 負責經紀 shown on the listing page, from property_agents. */
    correspondentAgentId?: string | null;
    /** EP_LEAD_DEFAULT_ASSIGNEE_STAFF_ID, when configured; last resort only. */
    defaultAssigneeId?: string | null;
  },
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
  /** Constrains invalid explicit unit references to review; never chooses a recipient. */
  propertyReferenceRequested?: boolean;
  /** One of the listing's correspondent agents, when the visitor picked one. */
  agentId?: string | null;
  /** Estate named by the enquiry (只講屋苑 case), validated against the registry. */
  estateSlug?: string | null;
  /** The staff id of that estate's manager from the rotation sheet, resolved by the caller. */
  estateManagerStaffId?: string | null;
  consentWhatsapp: boolean;
  /** Honeypot flag: adds a timeline note and an audit row; never drops the enquiry. */
  suspectedBot?: boolean;
};

export const SUSPECTED_BOT_NOTE: string;

export type WebsiteInquiryQuery = (
  sql: string,
  params: unknown[],
) => Promise<Array<Record<string, unknown>>>;

export function persistWebsiteInquiry(
  query: WebsiteInquiryQuery,
  input: WebsiteInquiryPersistenceInput,
): Promise<{ id: string; leadAlertQueued: boolean; forwardingQueued?: boolean }>;
