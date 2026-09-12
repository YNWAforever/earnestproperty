import type { EventKind } from "./contracts.ts";
function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
/** Documentation-derived contracts; no tenant mapping or survey token is implicitly trusted. */
export function classifyWoztellEvent(
  payload: Record<string, unknown>,
  options: { now?: Date; maxAgeMs?: number; verifiedStaffId?: string | null } = {},
) {
  const wrapped = record(payload.messageEvent),
    source = Object.keys(wrapped).length ? wrapped : payload;
  const type = str(source.type)?.toUpperCase() ?? "UNKNOWN",
    outer = str(payload.type)?.toUpperCase();
  const eventType = str(payload.eventType)?.toUpperCase();
  const meta = record(payload.meta),
    integration = record(meta.source ?? meta.apiSource ?? meta.__source__);
  const agentUserId = str(meta.agentUserId),
    integrationId = str(integration.integrationId);
  const raw = source.timestamp ?? payload.timestamp;
  let millis = NaN;
  if ((typeof raw === "number" || typeof raw === "string") && String(raw).trim()) {
    const n = Number(raw);
    millis = Number.isFinite(n) ? (n > 9999999999 ? n : n * 1000) : Date.parse(String(raw));
  }
  const valid = Number.isFinite(millis) && Math.abs(millis) <= 8640000000000000;
  const now = (options.now ?? new Date()).getTime();
  const timing = !valid
    ? "invalid_or_missing"
    : millis > now
      ? "future"
      : now - millis > (options.maxAgeMs ?? 86400000)
        ? "stale"
        : "fresh";
  const surveyCandidate = ["BUTTON", "INTERACTIVE", "QUICK_REPLY", "POSTBACK"].includes(type);
  let kind: EventKind = "unsupported";
  if (
    ["SENT", "DELIVERED", "READ", "FAILED", "DELETED"].includes(type) ||
    (type === "UNKNOWN" && source.error)
  )
    kind = "delivery_receipt";
  else if (["NOTE", "INTERNAL_NOTE"].includes(type) || eventType === "INTERNAL_NOTE")
    kind = "internal_note";
  else if (["MEMBER_UPDATE", "BATCH_MEMBER_UPDATE", "NODE_TRIGGER"].includes(eventType ?? ""))
    kind = "control_event";
  else if (Object.keys(wrapped).length > 0 && outer && !["BOT", "MANUAL", "RELAY"].includes(outer))
    kind = "unsupported";
  else if (
    eventType &&
    !["INBOUND", "API_OUTBOUND", "BOT_OUTBOUND", "BROADCAST_OUTBOUND"].includes(eventType)
  )
    kind = "unsupported";
  else if (["BOT", "MANUAL", "RELAY"].includes(outer ?? "") || eventType?.endsWith("_OUTBOUND")) {
    kind =
      outer === "BOT" || eventType === "BOT_OUTBOUND" || eventType === "BROADCAST_OUTBOUND"
        ? "automated_outbound"
        : integrationId === "inbox" && agentUserId && options.verifiedStaffId
          ? "staff_outbound"
          : "unverified_outbound";
  } else if (
    !surveyCandidate &&
    ["TEXT", "MISC", "IMAGE", "VIDEO", "AUDIO", "FILE", "LOCATION", "CONTACT", "STICKER"].includes(
      type,
    )
  )
    kind = "customer_message";
  return {
    kind,
    surveyCandidate,
    occurredAt: valid ? new Date(millis).toISOString() : null,
    timing,
    direction:
      kind === "customer_message" ||
      (surveyCandidate &&
        (!Object.keys(wrapped).length || !outer) &&
        (!eventType || eventType === "INBOUND"))
        ? ("inbound" as const)
        : ["staff_outbound", "automated_outbound", "unverified_outbound"].includes(kind)
          ? ("outbound" as const)
          : null,
    evidence: {
      agentUserId,
      integrationId,
      appIntegration: str(integration.appIntegration),
      staffId: kind === "staff_outbound" ? options.verifiedStaffId : null,
      eventType: eventType ?? null,
    },
  };
}
