export const ENQUIRY_SCOPE: {
  readonly UNIT: "unit";
  readonly ESTATE: "estate";
  readonly UNKNOWN: "unknown";
};

export type EnquiryScope = "unit" | "estate" | "unknown";

export function classifyEnquiryScope(input?: {
  propertyId?: string | null;
  listingNo?: string | null;
  estateSlug?: string | null;
}): EnquiryScope;

export function resolveLeadAssignment(input?: {
  scope?: EnquiryScope;
  chosenAgentId?: string | null;
  correspondentAgentId?: string | null;
  listingAgentId?: string | null;
  listingAgentActive?: boolean;
  estateManagerStaffId?: string | null;
  defaultAssigneeId?: string | null;
}): string | null;

export function scopeFallbackAssigneeId(input?: {
  scope?: EnquiryScope;
  estateManagerStaffId?: string | null;
  defaultAssigneeId?: string | null;
}): string | null;
