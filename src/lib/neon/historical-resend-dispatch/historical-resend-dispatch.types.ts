import type { StaffAccess } from "../auth.server.ts";
import type { queryRows, transactionRows } from "../db.server.ts";
import type { StaffAlertTemplate } from "../../woztell/staff-alert-template.ts";
import type { StaffNotificationTransport } from "../../whatsapp-enquiries/staff-notifications.server.ts";
import type { resolveHistoricalLead } from "../historical-lead-route.server.ts";
import type {
  HistoricalProofReview,
  HistoricalRecipientProof,
} from "../historical-recipient-proof.types.ts";

/** The authenticated staff actor; role source only, never a client claim. */
export type HistoricalResendActor = Pick<StaffAccess, "staffId" | "roles">;

export type HistoricalLeadResolution = NonNullable<
  Awaited<ReturnType<typeof resolveHistoricalLead>>
>;

/** The signed, read-only server proof for one historical recipient. */
export type HistoricalResendProofResolver = (
  staffId: string,
  channelId: string,
) => Promise<HistoricalRecipientProof | null>;

export type HistoricalResendRuntime = {
  enabled: boolean;
  channelId: string | null;
  template: StaffAlertTemplate | null;
};

/** Why the duplicate/original-lane scan blocked a reviewed resend. */
export type HistoricalResendScan = {
  originalJobsPending: boolean;
  inFlight: boolean;
  priorRecipient: boolean;
  illegible: boolean;
};

export type HistoricalResendLedger = {
  state: "idle" | "in_flight" | "sent" | "unknown" | "failed" | "suppressed";
  dispatchState: string | null;
  attemptId: string | null;
  providerOperationId?: string | null;
};

/** Browser-safe preview: no customer name/phone, no raw staff destination. */
export type HistoricalResendPreview = {
  ready: boolean;
  eligible: boolean;
  reasons: string[];
  leadId: string;
  inquiryId: string | null;
  createdAt: string | null;
  sourceLabel: string | null;
  staffId: string;
  staffName: string | null;
  transport: "website_lead_phone";
  maskedDestination: string | null;
  endpointVersion: number | null;
  message: string | null;
  fingerprint: string | null;
  checkedAt: string;
  /** The proof's already-redacted evidence block (`HistoricalProofReview`). */
  review: HistoricalProofReview | null;
  ledger: HistoricalResendLedger;
};

/** Dispatch is at-most-once: accepted only from an authoritative provider result. */
export type HistoricalResendDispatch = {
  ok: boolean;
  state: "accepted" | "delivered" | "unknown" | "failed" | "suppressed" | "duplicate" | "blocked";
  reason: string | null;
  attemptId: string | null;
  decisionId: string | null;
  providerOperationId: string | null;
  dispatchState: string | null;
};

export type HistoricalResendPorts = {
  query: typeof queryRows;
  transaction: typeof transactionRows;
  resolveLead: (leadId: string, channelId: string) => Promise<HistoricalLeadResolution | null>;
  recipientProof: HistoricalResendProofResolver;
  transport: () => StaffNotificationTransport;
  runtime: () => HistoricalResendRuntime;
  channelId: () => string | null;
  origin: () => string | null;
  now: () => Date;
};
