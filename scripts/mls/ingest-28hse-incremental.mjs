import { readFile, writeFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { SnapshotError } from "../../src/lib/mls/ingestion-contract.mjs";
import { safeBridgeError } from "./apply-source-snapshot.mjs";
import { verifyDailyTarget } from "./verify-daily-target.mjs";
const MAX_BYTES = 5 * 1024 * 1024;
async function readPayload(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_BYTES) throw new SnapshotError("PAYLOAD_TOO_LARGE", 413);
  return readFile(path, "utf8");
}
export async function runIncrementalBridge(
  args,
  { env = process.env, read = readPayload, write = writeFile, ingest } = {},
) {
  let payloadPath,
    outPath,
    apply = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--payload" && !payloadPath && args[i + 1] && !args[i + 1].startsWith("--"))
      payloadPath = args[++i];
    else if (args[i] === "--out" && !outPath && args[i + 1] && !args[i + 1].startsWith("--"))
      outPath = args[++i];
    else if (args[i] === "--apply" && !apply) apply = true;
    else throw new SnapshotError("INVALID_ARGUMENTS");
  }
  if (!payloadPath) throw new SnapshotError("PAYLOAD_REQUIRED");
  // Validate the target before loading data or selecting the trusted writer mode.
  if (apply) {
    try {
      verifyDailyTarget(env.DATABASE_URL_UNPOOLED, env.PROPERTY_SYNC_EXPECTED_DATABASE_HOST);
    } catch {
      throw new SnapshotError("DAILY_DATABASE_TARGET_UNVERIFIED", 503);
    }
  }
  const raw = await read(payloadPath);
  if (Buffer.byteLength(raw) > MAX_BYTES) throw new SnapshotError("PAYLOAD_TOO_LARGE", 413);
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new SnapshotError("INVALID_JSON");
  }
  const service =
    ingest ?? (await import("../../src/lib/mls/ingestion-service.mjs")).ingestSnapshot;
  const receipt = await service(payload, {
    apply,
    incremental: true,
    expectedSource: "28hse_agent_540",
    ...(apply ? { connectionString: env.DATABASE_URL_UNPOOLED } : {}),
  });
  // Receipts contain counts/times/IDs and decoder codes, never scraped detail data.
  if (outPath) await write(outPath, JSON.stringify(receipt) + "\n", "utf8");
  return receipt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(JSON.stringify(await runIncrementalBridge(process.argv.slice(2))) + "\n");
  } catch (error) {
    process.stderr.write(JSON.stringify(safeBridgeError(error)) + "\n");
    process.exitCode = 1;
  }
}
