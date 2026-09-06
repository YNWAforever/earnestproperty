import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Client } from "@neondatabase/serverless";
import { MIGRATION_VERSIONS } from "../../src/lib/control-plane/migration-versions.js";
export const MIGRATION = "20260907120000_propertyhk_ingestion_v2.sql";
export async function applyIngestionMigration(client, ddl) {
  await client.query("BEGIN");
  let committing = false;
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('earnestproperty:migrations'))");
    const applied = new Set(
      (await client.query("SELECT version FROM app_migrations")).rows.map((r) => r.version),
    );
    if (applied.has(MIGRATION)) {
      await client.query("ROLLBACK");
      return { status: "already_applied", migration: MIGRATION };
    }
    const prior = MIGRATION_VERSIONS.filter((v) => v < MIGRATION);
    if (prior.some((v) => !applied.has(v))) throw new Error("MIGRATION_PREREQUISITE_MISSING");
    await client.query(ddl);
    await client.query("INSERT INTO app_migrations(version) VALUES($1)", [MIGRATION]);
    committing = true;
    await client.query("COMMIT");
    return { status: "applied", migration: MIGRATION };
  } catch (error) {
    if (!committing) await client.query("ROLLBACK");
    else throw new Error("MIGRATION_COMMIT_OUTCOME_UNKNOWN_CHECK_APP_MIGRATIONS");
    throw error;
  }
}
async function main() {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== "--apply"))
    throw new Error("Usage: node scripts/mls/migrate-ingestion-v2.mjs [--apply]");
  const ddl = readFileSync(new URL("../../neon/migrations/" + MIGRATION, import.meta.url), "utf8");
  if (!args.includes("--apply")) {
    console.log(
      JSON.stringify({
        status: "dry_run",
        migration: MIGRATION,
        bytes: Buffer.byteLength(ddl),
        databaseAccess: false,
      }),
    );
    return;
  }
  if (!process.env.DATABASE_URL_UNPOOLED) throw new Error("DATABASE_URL_UNPOOLED_REQUIRED");
  const client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
  client.neonConfig.webSocketConstructor = globalThis.WebSocket;
  await client.connect();
  try {
    console.log(JSON.stringify(await applyIngestionMigration(client, ddl)));
  } finally {
    await client.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      "INGESTION_MIGRATION_FAILED_OR_OUTCOME_UNKNOWN: inspect app_migrations before retrying",
    );
    process.exitCode = 1;
  });
