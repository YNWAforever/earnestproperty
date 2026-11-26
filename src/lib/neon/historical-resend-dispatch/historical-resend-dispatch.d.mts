export declare const HISTORICAL_RESEND_ATTEMPT_PREFIX: "historical-resend:";
export declare const HISTORICAL_RESEND_TRANSPORT: "website_lead_phone";
export declare const HISTORICAL_RESEND_STALE_SECONDS: 300;
export declare const HISTORICAL_RESEND_PHONE: RegExp;
export declare const HISTORICAL_RESEND_FINGERPRINT: RegExp;
export declare const HISTORICAL_RESEND_UUID: RegExp;
export declare const HISTORICAL_RESEND_FINGERPRINT_VERSION: "historical-resend-v1";
export declare const HISTORICAL_RESEND_REASONS: Readonly<{
  runtimeDisabled: "runtime_disabled";
  templateUnconfigured: "template_unconfigured";
  channelUnconfigured: "channel_unconfigured";
  originUnconfigured: "origin_unconfigured";
  channelMismatch: "channel_mismatch";
  leadNotFound: "lead_not_found";
  recipientNotInScope: "recipient_not_in_historical_scope";
  noRecipientProof: "no_recipient_proof";
  proofStaffMismatch: "proof_staff_mismatch";
  proofEndpointInvalid: "proof_endpoint_invalid";
  proofNotPhone: "proof_transport_not_phone";
  proofNotReady: "proof_not_ready";
  proofChannelMismatch: "proof_channel_mismatch";
  proofFingerprintInvalid: "proof_fingerprint_invalid";
  proofEndpointChanged: "proof_endpoint_changed";
  originalJobsPending: "original_jobs_pending";
  crossRouteInFlight: "cross_route_in_flight";
  recipientAlreadySent: "recipient_already_sent";
  duplicateReviewRequired: "duplicate_review_required";
  ledgerTerminal: "ledger_terminal";
  ledgerUnknownPermanent: "ledger_unknown_permanent";
  historicalMigrationPending: "historical_migration_pending";
}>;
export declare function historicalResendAttemptKey(leadId: string, staffId: string): string;
export declare function isHistoricalResendAttemptKey(value: unknown): boolean;
export declare function historicalResendMessage(sourceLabel: string): string;
export type HistoricalResendFingerprintParts = {
  leadFingerprint: string;
  proofFingerprint: string;
  leadId: string;
  staffId: string;
  channelId: string;
  transport: string;
  endpointId: string;
  endpointVersion: number;
  destinationReference: string;
  message: string;
  template: import("../../woztell/staff-alert-template.ts").StaffTemplateResponse;
};
export declare function historicalResendFingerprint(
  parts: HistoricalResendFingerprintParts,
): string;
export declare function historicalResendProofReasons(
  proof: {
    staffId?: unknown;
    transport?: unknown;
    channelId?: unknown;
    endpointId?: unknown;
    endpointVersion?: unknown;
    destinationReference?: unknown;
    fingerprint?: unknown;
    ready?: unknown;
    reasons?: unknown;
  } | null,
  channelId: string,
  staffId: string,
): string[];
export type HistoricalResendLedgerKind =
  | "idle"
  | "in_flight"
  | "sent"
  | "unknown"
  | "failed"
  | "suppressed";
export declare function historicalResendLedgerState(state: unknown): HistoricalResendLedgerKind;
export declare function isHistoricalResendPermanent(state: unknown): boolean;
export declare function historicalResendOutcome(
  result: {
    state?: string;
    evidenceKind?: string | null;
    providerOperationId?: string | null;
  } | null,
): {
  dispatchState: "accepted" | "failed" | "suppressed" | "unknown";
  ok: boolean;
  evidenceKind?: string | null;
  providerOperationId?: string | null;
  reason?: string;
};
