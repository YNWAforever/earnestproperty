import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Client } from "@neondatabase/serverless";
import { verifyDailyTarget } from "./verify-daily-target.mjs";
import { MIGRATION_VERSIONS } from "../../src/lib/control-plane/migration-versions.js";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const pins = [
  {
    file: "20261001120000_property_sync_operations.sql",
    sha256: "7fa1fd00884eb7203b097b813c06fb5eeacc10a79a5f829ad0d418c5efad8deb",
  },
  {
    file: "20261001130000_property_withdrawal_review.sql",
    sha256: "643ac76532acbcb8a16c0dbb1b40f31f8239ca53cbe8d32363ac485b0605f36e",
  },
];
export const MIGRATIONS = pins.map((p) => ({
  ...p,
  ddl: readFileSync(new URL("../../neon/migrations/" + p.file, import.meta.url), "utf8"),
}));
export const requiredVersions = [
  "20260817120000_dual_source_listing_sync.sql",
  "20260906040000_property_public_identity.sql",
  "20260906090000_canonical_property_identity.sql",
  "20260906120000_admin_property_management.sql",
  "20260907120000_propertyhk_ingestion_v2.sql",
];
export async function runSyncMigrations({ client, ddl, expectedBranch, apply = false }) {
  if (typeof expectedBranch !== "string" || !/^br-[a-z0-9-]+$/.test(expectedBranch))
    throw Error("EXPECTED_DATABASE_BRANCH_REQUIRED");
  for (const p of MIGRATIONS)
    if (!MIGRATION_VERSIONS.includes(p.file) || hash(ddl[p.file] ?? "") !== p.sha256)
      throw Error("MIGRATION_BYTES_CHANGED");
  await client.query(apply ? "BEGIN" : "BEGIN READ ONLY");
  let committing = false;
  try {
    const actual = (
      await client.query(
        "SELECT current_database() AS database,current_setting('neon.branch_id',true) AS branch",
      )
    ).rows[0];
    if (actual?.database !== "neondb" || actual?.branch !== expectedBranch)
      throw Error("SERVER_TARGET_MISMATCH");
    if (apply) {
      await client.query("SET LOCAL lock_timeout='10s'");
      await client.query("SET LOCAL statement_timeout='180s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('earnestproperty:migrations'))");
    }
    const applied = new Set(
      (await client.query("SELECT version FROM app_migrations")).rows.map((r) => r.version),
    );
    if (requiredVersions.some((v) => !applied.has(v)))
      throw Error("MIGRATION_PREREQUISITE_MISSING");
    const pending = MIGRATIONS.filter((p) => !applied.has(p.file));
    if (apply)
      for (const p of pending) {
        await client.query(ddl[p.file]);
        await client.query("INSERT INTO app_migrations(version) VALUES($1)", [p.file]);
      }
    committing = true;
    await client.query("COMMIT");
    return {
      status: apply ? "applied" : "checked",
      pending: pending.map((p) => p.file),
      applied: apply ? pending.map((p) => p.file) : [],
    };
  } catch (e) {
    if (!committing) await client.query("ROLLBACK").catch(() => {});
    else throw Error("MIGRATION_COMMIT_OUTCOME_UNKNOWN_RECONCILE_APP_MIGRATIONS");
    throw e;
  }
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((a) => !["--check", "--apply"].includes(a)))
    throw Error("INVALID_ARGUMENTS");
  const ddl = Object.fromEntries(MIGRATIONS.map((p) => [p.file, p.ddl]));
  for (const p of MIGRATIONS) if (hash(p.ddl) !== p.sha256) throw Error("MIGRATION_BYTES_CHANGED");
  if (!args.length) {
    console.log(
      JSON.stringify({
        status: "dry_run",
        databaseAccess: false,
        migrations: MIGRATIONS.map(({ file, sha256 }) => ({ file, sha256 })),
      }),
    );
    return;
  }
  verifyDailyTarget(
    process.env.DATABASE_URL_UNPOOLED,
    process.env.PROPERTY_SYNC_EXPECTED_DATABASE_HOST,
  );
  const apply = args[0] === "--apply";
  if (apply && process.env.PROPERTY_SYNC_MIGRATION_APPROVED !== "true")
    throw Error("MIGRATION_NOT_APPROVED");
  const client = new Client({
    connectionString: process.env.DATABASE_URL_UNPOOLED,
    connectionTimeoutMillis: 15000,
    query_timeout: 240000,
  });
  client.neonConfig.webSocketConstructor = globalThis.WebSocket;
  await client.connect();
  try {
    console.log(
      JSON.stringify(
        await runSyncMigrations({
          client,
          ddl,
          apply,
          expectedBranch: process.env.PROPERTY_SYNC_EXPECTED_DATABASE_BRANCH,
        }),
      ),
    );
  } finally {
    await client.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(
      /^[A-Z_]+$/.test(e.message) ? e.message : "SYNC_MIGRATION_FAILED_RECONCILE_TARGET",
    );
    process.exitCode = 1;
  });
