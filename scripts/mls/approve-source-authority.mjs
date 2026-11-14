import { pathToFileURL } from "node:url";
import { Client } from "@neondatabase/serverless";
import { hashPayload, POLICY_VERSION } from "../../src/lib/mls/ingestion-contract.mjs";
import { SOURCE_28HSE } from "../../src/lib/mls/source-contract.mjs";
import {
  SOURCE_AUTHORITY_POLICY,
  sourceAuthorityPolicy,
} from "../../src/lib/mls/source-authority-policy.mjs";
import { verifyDailyTarget } from "./verify-daily-target.mjs";

export async function approveSourceAuthority(
  client,
  { approvalRef, expectedConfigHash, apply = false } = {},
) {
  const rule = { version: SOURCE_AUTHORITY_POLICY, approved: true, approval_ref: approvalRef };
  sourceAuthorityPolicy({
    source: SOURCE_28HSE,
    scope_id: "agent:540",
    policy_version: POLICY_VERSION,
    config: { source_authority: rule },
  });
  if (apply && !/^[a-f0-9]{64}$/.test(expectedConfigHash ?? ""))
    throw Error("SOURCE_AUTHORITY_REVIEW_HASH_REQUIRED");
  const q = async (sql, params = []) => (await client.query(sql, params)).rows;
  await q(apply ? "BEGIN" : "BEGIN READ ONLY");
  try {
    if (apply) await q("SELECT pg_advisory_xact_lock(hashtext('earnestproperty:mls-sync'))");
    const before = (
      await q(
        "SELECT * FROM mls_ingestion_policies WHERE source=$1 AND scope_id=$2 AND policy_version=$3" +
          (apply ? " FOR UPDATE" : ""),
        [SOURCE_28HSE, "agent:540", POLICY_VERSION],
      )
    )[0];
    if (!before || before.owner !== POLICY_VERSION || before.publish_enabled !== true)
      throw Error("SOURCE_AUTHORITY_NATIVE_PUBLISHING_REQUIRED");
    const configHash = hashPayload(before.config);
    if (apply && configHash !== expectedConfigHash) throw Error("SOURCE_AUTHORITY_POLICY_CHANGED");
    const changed = hashPayload(before.config?.source_authority ?? null) !== hashPayload(rule);
    if (apply && changed) {
      await q(
        "INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata) VALUES(NULL,$1,'mls_ingestion_policy',NULL,$2)",
        [
          SOURCE_AUTHORITY_POLICY,
          JSON.stringify({
            approval_ref: approvalRef,
            before,
            after_rule: rule,
            config_hash: configHash,
          }),
        ],
      );
      await q(
        "UPDATE mls_ingestion_policies SET config=jsonb_set(coalesce(config,'{}'::jsonb),'{source_authority}',$4::jsonb) WHERE source=$1 AND scope_id=$2 AND policy_version=$3",
        [SOURCE_28HSE, "agent:540", POLICY_VERSION, JSON.stringify(rule)],
      );
    }
    await q(apply ? "COMMIT" : "ROLLBACK");
    return {
      dryRun: !apply,
      scopeId: "agent:540",
      policy: SOURCE_AUTHORITY_POLICY,
      approvalRef,
      configHash,
      changed,
    };
  } catch (error) {
    await q("ROLLBACK").catch(() => {});
    throw error;
  }
}
async function main(args) {
  const approvalRef = args.find((arg) => arg.startsWith("--approval-ref="))?.slice(15);
  const expectedConfigHash = args.find((arg) => arg.startsWith("--expect="))?.slice(9);
  const apply = args.includes("--apply");
  if (
    args.some(
      (arg) =>
        arg !== "--apply" && !arg.startsWith("--approval-ref=") && !arg.startsWith("--expect="),
    )
  )
    throw Error("SOURCE_AUTHORITY_INVALID_ARGUMENT");
  verifyDailyTarget(
    process.env.DATABASE_URL_UNPOOLED,
    process.env.PROPERTY_SYNC_EXPECTED_DATABASE_HOST,
  );
  const client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
  client.neonConfig.webSocketConstructor = globalThis.WebSocket;
  try {
    await client.connect();
    console.log(
      JSON.stringify(
        await approveSourceAuthority(client, { approvalRef, expectedConfigHash, apply }),
      ),
    );
  } finally {
    await client.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
