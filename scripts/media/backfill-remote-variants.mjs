import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@neondatabase/serverless";
import { createVercelBlobStore } from "../../src/lib/media/vercel-blob.mjs";
import { ensureMediaVariants } from "../../src/lib/media/remote-variants.mjs";
import {
  findMediaVariantSet,
  saveMediaVariantSet,
} from "../../src/lib/media/remote-variants-db.mjs";

const MAX_BYTES = 16 * 1024 * 1024;
export function parseBackfillArgs(argv) {
  const apply = argv.includes("--apply");
  const limitValue = argv.find((arg) => arg.startsWith("--limit="))?.slice(8) ?? "20";
  const limit = Number(limitValue);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new TypeError("limit must be 1..100");
  const checkpoint =
    argv.find((arg) => arg.startsWith("--checkpoint="))?.slice(13) ??
    ".cache/media-variant-backfill.json";
  if (!checkpoint || path.isAbsolute(checkpoint) || checkpoint.split(/[\\/]/).includes(".."))
    throw new TypeError("checkpoint must be a workspace-relative path");
  return { apply, limit, checkpoint };
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
async function main() {
  const options = parseBackfillArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const allowedHosts = (process.env.MLS_OWNED_BLOB_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (
    options.apply &&
    (process.env.MEDIA_BACKFILL_TARGET !== "staging" ||
      !process.env.BLOB_READ_WRITE_TOKEN ||
      !allowedHosts.length)
  )
    throw new Error("Apply requires staging target, Blob token and owned-host allowlist");
  let checkpoint = { lastAssetId: "00000000-0000-0000-0000-000000000000" };
  try {
    checkpoint = JSON.parse(await readFile(options.checkpoint, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!/^[0-9a-f-]{36}$/i.test(checkpoint.lastAssetId)) throw new TypeError("Invalid checkpoint");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15000,
  });
  client.neonConfig.webSocketConstructor = globalThis.WebSocket;
  await client.connect();
  try {
    const query = async (statement, params) => (await client.query(statement, params)).rows;
    const rows = await query(
      "SELECT a.id::text AS id,a.url,a.content_hash AS hash FROM media_assets a " +
        "LEFT JOIN media_variant_sets s ON s.asset_id=a.id AND s.source_hash=a.content_hash AND s.status='ready' " +
        "WHERE a.owner_type='mls-shared' AND a.content_hash IS NOT NULL AND s.asset_id IS NULL " +
        "AND a.id::text > $1 ORDER BY a.id LIMIT $2",
      [checkpoint.lastAssetId, options.limit],
    );
    if (!options.apply) {
      console.log(
        JSON.stringify({
          mode: "dry-run",
          candidates: rows.length,
          limit: options.limit,
          lastAssetId: rows.at(-1)?.id ?? checkpoint.lastAssetId,
        }),
      );
      return;
    }
    const blobStore = createVercelBlobStore({ token: process.env.BLOB_READ_WRITE_TOKEN });
    let ready = 0;
    let unavailable = 0;
    for (const row of rows) {
      const set = await ensureMediaVariants(
        { assetId: row.id, sourceHash: row.hash, sourceUrl: row.url },
        {
          allowedHosts,
          readSource: () => readOwnedSource(row.url, allowedHosts),
          find: (id, hash) => findMediaVariantSet(query, id, hash),
          put: (value) => blobStore.put(value),
          save: (value) => saveMediaVariantSet(query, value),
        },
      );
      if (set.status === "failed") throw new Error("Variant upload failed for asset " + row.id);
      if (set.status === "ready") ready += 1;
      else unavailable += 1;
      checkpoint = { lastAssetId: row.id };
      await mkdir(path.dirname(options.checkpoint), { recursive: true });
      await writeFile(options.checkpoint, JSON.stringify(checkpoint) + "\n");
    }
    console.log(
      JSON.stringify({
        mode: "apply",
        ready,
        unavailable,
        processed: rows.length,
        lastAssetId: checkpoint.lastAssetId,
      }),
    );
  } finally {
    await client.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await main();
