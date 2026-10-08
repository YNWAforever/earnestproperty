import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@neondatabase/serverless";
import { createVercelBlobStore } from "../../src/lib/media/vercel-blob.mjs";
import { ensureMediaVariants, failureReason } from "../../src/lib/media/remote-variants.mjs";
import {
  findMediaVariantSet,
  saveMediaVariantSet,
} from "../../src/lib/media/remote-variants-db.mjs";

const MAX_BYTES = 16 * 1024 * 1024;
const ZERO_ID = "00000000-0000-0000-0000-000000000000";
const VARIANTS_PER_PHOTO = 5;
const MIGRATION = "20260927172000_media_asset_variants";
// Owned photos that still have no ready variant set for their current content hash.
const PENDING =
  "FROM media_assets a " +
  "LEFT JOIN media_variant_sets s ON s.asset_id=a.id AND s.source_hash=a.content_hash AND s.status='ready' " +
  "WHERE a.owner_type='mls-shared' AND a.content_hash IS NOT NULL AND s.asset_id IS NULL " +
  "AND a.id::text > $1";

const KNOWN_ARG = /^--(apply|skip-failed|limit=.*|checkpoint=.*|confirm-db-host=.*)$/;
export function parseBackfillArgs(argv) {
  const unknown = argv.find((arg) => !KNOWN_ARG.test(arg));
  if (unknown) throw new TypeError("Unknown argument: " + unknown);
  const apply = argv.includes("--apply");
  const skipFailed = argv.includes("--skip-failed");
  const limitValue = argv.find((arg) => arg.startsWith("--limit="))?.slice(8) ?? "50";
  const limit = Number(limitValue);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new TypeError("limit must be 1..100");
  const checkpoint =
    argv.find((arg) => arg.startsWith("--checkpoint="))?.slice(13) ??
    ".cache/media-variant-backfill.json";
  if (!checkpoint || path.isAbsolute(checkpoint) || checkpoint.split(/[\\/]/).includes(".."))
    throw new TypeError("checkpoint must be a workspace-relative path");
  const hostArg = argv.find((arg) => arg.startsWith("--confirm-db-host="));
  const confirmDbHost = hostArg === undefined ? null : hostArg.slice(18);
  if (confirmDbHost === "") throw new TypeError("--confirm-db-host needs a host name");
  return { apply, limit, checkpoint, confirmDbHost, skipFailed };
}

// The host part of DATABASE_URL. The URL itself, with its password, is never echoed.
export function databaseHost(databaseUrl) {
  let host = "";
  try {
    host = new URL(String(databaseUrl ?? "")).hostname;
  } catch {
    host = "";
  }
  if (!host) throw new TypeError("DATABASE_URL is missing or has no host");
  return host;
}

// A write run needs the operator to type the exact database host they mean to fill.
export function assertApplyTarget(databaseUrl, confirmHost) {
  const host = databaseHost(databaseUrl);
  if (typeof confirmHost !== "string" || confirmHost !== host)
    throw new Error(
      "--apply needs --confirm-db-host=<host> equal to the DATABASE_URL host (" + host + ")",
    );
  return host;
}

function redact(message, env) {
  let text = String(message ?? "");
  const secrets = [env.DATABASE_URL, env.BLOB_READ_WRITE_TOKEN];
  try {
    const url = new URL(env.DATABASE_URL);
    secrets.push(url.password, decodeURIComponent(url.password), url.username);
  } catch {
    // No parsable URL, so there is nothing more to hide.
  }
  for (const secret of secrets.filter((value) => typeof value === "string" && value.length >= 4))
    text = text.split(secret).join("[redacted]");
  return text;
}

async function readOwnedSource(sourceUrl, allowedHosts) {
  const url = new URL(sourceUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !allowedHosts.includes(url.hostname.toLowerCase())
  )
    throw new TypeError("Untrusted owned source host");
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: { accept: "image/jpeg,image/png,image/webp,image/avif" },
  });
  if (!response.ok || !response.body) throw new Error("Owned source read failed");
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BYTES) throw new TypeError("Image source exceeds size limit");
  const parts = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.byteLength;
    if (size > MAX_BYTES) throw new TypeError("Image source exceeds size limit");
    parts.push(part);
  }
  return Buffer.concat(parts, size);
}

