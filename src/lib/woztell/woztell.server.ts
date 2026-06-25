import "@tanstack/react-start/server-only";

import crypto from "node:crypto";

export type NormalizedWoztellEvent = {
  direction: "inbound" | "outbound";
  externalMessageId: string;
  fromPhone: string | null;
  toPhone: string | null;
  timestamp: string;
  messageType: string;
  text: string | null;
  woztellMemberId: string | null;
  channelId: string | null;
  appId: string | null;
  memberName: string | null;
  payload: Record<string, unknown>;
};

type AnyRecord = Record<string, unknown>;

export function verifyWoztellSignature(
  body: Buffer | string,
  signature: string | null | undefined,
  secret: string | null | undefined,
) {
  if (!signature || !secret) return false;

  // Strip an optional scheme prefix (e.g. "sha256=") and surrounding whitespace.
  const normalized = signature.trim().replace(/^sha256=/i, "");
  if (!normalized) return false;

  const hmac = crypto.createHmac("sha256", secret).update(body).digest();
  const actual = Buffer.from(normalized);

  // The header may carry the digest as either base64 or hex; accept both.
  for (const encoding of ["base64", "hex"] as const) {
    const expected = Buffer.from(hmac.toString(encoding));
    if (expected.length === actual.length && crypto.timingSafeEqual(expected, actual)) {
      return true;
    }
  }
  return false;
}

export function isOptOutText(value: string | null | undefined) {
  const text = (value ?? "").trim().toLowerCase();
  return ["stop", "unsubscribe", "取消", "停止", "退訂", "唔要", "不要"].some(
    (term) => text === term || text.includes(term),
  );
}

export function canSendFreeFormMessage({
  lastInboundAt,
  now = new Date(),
}: {
  lastInboundAt: Date | string | null;
  now?: Date;
}) {
  if (!lastInboundAt) return false;
  const inbound = lastInboundAt instanceof Date ? lastInboundAt : new Date(lastInboundAt);
  if (Number.isNaN(inbound.getTime())) return false;
  return now.getTime() - inbound.getTime() <= 24 * 60 * 60 * 1000;
}

export function isBlastRecipientAllowed({
  optedIn,
  optedOut,
}: {
  optedIn: boolean;
  optedOut: boolean;
}) {
  return optedIn && !optedOut;
}

function record(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : {};
}

function stringOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function eventTimestamp(value: unknown) {
  const raw = stringOrNull(value) ?? String(Math.floor(Date.now() / 1000));
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    const millis = numeric > 9_999_999_999 ? numeric : numeric * 1000;
    return new Date(millis).toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export function normalizeWoztellEvent(payload: AnyRecord): NormalizedWoztellEvent {
  const wrappedEvent = record(payload.messageEvent);
  const source = Object.keys(wrappedEvent).length > 0 ? wrappedEvent : payload;
  const outboundType = stringOrNull(payload.type);
  const direction =
    outboundType === "BOT" || outboundType === "MANUAL" || outboundType === "RELAY"
      ? "outbound"
      : "inbound";
  const data = record(source.data);
  const channelId = stringOrNull(payload.channel ?? source.channel);
  const memberId = stringOrNull(payload.member ?? source.member);
  const messageType = stringOrNull(source.type) ?? "UNKNOWN";
  const timestampRaw = source.timestamp ?? payload.timestamp;
  const externalMessageId =
    stringOrNull(source.messageId) ??
    `${direction}:${channelId ?? "channel"}:${memberId ?? "member"}:${stringOrNull(timestampRaw) ?? "time"}:${messageType}`;

  return {
    direction,
    externalMessageId,
    fromPhone: stringOrNull(source.from),
    toPhone: stringOrNull(source.to),
    timestamp: eventTimestamp(timestampRaw),
    messageType,
    text: stringOrNull(data.text),
    woztellMemberId: memberId,
    channelId,
    appId: stringOrNull(payload.app ?? source.app),
    memberName: stringOrNull(record(payload.memberExtra ?? source.memberExtra).name),
    payload,
  };
}

export function woztellEnabled() {
  return process.env.WOZTELL_ENABLED === "true";
}

export function woztellConfig() {
  return {
    enabled: woztellEnabled(),
    accessToken: process.env.WOZTELL_BOT_ACCESS_TOKEN,
    channelId: process.env.WOZTELL_CHANNEL_ID,
    channelSecret: process.env.WOZTELL_CHANNEL_SECRET,
  };
}

export async function sendWoztellResponse(input: {
  recipientId: string;
  response: Record<string, unknown>[];
}) {
  const config = woztellConfig();
  if (!config.enabled) {
    return { ok: false, error: "WOZTELL_ENABLED is not true" };
  }
  if (!config.accessToken || !config.channelId) {
    return { ok: false, error: "Missing WOZTELL_BOT_ACCESS_TOKEN or WOZTELL_CHANNEL_ID" };
  }

  const res = await fetch(
    `https://bot.api.woztell.com/sendResponses?accessToken=${encodeURIComponent(config.accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channelId: config.channelId,
        recipientId: input.recipientId,
        response: input.response,
      }),
    },
  );

  const body = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, body } : { ok: false, error: JSON.stringify(body) };
}
