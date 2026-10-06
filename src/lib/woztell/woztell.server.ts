import "@tanstack/react-start/server-only";

import crypto from "node:crypto";
import { boundedProviderFetch } from "./provider-fetch.ts";
import { parseWoztellProviderResult } from "./provider-result.ts";

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
  /** Receipt projection authority; synthetic/missing IDs may never enable active effects. */
  identityCertainty?: "provider" | "ambiguous";
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
 * Opt-out detection (FX-08, owner decision D4, 2026-10-06).
 *
 * Only an exact whole-message opt-out word counts as an opt-out. Sentences,
 * stems and old phrases (「唔要」, "Can I stop by?", "bus stop", 「我要退訂」)
 * are NOT opt-outs: a false positive blocks every business-initiated message
 * (staff-initiated outbound and campaigns) to that contact. An opt-out blocks
 * business-initiated messages only, and the flag is recorded together with the
 * evidence (the message that triggered it).
 *
 * Requests that clearly ask to stop but are not an exact word are "near-misses"
 * (isOptOutNearMiss). They are display-only: staff review them, and they never
 * set any flag. A message is never both an opt-out and a near-miss.
 *
 * Everything here is pure: no environment, network or database access.
 */

/** D4 (owner, 2026-10-06). Canonical, already normalised forms. Simplified forms per Open question 1. */
export const OPT_OUT_WORDS: ReadonlySet<string> = new Set([
  "stop",
  "unsubscribe",
  "退訂",
  "退订",
  "取消訂閱",
  "取消订阅",
  "停止接收",
]);

/**
 * Owner decision 7. CJK / spaced-Latin phrases that mean "stop messaging me" and are
 * matched anywhere in the normalised message (inner whitespace already removed, so
 * "remove me" and "opt out" match as `removeme` / `optout`).
 */
export const OPT_OUT_NEAR_MISS_PHRASES: readonly string[] = [
  "唔好再send",
  "唔好再發",
  "唔好再傳",
  "唔好再传",
  "唔使再send",
  "唔要再send",
  "唔想再收",
  "不想再收",
  "不要再發",
  "不要再发",
  "不要再傳",
  "不再接收",
  "停止發送",
  "停止发送",
  "拒收",
  "唔好再搵我",
  "不要再聯絡我",
  "唔好再聯絡我",
  "removeme",
  "optout",
];

const OPT_OUT_MAX_LENGTH = 64;
const NEAR_MISS_MAX_LENGTH = 280;

const NON_ASCII = /\P{ASCII}/u;
const CJK_OPT_OUT_WORDS = [...OPT_OUT_WORDS].filter((word) => NON_ASCII.test(word));

/** Zero-width characters and variation selectors that IMEs and emoji keyboards append. */
const INVISIBLE_CHARS = /[\p{Cf}\p{Variation_Selector}]/gu;
const EDGE_NOISE = /^[\p{P}\p{S}\p{Z}\s]+|[\p{P}\p{S}\p{Z}\s]+$/gu;
const NOT_LATIN_OR_DIGIT_BEFORE = String.raw`(?<![\p{Script=Latin}\p{N}])`;
const NOT_LATIN_OR_DIGIT_AFTER = String.raw`(?![\p{Script=Latin}\p{N}])`;

/** NFKC, drop invisible chars, lower-case, trim edge punctuation/symbols/space. Inner spacing kept. */
function foldEdges(value: string | null | undefined, maxLength: number) {
  if (value == null) return "";
  const text = value.normalize("NFKC").replace(INVISIBLE_CHARS, "").toLowerCase();
  if (text.length > maxLength) return "";
  return text.replace(EDGE_NOISE, "");
}

/** NFKC → drop zero-width/variation chars → trim [\p{P}\p{S}\p{Z}\s] at both ends → remove inner [\p{Z}\s] → toLowerCase. "" for null/undefined/over-length. */
export function normalizeOptOutCandidate(value: string | null | undefined): string {
  return foldEdges(value, OPT_OUT_MAX_LENGTH).replace(/[\p{Z}\s]+/gu, "");
}

/** True only when the whole normalised message is in OPT_OUT_WORDS. Never word-boundary, never substring. */
export function isOptOutText(value: string | null | undefined): boolean {
  return OPT_OUT_WORDS.has(normalizeOptOutCandidate(value));
}

const STOP_FILLER_LATIN = new RegExp(
  String.raw`${NOT_LATIN_OR_DIGIT_BEFORE}(please|pls|plz|now|thanks|thanks+you|thx|ok)${NOT_LATIN_OR_DIGIT_AFTER}`,
  "gu",
);
const STOP_TOKEN = new RegExp(`${NOT_LATIN_OR_DIGIT_BEFORE}stop${NOT_LATIN_OR_DIGIT_AFTER}`, "u");
const STOP_TOKEN_ALL = new RegExp(STOP_TOKEN.source, "gu");
const STOP_FILLER_CJK = /唔該|請|啦|呀|喇|吖/gu;
const UNSUBSCRIBE_TOKEN = new RegExp(
  `${NOT_LATIN_OR_DIGIT_BEFORE}unsubscribe${NOT_LATIN_OR_DIGIT_AFTER}`,
  "u",
);

/** Rule 4: `stop` with nothing else except politeness/emphasis tokens or a repeated `stop`. */
function isStopWithOnlyFiller(spaced: string) {
  const withoutFiller = spaced.replace(STOP_FILLER_LATIN, " ").replace(STOP_FILLER_CJK, " ");
  if (!STOP_TOKEN.test(withoutFiller)) return false;
  return withoutFiller.replace(STOP_TOKEN_ALL, " ").replace(/[\p{P}\p{S}\p{Z}\s]+/gu, "") === "";
}

