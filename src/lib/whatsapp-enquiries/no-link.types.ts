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
  disposition: ReceiptDisposition;
  projectionState: ReceiptProjectionState;
};

export type ReceiptRow = {
  id: string;
  normalized_event: NormalizedWoztellEvent | string;
  event_kind: EventKind;
  capture_mode: EnquiryMode;
  origin: EventOrigin;
};
