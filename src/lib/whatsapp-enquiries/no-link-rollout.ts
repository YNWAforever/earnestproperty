import type { EnquiryMode } from "./contracts.ts";

export type NoLinkCanary = {
  mode: EnquiryMode;
  effectsEnabled: boolean;
  companyChannelId: string | null;
  canaryChannelId: string | null;
  canaryActivationId: string | null;
  canaryStaffIds: readonly string[];
  channelId: string | null;
  activationId: string | null;
};
export type RolloutContext = NoLinkCanary & {
  origin: string | null;
  capturedMode: string | null;
  effectsEligible: boolean;
  noLinkSnapshot: boolean;
  receiptMode: string | null;
  receiptActivationId: string | null;
  receiptReceivedAt: Date | string | null;
  eventOccurredAt: Date | string | null;
  activationCutoverAt: Date | string | null;
  activationEndedAt: Date | string | null;
  timing: string | null;
  identityQuality: string | null;
  candidateStaffId: string | null;
  capturedStaffIds: readonly string[] | null;
  mappingVerified: boolean;
  providerMappingVerified: boolean;
};
export type RolloutDecision = { allowed: boolean; reasons: string[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validUuid = (value: string | null): value is string => !!value && uuid.test(value);
const instant = (value: Date | string | null) => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

/** Capture is a one-way snapshot. Later config changes cannot promote old receipts. */
export function canCaptureNoLinkEffects(input: NoLinkCanary): RolloutDecision {
  const reasons: string[] = [];
  if (input.mode !== "active" || !input.effectsEnabled) reasons.push("mode_or_flag_off");
  if (
    !input.channelId ||
    !input.companyChannelId ||
    !input.canaryChannelId ||
    input.channelId !== input.companyChannelId ||
    input.channelId !== input.canaryChannelId
  )
    reasons.push("channel_not_canary");
  if (
    !validUuid(input.activationId) ||
    !validUuid(input.canaryActivationId) ||
    input.activationId !== input.canaryActivationId
  )
    reasons.push("activation_not_canary");
  if (input.canaryStaffIds.length === 0 || !input.canaryStaffIds.every(validUuid))
    reasons.push("cohort_not_configured");
  return { allowed: reasons.length === 0, reasons };
}

/** Pure server-side preflight; wa_prepare_no_link_followup rechecks DB authority under locks. */
export function canExecuteNoLinkEffects(input: RolloutContext): RolloutDecision {
  const reasons = canCaptureNoLinkEffects(input).reasons;
  if (
    input.origin !== "live_webhook" ||
    input.capturedMode !== "active" ||
    !input.effectsEligible ||
    !input.noLinkSnapshot ||
    input.receiptMode !== "active" ||
    input.receiptActivationId !== input.activationId
  )
    reasons.push("capture_snapshot_not_active");
  const cutover = instant(input.activationCutoverAt);
  const received = instant(input.receiptReceivedAt);
  const occurred = instant(input.eventOccurredAt);
  if (
    cutover === null ||
    received === null ||
    occurred === null ||
    received < cutover ||
    occurred < cutover ||
    input.activationEndedAt !== null ||
    input.timing !== "fresh" ||
    input.identityQuality !== "provider_id"
  )
    reasons.push("receipt_not_fresh_in_activation");
  const currentCohort = input.canaryStaffIds.map((id) => id.toLowerCase()).sort();
  const capturedCohort = input.capturedStaffIds?.map((id) => id.toLowerCase()).sort() ?? [];
  if (
    capturedCohort.length === 0 ||
    !input.capturedStaffIds?.every(validUuid) ||
    JSON.stringify(currentCohort) !== JSON.stringify(capturedCohort)
  )
    reasons.push("cohort_snapshot_changed");
  if (
    !validUuid(input.candidateStaffId) ||
    input.canaryStaffIds.length === 0 ||
    !input.canaryStaffIds.every(validUuid) ||
    !input.canaryStaffIds.some((id) => id.toLowerCase() === input.candidateStaffId?.toLowerCase())
  )
    reasons.push("staff_not_canary");
  if (!input.mappingVerified) reasons.push("mapping_unverified");
  if (!input.providerMappingVerified) reasons.push("provider_mapping_unverified");
  return { allowed: reasons.length === 0, reasons };
}
