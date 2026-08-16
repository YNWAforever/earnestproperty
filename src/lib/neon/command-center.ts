import { canReplyToConversation, normalizeAdminPhone } from "./admin-workflow.ts";

export const HIGH_SCORE_THRESHOLD = 60;
export const HANDOFF_RECENT_HOURS = 72;
export const WHATSAPP_ACTIVE_HOURS = 72;
export const COMMAND_CENTER_ROW_LIMIT = 200;

export type PriorityReasonCode =
  | "OVERDUE_FOLLOWUP"
  | "RECENT_HANDOFF"
  | "HIGH_SCORE_UNASSIGNED"
  | "NEW_UNASSIGNED_NEEDS_ANALYSIS"
  | "ACTIVE_WHATSAPP"
  | "BY_SCORE"
  | "NEEDS_ANALYSIS";

export type LeadPrioritySignals = {
  leadScore: number | null;
  analyzed: boolean;
  hasOverdueFollowup: boolean;
  recentHandoff: boolean;
  isUnassigned: boolean;
  activeWhatsapp: boolean;
};

export type LeadPriority = {
  bucket: 1 | 2 | 3 | 4 | 5;
  reasonCode: PriorityReasonCode;
};

export function computeLeadPriority(input: LeadPrioritySignals): LeadPriority {
  const highScore = (input.leadScore ?? 0) >= HIGH_SCORE_THRESHOLD;
  // Unanalyzed leads are treated as "needs attention", never silently low.
  const hotSignal = highScore || !input.analyzed;

  if (input.hasOverdueFollowup) return { bucket: 1, reasonCode: "OVERDUE_FOLLOWUP" };
  if (input.recentHandoff) return { bucket: 2, reasonCode: "RECENT_HANDOFF" };
  if (input.isUnassigned && hotSignal) {
    return {
      bucket: 3,
      reasonCode: input.analyzed ? "HIGH_SCORE_UNASSIGNED" : "NEW_UNASSIGNED_NEEDS_ANALYSIS",
    };
  }
  if (input.activeWhatsapp && hotSignal) return { bucket: 4, reasonCode: "ACTIVE_WHATSAPP" };
  return { bucket: 5, reasonCode: input.analyzed ? "BY_SCORE" : "NEEDS_ANALYSIS" };
}

export type CommandCenterSortKey = {
  id: string;
  bucket: number;
  leadScore: number | null;
  overdueMs: number;
  lastActivityMs: number;
};

export function compareCommandCenterRows(a: CommandCenterSortKey, b: CommandCenterSortKey): number {
  if (a.bucket !== b.bucket) return a.bucket - b.bucket;
  const sa = a.leadScore ?? -1;
  const sb = b.leadScore ?? -1;
  if (sa !== sb) return sb - sa;
  if (a.overdueMs !== b.overdueMs) return b.overdueMs - a.overdueMs;
  if (a.lastActivityMs !== b.lastActivityMs) return b.lastActivityMs - a.lastActivityMs;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export type WhatsappBlockedReason =
  | "WOZTELL_DISABLED"
  | "CONTACT_OPTED_OUT"
  | "OUTSIDE_24_HOUR_WINDOW"
  | "NO_PHONE"
  | "NO_OPT_IN"
  | "OPTED_OUT"
  | "NO_CONVERSATION";

export type WhatsappLinkStatus =
  | {
      linked: true;
      conversationId: string;
      status: string;
      lastInboundAt: string | null;
      lastDirection: "inbound" | "outbound" | null;
      canReply: boolean;
      blockedReason: WhatsappBlockedReason | null;
      hasMemberId: boolean;
      hasChannelId: boolean;
    }
  | {
      linked: false;
      blockedReason: Extract<
        WhatsappBlockedReason,
        "NO_PHONE" | "NO_OPT_IN" | "OPTED_OUT" | "NO_CONVERSATION"
      >;
    };

export function resolveWhatsappStatus(input: {
  conversation: {
    id: string;
    status: string;
    lastInboundAt: string | null;
    lastDirection: "inbound" | "outbound" | null;
    woztellMemberId: string | null;
    channelId: string | null;
  } | null;
  phone: string | null;
  optInWhatsapp: boolean;
  optedOutWhatsapp: boolean;
  woztellEnabled: boolean;
  now?: Date;
}): WhatsappLinkStatus {
  if (input.conversation) {
    const reply = canReplyToConversation({
      woztellEnabled: input.woztellEnabled,
      optedOut: input.optedOutWhatsapp,
      lastInboundAt: input.conversation.lastInboundAt,
      now: input.now,
    });
    return {
      linked: true,
      conversationId: input.conversation.id,
      status: input.conversation.status,
      lastInboundAt: input.conversation.lastInboundAt,
      lastDirection: input.conversation.lastDirection,
      canReply: reply.ok,
      blockedReason: reply.ok ? null : (reply.reason as WhatsappBlockedReason),
      hasMemberId: Boolean(input.conversation.woztellMemberId),
      hasChannelId: Boolean(input.conversation.channelId),
    };
  }
  if (!normalizeAdminPhone(input.phone)) return { linked: false, blockedReason: "NO_PHONE" };
  if (input.optedOutWhatsapp) return { linked: false, blockedReason: "OPTED_OUT" };
  if (!input.optInWhatsapp) return { linked: false, blockedReason: "NO_OPT_IN" };
  return { linked: false, blockedReason: "NO_CONVERSATION" };
}