/**
 * Owner decision 7. Display-only: true when the message is NOT an exact opt-out but asks to stop.
 * Never sets any flag. Bare 停止 / 取消 / 唔要 / 不要 never flag on their own.
 */
export function isOptOutNearMiss(value: string | null | undefined): boolean {
  if (isOptOutText(value)) return false;
  const spaced = foldEdges(value, NEAR_MISS_MAX_LENGTH);
  if (!spaced) return false;
  const compact = spaced.replace(/[\p{Z}\s]+/gu, "");

  // 1. A CJK opt-out word anywhere.
  if (CJK_OPT_OUT_WORDS.some((word) => compact.includes(word))) return true;
  // 2. A stop-messaging phrase anywhere.
  if (OPT_OUT_NEAR_MISS_PHRASES.some((phrase) => compact.includes(phrase))) return true;
  // 3. `unsubscribe` as a Latin token anywhere.
  if (UNSUBSCRIBE_TOKEN.test(spaced)) return true;
  // 4. `stop` plus only politeness/emphasis.
  return isStopWithOnlyFiller(spaced);
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
    return Math.abs(millis) <= 8640000000000000
      ? new Date(millis).toISOString()
      : new Date().toISOString();
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
    appId: identityValue(payload.appId ?? payload.app ?? source.appId ?? source.app),
    memberName: stringOrNull(record(payload.memberExtra ?? source.memberExtra).name),
    payload,
  };
}

/** Only real-ID outbound events with a supported content shape can confirm a local intent. */
export function outboundWoztellEvidence(
  event: NormalizedWoztellEvent,
): Record<string, unknown> | null {
  if (
    event.direction !== "outbound" ||
    event.legacyExternalMessageId !== null ||
    !event.externalMessageId ||
    !event.woztellMemberId ||
    !event.channelId
  )
    return null;
  if (event.messageType === "TEXT" && typeof event.text === "string")
    return { type: "TEXT", text: event.text };
  if (event.messageType !== "TEMPLATE") return null;
  const wrapped = record(event.payload.messageEvent);
  const source = Object.keys(wrapped).length > 0 ? wrapped : event.payload;
  const data = record(source.data);
  if (
    typeof data.elementName !== "string" ||
    !data.elementName ||
    typeof data.languageCode !== "string" ||
    !data.languageCode ||
    (data.components !== undefined && !Array.isArray(data.components))
  )
    return null;
  return {
    type: "TEMPLATE",
    elementName: data.elementName,
    languageCode: data.languageCode,
    components: data.components ?? [],
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
  channelId?: string;
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
  if (input.channelId !== undefined && input.channelId !== config.channelId) {
    return { ok: false, refused: true, error: "WOZTELL_CHANNEL_SCOPE_MISMATCH" };
  }

  const { response: res, text: rawBody } = await boundedProviderFetch(
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

  let body: unknown = {};
  if (rawBody.trim()) {
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      return { ok: false, error: "WOZTELL_INVALID_RESPONSE", status: res.status };
    }
  }
  const envelope = record(body);
  const providerResult = parseWoztellProviderResult(body, {
    expectedResponseCount: input.response.length,
  });

  // `ok` is WOZTELL's own verdict and it is the authoritative one. A refusal
  // normally arrives as HTTP 500 -- that status is its documented "bot found an
  // error before sending the response out", NOT a crash -- but reading the
  // status alone would stamp a 2xx carrying ok:0 as 'sent' and show staff a
  // reply that never left the building.
  const refused = providerResult.outcome === "definitive_refusal";
  if (
    res.ok &&
    (providerResult.outcome === "execution_accepted" ||
      providerResult.outcome === "identifiable_acceptance")
  )
    return { ok: true, body, status: res.status, providerResult };
  if (res.ok && !refused) {
    return {
      ok: false,
      error: "WOZTELL_AMBIGUOUS_RESPONSE",
      body,
      status: res.status,
      refused: false,
      providerResult,
    };
  }

  // WOZTELL puts the reason in `err`, with `err_code` on some failures:
  //   { "ok": 0, "err": "User is not authorized." }
  // This used to read `error`, which WOZTELL never sends. The lookup therefore
  // never matched and every refusal -- a wrong token scope, an unknown channel,
  // a number with no WhatsApp account -- collapsed into the bare
  // "WOZTELL_HTTP_500", discarding the one sentence that says what to fix.
  // `error` is still accepted in case a surface does use it.
  // https://doc.woztell.com/docs/reference/bot-api-reference/
  const rawReason = envelope.err ?? envelope.error;
  const reason =
    rawReason === null || rawReason === undefined
      ? null
      : typeof rawReason === "object"
        ? JSON.stringify(rawReason)
        : String(rawReason);
  const code = envelope.err_code ?? envelope.errCode;
  const providerError = reason
    ? (code === null || code === undefined ? reason : `WOZTELL_${String(code)}: ${reason}`).slice(
        0,
        500,
      )
    : `WOZTELL_HTTP_${res.status}`;

  // The body rides along so the send route can persist it into
  // whatsapp_messages.payload -- without it a failed row records the summary
  // and loses the provider's own account of what happened.
  //
  // `refused` reports the one thing the HTTP status cannot: that WOZTELL
  // decided against sending rather than failing somewhere mid-flight. Both
  // arrive as 500, and campaign delivery has to tell them apart -- an
  // ambiguous failure is terminal there, because the customer may already have
  // the message, while a refusal is safe to retry. Only an explicit ok:0
  // counts, so anything less certain stays ambiguous.
  return { ok: false, error: providerError, status: res.status, body, refused, providerResult };
}

export { deliverWoztellCampaign } from "./campaign-delivery.server.ts";
