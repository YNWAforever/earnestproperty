import "@tanstack/react-start/server-only";
import {
  normalizeWoztellEvent,
  verifyWoztellSignature,
  woztellConfig,
} from "../woztell/woztell.server.ts";
import { ingestWoztellEvent } from "../woztell/woztell-ingest.server.ts";
const MAX_BODY_BYTES = 1024 * 1024;
async function readBody(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
function consistentScope(
  payload: Record<string, unknown>,
  config: { channelId?: string; appId?: string },
) {
  const wrapped = payload.messageEvent;
  const candidates = [
    payload,
    ...(wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)
      ? [wrapped as Record<string, unknown>]
      : []),
  ];
  return candidates.every((source) =>
    [
      ["channelId", "channel"],
      ["appId", "app"],
    ].every((keys, index) => {
      const expected = index === 0 ? config.channelId : config.appId;
      if (!expected) return true;
      return keys.every((key) => {
        const value = source[key];
        if (value === undefined || value === null) return true;
        const record =
          value && typeof value === "object" && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null;
        const actual = record ? (record.id ?? record._id ?? record.channelId) : value;
        return actual === expected;
      });
    }),
  );
}
export async function handleWoztellWebhook(
  request: Request,
  deps: {
    config?: { channelSecret?: string; channelId?: string; appId?: string };
    ingest?: typeof ingestWoztellEvent;
  } = {},
) {
  const raw = await readBody(request);
  if (raw === null) return Response.json({ ok: false, error: "BODY_TOO_LARGE" }, { status: 413 });
  const config = deps.config ?? { ...woztellConfig(), appId: process.env.WOZTELL_APP_ID };
  if (
    !verifyWoztellSignature(raw, request.headers.get("x-woztell-signature"), config.channelSecret)
  ) {
    console.warn(
      "[woztell] webhook REJECTED (401): signature did not verify. " +
        `signature header: ${request.headers.get("x-woztell-signature") ? "present" : "MISSING"}; ` +
        `WOZTELL_CHANNEL_SECRET: ${config.channelSecret ? "configured" : "NOT SET"}; body bytes: ${raw.length}`,
    );
    return Response.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }
  let payload: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(raw.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    payload = value as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "INVALID_JSON" }, { status: 400 });
  }
  const event = normalizeWoztellEvent(payload);
  if (
    !consistentScope(payload, config) ||
    (config.channelId && event.channelId !== config.channelId) ||
    (config.appId && event.appId !== config.appId)
  )
    return Response.json({ ok: false, error: "WOZTELL_SCOPE_MISMATCH" }, { status: 403 });
  if (process.env.EP_WA_ENQUIRY_MODE === "observe" && (!config.channelId || !config.appId))
    return Response.json(
      { ok: false, error: "WA_ENQUIRY_SCOPE_CONFIGURATION_REQUIRED" },
      { status: 503 },
    );
  try {
    const outcome = await (deps.ingest ?? ingestWoztellEvent)(event, "live_webhook", undefined, {
      signedEvent: true,
    });
    return Response.json(outcome.skipped ? { ok: true, skipped: outcome.skipped } : { ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "WA_ENQUIRY_SCHEMA_REQUIRED")
      return Response.json({ ok: false, error: error.message }, { status: 503 });
    throw error;
  }
}
