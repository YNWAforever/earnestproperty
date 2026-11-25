/**
 * Historical per-recipient proof (repair PR: reviewed staff resend).
 *
 * One flat read-only proof plus one redacted `review` object. The UI and the
 * one-recipient dispatch path consume exactly these fields. There is no historical
 * attempt requirement, no fabricated receipt convention, and no staff-user
 * reconfirmation. Receipt ids are raw uuids taken verbatim from the authoritative
 * `staff.endpoint.configure` audit metadata and point at whatsapp_inbound_receipts.
 */

export type HistoricalReviewedTransport = "website_lead_phone";

/** Stable machine codes for `reasons`. Fail closed; never PII. */
export type HistoricalProofReasonCode =
  | "staff_not_found"
  | "staff_inactive"
  | "directory_mismatch"
  | "endpoint_missing"
  | "endpoint_retired"
  | "transport_not_reviewed_phone"
  | "authority_missing"
  | "authority_mismatch"
  | "timezone_mismatch"
  | "identity_receipt_missing"
  | "purpose_receipt_missing"
  | "hours_receipt_missing"
  | "shared_phone"
  | "phone_approval_revoked"
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
  | "conflict_unresolved";

export type HistoricalMismatch = {
  kind: HistoricalMismatchKind;
  /** A human reviewer must decide; the UI must not approve on its own. */
  requiresManualReview: boolean;
  resolution: "resolved" | "unresolved";
  /** Short reviewer-facing reason; no PII. */
  detail: string;
};

/** What the signed evidence proves. Ids are whatsapp_inbound_receipts uuids. */
export type HistoricalProofReceipt = {
  kind: "consent" | "all_hours" | "destination_proof";
  id: string;
  /** Signed provider ingress receipt accepted on the company app+channel. */
  verified: boolean;
  /** The receipt binds the endpoint's member id. */
  matchedMember: boolean;
  /** The receipt binds the endpoint's destination phone (canonical form). */
  matchedPhone: boolean;
  /** The receipt carries attested content (name/consent/hours). Text is never exported. */
  attested: boolean;
};

export type HistoricalConflictCounts = {
  crmContacts: number;
  /** Contacts provably this staff member (misprojected CRM), not a customer. */
  sameMemberContacts: number;
  openConversations: number;
  otherStaffEndpoints: number;
};

/** Redacted, browser-safe review block. No phone, member id, customer id or text. */
export type HistoricalProofReview = {
  status: "eligible" | "unresolved" | "ineligible";
  mismatch: HistoricalMismatch;
  staffDirectoryMatch: boolean;
  staffActive: boolean;
  sharedPhone: boolean;
  /** destinationProofReceiptId. */
  identityReceiptRef: string | null;
  /** consentReceiptId. */
  purposeRef: string | null;
  /** allHoursReceiptId. */
  hoursReceiptRef: string | null;
  allowAllHours: boolean;
  hoursApproved: boolean;
  /**
   * Opaque business authorization from the audit metadata. It is NOT a provider
   * receipt and never resolves to a whatsapp_inbound_receipts row; it corroborates
   * the audit authority through presence and consistent provenance across the
   * endpoint's configure history.
   */
  companyApprovalRef: string | null;
  companyApprovalProven: boolean;
  /**
   * Earliest signed ingress for the proven member on the company channel. This is
   * corroboration separate from the authority receipts: a misprojected same-member
   * CRM only resolves when the member's first receipt is that same member.
   */
  firstIngressReceiptId: string | null;
  firstIngressMemberMatched: boolean;
  firstIngressAttested: boolean;
  conflictHash: string;
  conflictCounts: HistoricalConflictCounts;
  endpoint: { id: string; version: number; transport: string; enabled: boolean; retired: boolean };
  receipts: HistoricalProofReceipt[];
  checks: { id: string; ok: boolean; detail: string }[];
};

/**
 * Server-only proof. Carries the raw destination because the reviewed action must
 * target the historical recipient exactly; the browser only ever receives `review`
 * plus the masked fields.
 */
export type HistoricalRecipientProof = {
  staffId: string;
  staffName: string;
  channelId: string;
  transport: HistoricalReviewedTransport;
  endpointId: string;
  endpointVersion: number;
  /** Raw destination phone. Server-only; never echoed to the browser. */
  destinationReference: string;
  /** Browser-safe destination, e.g. `••••4567`. */
  maskedDestination: string;
  /** Fail-closed: false means no claim and no send. */
  ready: boolean;
  /** Alias of `ready`, kept for the dispatch path's eligibility check. */
  eligible: boolean;
  /** Stable codes; empty exactly when `ready` is true. */
  reasons: HistoricalProofReasonCode[];
  /** When this read happened. Never part of the fingerprint. */
  checkedAt: string;
  /** Stable sha256 hex over the canonical facts; identical on every re-read. */
  fingerprint: string;
  review: HistoricalProofReview;
};

/**
 * What the browser receives: masked destination, fail-closed verdict and the
 * redacted review. Never the raw phone or member id.
 */
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
