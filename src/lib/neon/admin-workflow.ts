import { normalizePhone } from "../phone.js";

/** FX-12 (D-12): the customer phone identity. The name is kept for its importers. */
export function normalizeAdminPhone(value: unknown) {
  return normalizePhone(value);
}

function timeOf(value: Date | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const time = (value instanceof Date ? value : new Date(value)).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * FX-08 D4: an opt-out blocks business-initiated messages. A customer message
 * strictly after the opt-out reopens normal staff text for 24 h ("reopened");
 * templates stay blocked either way. Any missing or unparseable time fails closed.
 */
export function optOutReplyState(input: {
  optedOut: boolean;
  optedOutAt: Date | string | null;
  lastInboundAt: Date | string | null;
  now?: Date;
}): "not_opted_out" | "blocked" | "reopened" {
  if (!input.optedOut) return "not_opted_out";
  const optedOutAt = timeOf(input.optedOutAt);
  const inbound = timeOf(input.lastInboundAt);
  if (optedOutAt === null || inbound === null || !(inbound > optedOutAt)) return "blocked";
  const now = (input.now ?? new Date()).getTime();
  return now - inbound > 24 * 60 * 60 * 1000 ? "blocked" : "reopened";
}

export function canReplyToConversation(input: {
  woztellEnabled: boolean;
  optedOut: boolean;
  optedOutAt?: Date | string | null;
  lastInboundAt: Date | string | null;
  now?: Date;
}):
  | { ok: true }
  | { ok: false; reason: "WOZTELL_DISABLED" | "CONTACT_OPTED_OUT" | "OUTSIDE_24_HOUR_WINDOW" } {
  if (!input.woztellEnabled) return { ok: false as const, reason: "WOZTELL_DISABLED" };
  // Opted out: only a reopen allows text. An expired reopen stays CONTACT_OPTED_OUT, never
  // OUTSIDE_24_HOUR_WINDOW, so the inbox never offers the template picker to an opted-out contact.
  if (input.optedOut) {
    return optOutReplyState({
      optedOut: true,
      optedOutAt: input.optedOutAt ?? null,
      lastInboundAt: input.lastInboundAt,
      now: input.now,
    }) === "reopened"
      ? { ok: true as const }
      : { ok: false as const, reason: "CONTACT_OPTED_OUT" };
  }
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

/**
 * WhatsApp only allows a free-form reply within 24 hours of the customer's last
 * inbound message. Past that, `canReplyToConversation` refuses and staff can
 * only use a template -- so the window is not a detail, it is a deadline.
 */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Under two hours left is the point the inbox starts shouting about it. */
export const REPLY_WINDOW_URGENT_MS = 2 * 60 * 60 * 1000;

/**
 * What the inbox needs to know about a conversation at a glance: is anyone
 * waiting on us, how long have they waited, and how much of the reply window
 * is left.
 *
 * "Awaiting reply" is derived from who spoke last rather than from a read
 * receipt, and that is deliberate. A read flag answers "has a human looked at
 * this", which is not the question staff actually have -- a message you opened,
 * meant to answer and never did still needs answering, yet would show as read
 * and disappear from the queue. Who spoke last cannot drift out of sync with
 * reality, needs no schema column, and cannot be wrong after someone opens the
 * inbox on their phone.
 *
 * Status is deliberately NOT consulted. A closed conversation the customer has
 * written into again is exactly the case worth surfacing, and the list already
 * shows the status badge beside this.
 */
export function conversationAttention(input: {
  awaitingHumanResponse?: boolean | null;
  lastDirection: string | null;
  lastInboundAt: Date | string | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const awaitingReply = input.awaitingHumanResponse ?? input.lastDirection === "inbound";

  const inbound =
    input.lastInboundAt === null || input.lastInboundAt === undefined
      ? null
      : input.lastInboundAt instanceof Date
        ? input.lastInboundAt
        : new Date(input.lastInboundAt);
  const hasInbound = inbound !== null && !Number.isNaN(inbound.getTime());

  if (!hasInbound) {
    return {
      awaitingReply,
      waitedMs: null,
      windowRemainingMs: null,
      windowState: "none" as const,
    };
  }

  // Clamped at zero: a timestamp slightly in the future (clock skew between the
  // database and the browser) would otherwise read as a negative wait and a
  // window longer than 24 hours.
  const waitedMs = Math.max(0, now.getTime() - inbound.getTime());
  const windowRemainingMs = Math.max(0, REPLY_WINDOW_MS - waitedMs);
  const windowState =
    windowRemainingMs <= 0
      ? ("expired" as const)
      : windowRemainingMs <= REPLY_WINDOW_URGENT_MS
        ? ("closing" as const)
        : ("open" as const);

  return { awaitingReply, waitedMs, windowRemainingMs, windowState };
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
  // `draft` is deliberately absent. The blasts page promises 「審核後排程發送」 and
  // offers a Review status, but while draft was queueable that gate was
  // decorative: a half-written campaign with the wrong template still selected
  // was one click from reaching customers. Sending now requires an explicit
  // move to review/scheduled first.
  if (!["review", "scheduled"].includes(input.campaignStatus)) {
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
