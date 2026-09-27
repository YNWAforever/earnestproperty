export type MappingReviewEvidence = {
  id: string;
  staffId: string;
  channelId: string;
  providerScope: string;
  inboxUserId: string;
  folderId: string;
  basis: "manual_review" | "provider_verified";
  result: "verified" | "denied" | "unknown";
  checkedAt: string;
  expiresAt: string;
  actorId: string;
  mappingVersion: number | null;
  reasonCode: string | null;
};
export type MappingConflict = {
  code: "MAPPING_VERSION_CONFLICT" | "MAPPING_IDENTITY_CONFLICT";
  latest: {
    mappingId: string;
    version: number;
    eligible: boolean;
    retiredAt: string | null;
  } | null;
};
