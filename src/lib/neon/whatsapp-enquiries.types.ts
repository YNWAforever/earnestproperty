export type TrackingLinkInput = {
  referenceMappingId?: string | null;
  placementSource: "website" | "28hse" | "youtube" | "other";
  entryPointType: "sales" | "reception";
  publicListingNo?: string | null;
  propertyId?: string | null;
  dealType?: "sale" | "rent" | null;
  requestedStaffId?: string | null;
  branchId?: string | null;
  externalListingId?: string | null;
  videoId?: string | null;
  placementVerified?: boolean;
  enabled: boolean;
};
export type TrackingLink = TrackingLinkInput & {
  id: string;
  code: string;
  version: number;
  channelId: string;
  createdAt: string;
  placementVerifiedAt: string | null;
};
