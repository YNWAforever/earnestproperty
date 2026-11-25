/**
 * Historical per-recipient proof (repair PR: reviewed staff resend).
 *
 * One flat read-only proof plus one redacted `review` object. Evidence is frozen
 * human-reviewed digest data for this single fixed batch, not "non-empty text".
 * The browser view omits receipt uuids, contact ids and the opaque company approval.
 */

export type HistoricalReviewedTransport = "website_lead_phone";

export type HistoricalProofReasonCode =
  | "staff_not_found"
  | "staff_inactive"
  | "directory_mismatch"
  | "endpoint_missing"
  | "endpoint_retired"
  | "transport_not_reviewed_phone"
  | "permission_missing"
  | "authority_missing"
  | "authority_mismatch"
  | "timezone_mismatch"
  | "company_approval_missing"
  | "identity_receipt_missing"
  | "purpose_receipt_missing"
  | "hours_not_approved"
  | "shared_phone"
  | "phone_approval_revoked"
  | "first_confirmation_missing"
  | "conflict_unresolved";

export type HistoricalMismatchKind =
  | "none"
  | "staff_inactive"
  | "directory_mismatch"
  | "endpoint_missing"
  | "endpoint_retired"
  | "transport_not_reviewed_phone"
  | "authority_mismatch"
  | "identity_receipt_missing"
  | "purpose_receipt_missing"
  | "hours_not_approved"
  | "shared_phone"
  | "phone_approval_revoked"
  | "first_confirmation_missing"
  | "conflict_unresolved";

export type HistoricalMismatch = {
  kind: HistoricalMismatchKind;
  /** A human reviewer must decide; the UI must not approve on its own. */
  requiresManualReview: boolean;
  resolution: "resolved" | "unresolved";
  detail: string;
};

/** A signed receipt whose human review is frozen as a digest for this batch. */
export type HistoricalProofReceipt = {
  kind: "consent" | "all_hours" | "destination_proof";
  /** Bound to the company app/channel/member/phone by the database canonicaliser. */
  verified: boolean;
  matchedMember: boolean;
  matchedPhone: boolean;
  /** The frozen human-reviewed digest matches; non-empty text alone never attests. */
  frozen: boolean;
  /** Alias of `frozen` for consumers that label the result "attested". */
  attested: boolean;
};

/** Which independent corroboration resolves the CRM conflict on this row. */
export type HistoricalConflictResolution =
  | "clear"
  | "staff_confirmation_projection"
  | "current_phone_approval"
  | "unresolved";

export type HistoricalConflictCounts = {
  crmContacts: number;
  /** Contacts provably this staff member (misprojected CRM), not a customer. */
  sameMemberContacts: number;
  openConversations: number;
  otherStaffEndpoints: number;
};

/** Redacted, browser-safe review block: booleans, counts and receipt kinds only. */
export type HistoricalProofReview = {
  status: "eligible" | "unresolved";
  mismatch: HistoricalMismatch;
  staffDirectoryMatch: boolean;
  staffActive: boolean;
  sharedPhone: boolean;
  allowAllHours: boolean;
  hoursApproved: boolean;
  companyApprovalProven: boolean;
  firstConfirmationFrozen: boolean;
  conflictHash: string;
  conflictResolution: HistoricalConflictResolution;
  conflictCounts: HistoricalConflictCounts;
  endpoint: { version: number; transport: string; enabled: boolean; retired: boolean };
  receipts: HistoricalProofReceipt[];
};

/** Server-only proof: carries the raw destination and the evidence references. */
export type HistoricalRecipientProof = {
  staffId: string;
  staffName: string;
  channelId: string;
  transport: HistoricalReviewedTransport;
  endpointId: string;
  endpointVersion: number;
  destinationReference: string;
  maskedDestination: string;
  ready: boolean;
  eligible: boolean;
  reasons: HistoricalProofReasonCode[];
  checkedAt: string;
  fingerprint: string;
  review: HistoricalProofReview;
};

/** Browser projection: review without receipt uuids, opaque approval, or raw ids. */
export type HistoricalRecipientProofPublic = {
  staffName: string;
  maskedDestination: string;
  ready: boolean;
  eligible: boolean;
  reasons: HistoricalProofReasonCode[];
  checkedAt: string;
  fingerprint: string;
  review: HistoricalProofReview;
};

/** `••••` + last four characters, matching maskStaffDestination() semantics. */
export function maskHistoricalIdentifier(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.replace(/\s/g, "");
  return trimmed.length <= 4 ? trimmed : `••••${trimmed.slice(-4)}`;
}
