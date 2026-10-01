import type { EnquiryMode, EventKind, EventOrigin } from "./contracts.ts";
import type { NormalizedWoztellEvent } from "../woztell/woztell.server.ts";

export type ReceiptProjectionState = "pending" | "projected" | "blocked_schema" | "failed";
export type ReceiptDisposition = "new" | "duplicate" | "identity_ambiguous";

export type VerifiedReceiptInput = {
  tenantKey: string;
  appId: string;
  channelId: string;
  event: NormalizedWoztellEvent;
  eventKind: EventKind;
  origin: EventOrigin;
  bodyDigest: string;
  providerEventId?: string | null;
  providerOccurredAt: string | null;
  receivedAt: Date;
  capture: {
    mode: EnquiryMode;
    activationId: string | null;
    effectsEligible: boolean;
  };
};

export type ReceiptResult = {
  receiptId: string;
  identityKey?: string | null;
  disposition: ReceiptDisposition;
  projectionState: ReceiptProjectionState;
};

export type ReceiptRow = {
  id: string;
  normalized_event: NormalizedWoztellEvent | string;
  event_kind: EventKind;
  capture_mode: EnquiryMode;
  origin: EventOrigin;
  identity_key: string | null;
};
export type PortalSource = "28hse" | "propertyhk";
export type PortalDealType = "sale" | "rent";
export type PortalWarning =
  | "text_too_long"
  | "untrusted_portal_url"
  | "unverified_28hse_shape"
  | "propertyhk_shape_unverified"
  | "text_url_id_conflict"
  | "deal_type_conflict"
  | "multiple_references";
export type PortalReference = {
  source: PortalSource;
  sourceEvidence: Array<"url-derived" | "message-declared">;
  originalUrl: string | null;
  canonicalUrl: string | null;
  spans: Array<[number, number]>;
  externalListingId: string | null;
  dealType: PortalDealType | null;
  shape: "verified" | "unverified";
};
export type PortalInterpretation = {
  parserVersion: "portal-intake-v1";
  references: PortalReference[];
  requestedStaffText: string | null;
  estateText: string | null;
  messageDealType: PortalDealType | null;
  quotedPriceHkd: number | null;
  warnings: PortalWarning[];
  requiresReview: boolean;
};
