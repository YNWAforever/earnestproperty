import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Client } from "@neondatabase/serverless";
import { hashPayload } from "../../src/lib/mls/ingestion-contract.mjs";
import { verifyDailyTarget } from "./verify-daily-target.mjs";
export const canonicalHash = hashPayload;
const scopes = { "28hse_agent_540": "agent:540", propertyhk: "branches:EPW,EPS,EPT" };
const timestamp = (s) =>
  String(s).replace(
    /(\.\d{1,6})?Z$/,
    (_, fraction) => "." + (fraction?.slice(1) ?? "").padEnd(6, "0") + "Z",
  );
export function verifyAuthorityPayload(authority, payload, receipt) {
  const source = payload.source === "28hse" ? "28hse_agent_540" : payload.source;
  const expected = {
    source,
    scope_id: payload.meta?.scope_id,
    policy_version: payload.meta?.policy_version,
    parser_version: payload.meta?.parser_version,
    payload_hash: hashPayload(payload),
    receipt_id: receipt?.receipt_id,
  };
  if (
    !authority.full_snapshot ||
    !receipt?.success ||
    receipt.status !== "success" ||
    receipt.full_snapshot !== true ||
    !receipt.receipt_id ||
    Object.entries(expected).some(([k, v]) => !v || authority[k] !== v) ||
    timestamp(authority.scraped_at) !== timestamp(payload.scraped_at)
  )
    throw Error("BASELINE_AUTHORITY_MISMATCH");
  return authority;
}
export async function readSyncAuthority({
  env = process.env,
  source = "28hse_agent_540",
  createClient = (config) => new Client(config),
} = {}) {
  verifyDailyTarget(env.DATABASE_URL_UNPOOLED, env.PROPERTY_SYNC_EXPECTED_DATABASE_HOST);
  if (!scopes[source]) throw Error("SOURCE_SCOPE_UNVERIFIED");
  const client = createClient({
    connectionString: env.DATABASE_URL_UNPOOLED,
    connectionTimeoutMillis: 15000,
    query_timeout: 30000,
  });
  client.neonConfig.webSocketConstructor = globalThis.WebSocket;
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const rows = (
      await client.query(
        `SELECT p.source,p.scope_id,p.policy_version,p.parser_version,p.publish_enabled,
   s.full_receipt_id AS expected_receipt_id,r.id AS receipt_id,r.payload_hash,r.full_snapshot, r.response->>'success' AS receipt_success,
   r.response->>'status' AS receipt_status,s.full_count,
   to_char(r.accepted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS accepted_at,
   to_char(r.scraped_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS scraped_at,
   to_char(s.last_accepted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_accepted_at
   FROM mls_ingestion_policies p LEFT JOIN mls_ingestion_scopes s ON s.source=p.source AND s.scope_id=p.scope_id AND s.policy_version=p.policy_version
   LEFT JOIN mls_ingestion_receipts r ON r.id=s.full_receipt_id AND r.source=p.source AND r.scope_id=p.scope_id AND r.policy_version=p.policy_version AND r.parser_version=p.parser_version
   WHERE p.source=$1 AND p.scope_id=$2 AND p.policy_version=$3`,
        [source, scopes[source], "no-hermes-v2"],
      )
    ).rows;
    if (rows.length !== 1) throw Error("SOURCE_POLICY_UNVERIFIED");
    const row = rows[0];
    if (row.expected_receipt_id && !row.receipt_id) throw Error("BASELINE_AUTHORITY_MISMATCH");
    if (
      row.receipt_id &&
      (!row.full_snapshot || row.receipt_success !== "true" || row.receipt_status !== "success")
    )
      throw Error("BASELINE_AUTHORITY_MISMATCH");
    await client.query("COMMIT");
    return row;
  } finally {
    await client.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (
        !["--out", "--payload", "--receipt"].includes(args[i]) ||
        !args[i + 1] ||
        options[args[i]]
      )
        throw Error("INVALID_ARGUMENTS");
      options[args[i]] = args[i + 1];
    }
    if (!options["--out"] || Boolean(options["--payload"]) !== Boolean(options["--receipt"]))
      throw Error("INVALID_ARGUMENTS");
    const authority = await readSyncAuthority();
    if (options["--payload"])
      verifyAuthorityPayload(
        authority,
        JSON.parse(await readFile(options["--payload"], "utf8")),
        JSON.parse(await readFile(options["--receipt"], "utf8")),
      );
    await writeFile(options["--out"], JSON.stringify(authority));
  } catch (error) {
    console.error(/^[A-Z_]+$/.test(error.message) ? error.message : "SYNC_AUTHORITY_UNAVAILABLE");
    process.exitCode = 1;
  }
}
