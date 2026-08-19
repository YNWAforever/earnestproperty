import "@tanstack/react-start/server-only";

import crypto from "node:crypto";

export type NormalizedWoztellEvent = {
  direction: "inbound" | "outbound";
  externalMessageId: string;
  /**
   * The id this event WOULD have synthesized before the content digest was
   * added, or null when WOZTELL supplied a real messageId (in which case the
   * id never changed and there is nothing to reconcile).
   *
   * Rows imported before that change are already stored under this key, so
   * ingest has to treat a legacy hit as "already have it" -- otherwise the
   * first import after deploying would re-insert every one of them under its
   * new id and show the whole inbox twice. See the guard in
   * woztell-ingest.server.ts.
   */
  legacyExternalMessageId: string | null;
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

/**
 * Opt-out detection has to be wrong as rarely as possible in BOTH directions,
 * and the two failure modes cost different things:
 *
 *  - False positive: the flag is written monotonically by the webhook
 *    (`opted_out_whatsapp = opted_out_whatsapp OR $7`), so mis-reading
 *    「我想取消今日睇樓約會」 as an opt-out blocks every staff reply and every
 *    campaign for that contact until an admin clears it.
 *  - False negative: the agency keeps marketing to someone who asked it to
 *    stop. That is the PDPO problem, and it is the more expensive one.
 *
 * So the terms are split by how ambiguous they are, rather than by language.
 */

/**
 * Phrases that cannot plausibly mean anything except "stop messaging me".
 * Matched ANYWHERE in the message, because there is no sentence in which
 * 「取消訂閱」 or 「拒收」 is incidental. Both Traditional and Simplified are listed;
 * the agency's customers write both.
 */
const UNAMBIGUOUS_OPT_OUT_PHRASES = [
  "取消訂閱",
  "取消订阅",
  "退訂",
  "退订",
  "停止發送",
  "停止发送",
  "停止接收",
  "停止接受",
  "拒收",
  "不再接收",
  "不想再收",
  "唔想再收",
  "唔要再send",
  "unsubscribe",
  "opt out",
  "optout",
  "remove me",
];

/**
 * Bare stems that DO appear mid-sentence for innocent reasons -- 取消 in
 * 「我想取消今日睇樓約會」, 停止 in 「請停止安排星期六睇樓」, 不要 in 「不要太貴嘅盤」.
 * These only count when they are the whole message, after politeness prefixes
 * and punctuation are stripped.
 */
const AMBIGUOUS_OPT_OUT_STEMS = ["取消", "停止", "唔要", "不要", "不用"];

/**
 * Latin stems matched on word boundaries, so "please stop" opts out but
 * "stopover" does not.
 */
const LATIN_OPT_OUT_STEMS = ["stop"];

/**
 * Leading politeness that carries no meaning for this decision, so 「唔該停止」 and
 * 「我要取消」 reduce to the bare stem. Ordered longest-first so 唔該 is consumed
 * before 唔.
 */
const POLITENESS_PREFIXES = [
  "唔該晒",
  "唔該",
  "麻煩晒",
  "麻煩你",
  "麻煩",
  "please",
  "pls",
  "我想要",
  "我想",
  "我要",
  "我唔想",
  "請你",
  "请你",
  "請",
  "请",
];

/** Strip punctuation, symbols and whitespace so 「取消！」 and "STOP." still match. */
function stripPunctuation(text: string) {
  return text.replace(/[\p{P}\p{S}\p{Z}\s]/gu, "");
}

function stripPolitenessPrefixes(text: string) {
  let result = text;
  // Loop so 「唔該請取消」 reduces all the way down.
  for (let pass = 0; pass < 3; pass += 1) {
    const before = result;
    for (const prefix of POLITENESS_PREFIXES) {
      if (result.startsWith(prefix)) {
        result = result.slice(prefix.length);
        break;
      }
    }
    if (result === before) break;
  }
  return result;
}

export function isOptOutText(value: string | null | undefined) {
  // NFKC folds full-width Latin (ＳＴＯＰ) onto ASCII before casefolding, so a
  // customer typing on a Chinese IME is not silently ignored.
  const text = (value ?? "").normalize("NFKC").trim().toLowerCase();
  if (!text) return false;

  const bare = stripPunctuation(text);
  if (!bare) return false;

  // 1. Unambiguous phrases, anywhere in the message.
  if (UNAMBIGUOUS_OPT_OUT_PHRASES.some((phrase) => bare.includes(stripPunctuation(phrase)))) {
    return true;
  }

  // 2. Ambiguous stems, only once the message is nothing but the stem.
  const stem = stripPolitenessPrefixes(bare);
  if (AMBIGUOUS_OPT_OUT_STEMS.includes(stem)) return true;

  // 3. Latin stems on word boundaries. The boundary class is "not a Latin
  //    letter and not a digit" rather than \P{L}: CJK characters ARE letters,
  //    so \P{L} never matched next to one and 「請stop」 / 「STOP啦」 slipped past.
  return LATIN_OPT_OUT_STEMS.some((term) =>
    new RegExp(`(?:^|[^\\p{Script=Latin}\\p{N}])${term}(?:[^\\p{Script=Latin}\\p{N}]|$)`, "u").test(
      text,
    ),
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

function identityValue(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const identity = record(value);
    return stringOrNull(identity.id ?? identity._id ?? identity.memberId ?? identity.channelId);
  }
  return stringOrNull(value);
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

/**
 * Deterministic JSON: object keys sorted, so two records holding the same
 * message hash identically no matter what order the two ingest surfaces
 * happened to build them in.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as AnyRecord)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

/**
 * A short fingerprint of the message body, used to tell apart two events that
 * share a member, a direction, a type AND a timestamp.
 *
 * Hashes `data` rather than just `data.text` so media messages -- whose content
 * lives in a url/id field and whose text is null -- are discriminated too.
 * `data` is the one field both ingest surfaces read from the identical
 * envelope, which is what keeps the digest stable across them.
 */
function contentDigest(data: AnyRecord) {
  return crypto.createHash("sha256").update(canonicalJson(data)).digest("hex").slice(0, 12);
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
  const channelId = identityValue(
    payload.channelId ?? payload.channel ?? source.channelId ?? source.channel,
  );
  const memberId = identityValue(
    payload.memberId ?? payload.member ?? source.memberId ?? source.member,
  );
  const messageType = stringOrNull(source.type) ?? "UNKNOWN";
  const timestampRaw = source.timestamp ?? payload.timestamp;
  const providedMessageId = stringOrNull(source.messageId ?? payload.messageId);

  // WOZTELL omits messageId on plenty of events -- inbound webhook payloads
  // routinely arrive without one -- so the id has to be synthesized. It lands
  // in whatsapp_messages.external_message_id, which is UNIQUE and written with
  // ON CONFLICT DO NOTHING, so two DISTINCT messages sharing a synthesized id
  // do not error: the second is silently discarded and counted as a duplicate.
  //
  // The key used to stop at the timestamp, and WOZTELL timestamps are unix
  // SECONDS. A customer sending two lines in a row, or a bot answering in two
  // bubbles, produced one id for two messages -- so the inbox quietly held one
  // fewer message than the WOZTELL console. The content digest is what makes
  // the key discriminate; everything before it is kept so the id still reads as
  // the message it belongs to.
  const legacyKey = `${direction}:${channelId ?? "channel"}:${memberId ?? "member"}:${stringOrNull(timestampRaw) ?? "time"}:${messageType}`;
  const externalMessageId = providedMessageId ?? `${legacyKey}:${contentDigest(data)}`;

  return {
    direction,
    externalMessageId,
    legacyExternalMessageId: providedMessageId ? null : legacyKey,
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
  memberId: string;
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
        memberId: input.memberId,
        response: input.response,
      }),
    },
  );

  const rawBody = await res.text();
  let body: unknown = {};
  if (rawBody.trim()) {
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      return { ok: false, error: "WOZTELL_INVALID_RESPONSE", status: res.status };
    }
  }
  if (res.ok) return { ok: true, body, status: res.status };

  const providerError =
    body && typeof body === "object" && "error" in body
      ? String((body as Record<string, unknown>).error).slice(0, 500)
      : `WOZTELL_HTTP_${res.status}`;
  return { ok: false, error: providerError, status: res.status };
}

export { deliverWoztellCampaign } from "./campaign-delivery.server.ts";
