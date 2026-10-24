import { readFile, writeFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";
import { publishDaily } from "../../src/lib/mls/daily-publication.mjs";
import { createVercelBlobStore } from "../../src/lib/media/vercel-blob.mjs";
import { verifyDailyTarget } from "./verify-daily-target.mjs";
import { decodeSnapshot } from "../../src/lib/mls/ingestion-contract.mjs";
import { validateNamedPublicationPlan } from "../../src/lib/mls/named-publication-plan.mjs";
import { parsePublicationArgs } from "./publication-cli-args.mjs";
const args = process.argv.slice(2);
let client;
try {
  const options = parsePublicationArgs(args);
  const bytes = await readFile(options.payloadPath);
  if (bytes.length > 5 * 1024 * 1024) throw Error("PAYLOAD_TOO_LARGE");
  const payload = JSON.parse(bytes.toString("utf8"));
  let publicationPlan;
  if (options.publicationPlanPath) {
    const planBytes = await readFile(options.publicationPlanPath);
    if (planBytes.length > 128 * 1024) throw Error("PUBLICATION_PLAN_TOO_LARGE");
    publicationPlan = JSON.parse(planBytes.toString("utf8"));
    validateNamedPublicationPlan(decodeSnapshot(payload, { idScope: "global" }), {
      publicationPlan,
      publicationPlanHash: options.publicationPlanHash,
    });
  }
  verifyDailyTarget(
    process.env.DATABASE_URL_UNPOOLED,
    process.env.PROPERTY_SYNC_EXPECTED_DATABASE_HOST,
  );
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw Error("BLOB_TOKEN_REQUIRED");
  client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
  await client.connect();
  const result = await publishDaily({
    payload,
    client,
    blobStore: createVercelBlobStore({ token: process.env.BLOB_READ_WRITE_TOKEN }),
    apply: true,
    publicationPlan,
    publicationPlanHash: options.publicationPlanHash,
    onReport: (report) => writeFile(options.reportPath, JSON.stringify(report, null, 2)),
  });
  await writeFile(options.reportPath, JSON.stringify(result, null, 2));
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
