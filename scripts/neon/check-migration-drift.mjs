/**
 * Fails when a migration exists in the repo but has never been applied to the
 * target database.
 *
 * ## Why this exists when the health check already reports it
 *
 * runControlPlaneHealthChecks already diffs MIGRATION_VERSIONS against
 * app_migrations and reports `database.migrations: degraded`. That check was
 * correct and current on 2026-08-19 -- the youtube migration was listed, the
 * diff would have flagged it -- and /videos still served a 500 for two days.
 *
 * The signal was never the problem. Reaching a person was. /admin/operations is
 * pull-based: it tells you only if someone opens it, and nobody opens a
 * dashboard to discover a problem they do not know exists. This script is the
 * same diff on a push schedule, so the notification arrives without anyone
 * looking.
 *
 * Read-only by design. It holds no DDL privileges and applies nothing; the
 * remedy is deliberately a human running `npm run neon:migrate`, because an
 * auto-applier in CI is a robot with schema write access on every green build.
 *
 * The version list is NOT duplicated here -- it is imported from the same
 * module the health check uses, so the two can never disagree.
 */
import {
  MIGRATION_VERSIONS,
  pendingMigrations,
} from "../../src/lib/control-plane/migration-versions.js";

/**
 * A setup placeholder reaches neon() as a literal string and fails with
 * "not a valid URL", which reads like a broken connection rather than an
 * unedited file. An empty string is worse: exported into the environment it
 * silently overrides the real value in apply-migrations.mjs's env merge, since
 * process.env is spread last. Both cost real debugging time on 2026-08-19, so
 * both are treated as absent here.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
export function resolveDatabaseUrl(env) {
  for (const key of ["DATABASE_URL_UNPOOLED", "DATABASE_URL"]) {
    const value = env[key]?.trim();
    if (value && !value.startsWith("<")) return value;
  }
  return null;
}

/**
 * @param {readonly string[]} pending
 * @returns {{ ok: boolean; message: string }}
 */
export function formatDriftReport(pending) {
  if (pending.length === 0) {
    return {
      ok: true,
      message: `Database is up to date: all ${MIGRATION_VERSIONS.length} migrations are recorded in app_migrations.`,
    };
  }

  const list = pending.map((version) => `  - ${version}`).join("\n");
  return {
    ok: false,
    message:
      `${pending.length} migration(s) exist in neon/migrations but are not recorded in ` +
      `app_migrations, so this database is behind the deployed code:\n${list}\n\n` +
      "Any query touching the new columns will fail at runtime with " +
      '`column "..." does not exist`, which surfaces to users as a 500.\n\n' +
      "To fix: run `npm run neon:migrate` against this database, or paste the migration " +
      "file plus an INSERT into app_migrations in the Neon Console SQL Editor.",
  };
}

async function main() {
  const databaseUrl = resolveDatabaseUrl(process.env);
  if (!databaseUrl) {
    // Exit 1, not 0. A drift check that quietly passes when it cannot connect is
    // the same green-tick-over-a-broken-database this script exists to prevent.
    console.error(
      "DATABASE_URL or DATABASE_URL_UNPOOLED is required (empty strings and " +
        "`<placeholder>` values are ignored).",
    );
    process.exit(1);
  }

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(databaseUrl);

  // app_migrations is created by apply-migrations.mjs on first run. Its absence
  // means nothing has ever been applied here, which is maximum drift rather than
  // a reason to skip the check.
  // Aliased to table_exists, not exists: EXISTS is a reserved keyword, and this
  // query only runs where there is a live database to fail against.
  const [{ table_exists: tableExists }] = await sql.query(
    "SELECT to_regclass('app_migrations') IS NOT NULL AS table_exists",
  );
  const applied = tableExists ? await sql.query("SELECT version FROM app_migrations") : [];

  const report = formatDriftReport(pendingMigrations(applied.map((row) => String(row.version))));
  if (!report.ok) {
    console.error(report.message);
    process.exit(1);
  }
  console.log(report.message);
}

// Only run when invoked directly, so the test can import the pure helpers
// without opening a database connection.
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
