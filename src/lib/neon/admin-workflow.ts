export function normalizeAdminPhone(value: unknown) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/\D/g, "");
  return normalized || null;
}

export function canReplyToConversation(input: {
  woztellEnabled: boolean;
  optedOut: boolean;
  lastInboundAt: Date | string | null;
  now?: Date;
}) {
  if (!input.woztellEnabled) return { ok: false as const, reason: "WOZTELL_DISABLED" };
  if (input.optedOut) return { ok: false as const, reason: "CONTACT_OPTED_OUT" };
  const now = input.now ?? new Date();
  if (!input.lastInboundAt) return { ok: false as const, reason: "OUTSIDE_24_HOUR_WINDOW" };
  const inbound =
    input.lastInboundAt instanceof Date ? input.lastInboundAt : new Date(input.lastInboundAt);
  if (Number.isNaN(inbound.getTime())) {
    return { ok: false as const, reason: "OUTSIDE_24_HOUR_WINDOW" };
  }
  if (now.getTime() - inbound.getTime() > 24 * 60 * 60 * 1000) {
    return { ok: false as const, reason: "OUTSIDE_24_HOUR_WINDOW" };
  }
  return { ok: true as const };
}

export function canQueueAdminCampaign(input: {
  campaignStatus: string;
  templateStatus: string | null;
  eligibleRecipients: number;
}) {
  const preflight = canPrepareAdminCampaignQueue(input);
  if (!preflight.ok) return preflight;
  if (input.eligibleRecipients <= 0) {
    return { ok: false as const, reason: "NO_ELIGIBLE_RECIPIENTS" };
  }
  return { ok: true as const };
}

export function canPrepareAdminCampaignQueue(input: {
  campaignStatus: string;
  templateStatus: string | null;
}) {
  if (!["draft", "review", "scheduled"].includes(input.campaignStatus)) {
    return { ok: false as const, reason: "INVALID_CAMPAIGN_STATUS" };
  }
  if (!String(input.templateStatus ?? "").startsWith("active")) {
    return { ok: false as const, reason: "TEMPLATE_NOT_ACTIVE" };
  }
  return { ok: true as const };
}

export function classifyCampaignDeliveryStatus(input: {
  queuedRecipients: number;
  sendingRecipients: number;
  totalRecipients: number;
  failedRecipients: number;
  blockedRecipients: number;
}) {
  if (input.totalRecipients <= 0) return null;
  if (input.failedRecipients + input.blockedRecipients >= input.totalRecipients) return "failed";
  if (input.queuedRecipients + input.sendingRecipients > 0) return "sending";
  return "completed";
}