// Dry run (default): SELECTs only. --apply: Blob writes of new WebP files plus the
// two variant tables, one photo at a time, stopping at the first failure. Original
// photos and listing rows are never written.
export async function runBackfill({
  options,
  env,
  connect,
  createBlobStore = (token) => createVercelBlobStore({ token }),
  ensure = ensureMediaVariants,
  readCheckpoint,
  writeCheckpoint,
  log = console.log,
}) {
  const dbHost = databaseHost(env.DATABASE_URL);
  const allowedHosts = (env.MLS_OWNED_BLOB_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  // Every write guard runs before the first query or Blob client.
  if (options.apply) {
    assertApplyTarget(env.DATABASE_URL, options.confirmDbHost);
    if (!env.BLOB_READ_WRITE_TOKEN || !allowedHosts.length)
      throw new Error("--apply needs BLOB_READ_WRITE_TOKEN and MLS_OWNED_BLOB_HOSTS");
  }
  let checkpoint = (await readCheckpoint(options.checkpoint)) ?? { lastAssetId: ZERO_ID };
  if (!/^[0-9a-f-]{36}$/i.test(checkpoint?.lastAssetId ?? ""))
    throw corruptCheckpoint(options.checkpoint);
  const db = await connect(env.DATABASE_URL);
  try {
    const query = db.query;
    const [tables] = await query(
      "SELECT to_regclass('public.media_variant_sets') IS NOT NULL " +
        "AND to_regclass('public.media_asset_variants') IS NOT NULL AS ready",
      [],
    );
    if (!tables?.ready)
      throw new Error(
        "Variant tables are missing on " + dbHost + ": apply migration " + MIGRATION + " first",
      );
    const [count] = await query("SELECT count(*)::int AS remaining " + PENDING, [
      checkpoint.lastAssetId,
    ]);
    const remaining = Number(count?.remaining ?? 0);
    const rows = await query(
      "SELECT a.id::text AS id,a.url,a.content_hash AS hash " + PENDING + " ORDER BY a.id LIMIT $2",
      [checkpoint.lastAssetId, options.limit],
    );
    if (!options.apply) {
      log(
        JSON.stringify({
          mode: "dry-run",
          dbHost,
          remaining,
          estimatedBlobWrites: remaining * VARIANTS_PER_PHOTO,
          // About 0.2 to 0.4 MB of WebP per photo across its variants.
          estimatedStorageMb: {
            low: Math.round(remaining * 0.2),
            high: Math.round(remaining * 0.4),
          },
          candidates: rows.length,
          limit: options.limit,
          checkpoint: checkpoint.lastAssetId,
        }),
      );
      return;
    }
    const blobStore = createBlobStore(env.BLOB_READ_WRITE_TOKEN);
    let ready = 0;
    let unavailable = 0;
    const skipped = [];
    const stop = (row, reason) =>
      new Error(
        "Stopped at asset " +
          row.id +
          " (" +
          redact(reason || "variant upload or save failed", env) +
          "). " +
          (ready + unavailable) +
          " photos finished in this run. The original photo is untouched and the " +
          "checkpoint still points before this asset, so a rerun starts here.",
      );
    for (const row of rows) {
      // ensureMediaVariants throws only before any write: input checks and the lookup
      // ("lookup"), then reading, hashing, decoding and size checks ("source"). Blob
      // and save errors come back as status "failed" instead.
      let phase = "lookup";
      let set;
      try {
        set = await ensure(
          { assetId: row.id, sourceHash: row.hash, sourceUrl: row.url },
          {
            allowedHosts,
            readSource: () => readOwnedSource(row.url, allowedHosts),
            find: async (id, hash) => {
              const found = await findMediaVariantSet(query, id, hash);
              phase = "source";
              return found;
            },
            put: (value) => blobStore.put(value),
            save: (value) => saveMediaVariantSet(query, value),
          },
        );
      } catch (error) {
        const reason = redact(failureReason(error), env);
        if (!(options.skipFailed && phase === "source")) throw stop(row, reason);
        // --skip-failed: an unreadable source is noted and passed; nothing was written.
        skipped.push({ id: row.id, reason });
        log(JSON.stringify({ skipped: row.id, reason }));
        checkpoint = { lastAssetId: row.id };
        await writeCheckpoint(options.checkpoint, checkpoint);
        continue;
      }
      // A write failure always stops the run, with or without --skip-failed.
      if (set?.status !== "ready" && set?.status !== "unavailable") throw stop(row, set?.reason);
      if (set.status === "ready") ready += 1;
      else unavailable += 1;
      checkpoint = { lastAssetId: row.id };
      await writeCheckpoint(options.checkpoint, checkpoint);
    }
    log(
      JSON.stringify({
        mode: "apply",
        dbHost,
        ready,
        unavailable,
        skipped,
        processed: rows.length,
        remaining: Math.max(0, remaining - rows.length),
        lastAssetId: checkpoint.lastAssetId,
      }),
    );
    // Skipped photos still have no variants, so the run reports a non-zero exit.
    return { exitCode: skipped.length ? 1 : 0, skipped };
  } finally {
    await db.end();
  }
}

const corruptCheckpoint = (file) =>
  new Error(
    "Checkpoint " +
      file +
      " is unreadable. Delete it to restart from the beginning; finished photos are skipped.",
  );
export async function readCheckpointFile(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw corruptCheckpoint(file);
  }
  if (!/^[0-9a-f-]{36}$/i.test(value?.lastAssetId ?? "")) throw corruptCheckpoint(file);
  return value;
}
// Write a temp file and rename it, so an interrupted write never leaves a torn checkpoint.
export async function writeCheckpointFile(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = file + ".tmp";
  await writeFile(temp, JSON.stringify(value) + "\n");
  await rename(temp, file);
}
async function connectNeon(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 15000 });
  client.neonConfig.webSocketConstructor = globalThis.WebSocket;
  await client.connect();
  return {
    query: async (statement, params) => (await client.query(statement, params)).rows,
    end: () => client.end(),
  };
}
async function main() {
  const env = process.env;
  try {
    const result = await runBackfill({
      options: parseBackfillArgs(process.argv.slice(2)),
      env,
      connect: connectNeon,
      readCheckpoint: readCheckpointFile,
      writeCheckpoint: writeCheckpointFile,
    });
    if (result?.exitCode) process.exitCode = result.exitCode;
  } catch (error) {
    console.error("backfill-remote-variants: " + redact(error?.message ?? error, env));
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await main();
