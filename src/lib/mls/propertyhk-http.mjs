import { timingSafeEqual } from "node:crypto";
import { SnapshotError } from "./ingestion-contract.mjs";
const respond = (body, status = 200, headers = {}) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
async function readBounded(request, maxBytes, timeoutMs) {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes))
    throw new SnapshotError("PAYLOAD_TOO_LARGE", 413);
  if (!request.body) throw new SnapshotError("INVALID_JSON", 400);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0,
    timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new SnapshotError("BODY_TIMEOUT", 503)), timeoutMs);
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new SnapshotError("PAYLOAD_TOO_LARGE", 413);
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new SnapshotError("INVALID_JSON", 400);
    }
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function handlePropertyhkRequest(
  request,
  { secret, connectionString, ingest, maxBytes = 5 * 1024 * 1024, bodyTimeoutMs = 15000 } = {},
) {
  if (
    !secret ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    !Number.isSafeInteger(bodyTimeoutMs) ||
    bodyTimeoutMs <= 0
  )
    return respond({ success: false, error: "SYNC_NOT_CONFIGURED" }, 503);
  const actual = Buffer.from(request.headers.get("authorization") ?? ""),
    expected = Buffer.from(`Bearer ${secret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return respond({ success: false, error: "UNAUTHORIZED" }, 401);
  if (request.method !== "POST")
    return respond({ success: false, error: "METHOD_NOT_ALLOWED" }, 405, { allow: "POST" });
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
  )
    return respond({ success: false, error: "INVALID_CONTENT_TYPE" }, 400);
  try {
    const payload = await readBounded(request, maxBytes, bodyTimeoutMs);
    if (!payload || Array.isArray(payload) || payload.source !== "propertyhk")
      throw new SnapshotError("SOURCE_SCOPE_MISMATCH", 400);
    return respond(
      await ingest(payload, { apply: true, expectedSource: "propertyhk", connectionString }),
    );
  } catch (error) {
    const safe =
      error instanceof SnapshotError && [400, 409, 413, 422, 429, 500, 503].includes(error.status);
    const status = safe ? error.status : 503;
    const code =
      safe && /^[A-Za-z0-9_:-]{1,100}$/.test(error.code) ? error.code : "INGESTION_UNAVAILABLE";
    const retry = Number(error?.details?.retryAfter);
    return respond(
      { success: false, error: code },
      status,
      status === 429
        ? {
            "retry-after": String(
              Number.isFinite(retry) ? Math.max(1, Math.min(86400, Math.ceil(retry))) : 60,
            ),
          }
        : {},
    );
  }
}
