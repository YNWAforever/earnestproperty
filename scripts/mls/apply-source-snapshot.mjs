import { open } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { SnapshotError } from "../../src/lib/mls/ingestion-contract.mjs";
import { verifyDailyTarget } from "./verify-daily-target.mjs";
const MAX_BYTES = 5 * 1024 * 1024;
async function readFrozen(path) {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new SnapshotError("PAYLOAD_TOO_LARGE", 413);
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await file.read(bytes, total, bytes.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > MAX_BYTES) throw new SnapshotError("PAYLOAD_TOO_LARGE", 413);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, total));
    } catch {
      throw new SnapshotError("INVALID_JSON", 400);
    }
  } finally {
    await file.close();
  }
}
export async function runSnapshotBridge(
  args,
  { env = process.env, readPayload = readFrozen, ingest } = {},
) {
  let source,
    payloadPath,
    apply = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--payload" && !payloadPath && args[i + 1] && !args[i + 1].startsWith("--"))
      payloadPath = args[++i];
    else if (args[i] === "--source" && !source && ["28hse", "propertyhk"].includes(args[i + 1]))
      source = args[++i];
    else if (args[i] === "--apply" && !apply) apply = true;
    else throw new SnapshotError("INVALID_ARGUMENTS", 400);
  }
  if (!payloadPath) throw new SnapshotError("PAYLOAD_REQUIRED", 400);
  const raw = await readPayload(payloadPath);
  if (Buffer.byteLength(raw) > MAX_BYTES) throw new SnapshotError("PAYLOAD_TOO_LARGE", 413);
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new SnapshotError("INVALID_JSON", 400);
  }
  source ??= "28hse";
  if (!payload || payload.source !== source) throw new SnapshotError("SOURCE_SCOPE_MISMATCH", 400);
  const options = { apply, expectedSource: source === "28hse" ? "28hse_agent_540" : "propertyhk" };
  if (apply) {
    try {
      verifyDailyTarget(env.DATABASE_URL_UNPOOLED, env.PROPERTY_SYNC_EXPECTED_DATABASE_HOST);
    } catch {
      throw new SnapshotError("DAILY_DATABASE_TARGET_UNVERIFIED", 503);
    }
    options.connectionString = env.DATABASE_URL_UNPOOLED;
  }
  const service =
    ingest ?? (await import("../../src/lib/mls/ingestion-service.mjs")).ingestSnapshot;
  return service(payload, options);
}
export function safeBridgeError(error) {
  const known = error instanceof SnapshotError;
  const result = {
    success: false,
    error: known && /^[A-Za-z0-9_]{1,100}$/.test(error.code) ? error.code : "INGESTION_UNAVAILABLE",
    status:
      known && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
        ? error.status
        : 503,
  };
  const retryAfter = known ? error.details?.retryAfter : undefined;
  if (typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter >= 0)
    result.retryAfter = retryAfter;
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(JSON.stringify(await runSnapshotBridge(process.argv.slice(2))) + "\n");
  } catch (error) {
    process.stderr.write(JSON.stringify(safeBridgeError(error)) + "\n");
    process.exitCode = 1;
  }
}
