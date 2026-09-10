import { readFile, writeFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";
import { publishDaily } from "../../src/lib/mls/daily-publication.mjs";
import { createVercelBlobStore } from "../../src/lib/media/vercel-blob.mjs";
import { verifyDailyTarget } from "./verify-daily-target.mjs";
const args = process.argv.slice(2);
let client;
try {
  if (args.length !== 4 || args[0] !== "--payload" || args[2] !== "--report")
    throw Error("INVALID_ARGUMENTS");
  verifyDailyTarget(
    process.env.DATABASE_URL_UNPOOLED,
    process.env.PROPERTY_SYNC_EXPECTED_DATABASE_HOST,
  );
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw Error("BLOB_TOKEN_REQUIRED");
  const bytes = await readFile(args[1]);
  if (bytes.length > 5 * 1024 * 1024) throw Error("PAYLOAD_TOO_LARGE");
  const payload = JSON.parse(bytes.toString("utf8"));
  client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
  await client.connect();
  const result = await publishDaily({
    payload,
    client,
    blobStore: createVercelBlobStore({ token: process.env.BLOB_READ_WRITE_TOKEN }),
    apply: true,
    onReport: (report) => writeFile(args[3], JSON.stringify(report, null, 2)),
  });
  await writeFile(args[3], JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      published: result.published.length,
      held: result.held.length,
      alreadyPublic: result.alreadyPublic,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      error: /^[A-Z_]+$/.test(error.message) ? error.message : "DAILY_PUBLICATION_FAILED",
    }),
  );
  process.exitCode = 1;
} finally {
  if (client) await client.end();
}
