import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { MIGRATION_VERSIONS } from "../../src/lib/control-plane/migration-versions.js";
import { ownedNeonSql, repoRoot } from "./owned-postgres-test.mjs";

/**
 * Isolated-schema fixtures built from the REAL migration files.
 *
 * The WhatsApp enquiry suites used to hand-write the tables their code under test touches and
 * apply a few real migrations on top. Those hand copies drifted as the product grew (missing
 * access functions, receipt tables, new columns). These helpers apply neon/migrations in
 * MIGRATION_VERSIONS order instead, so a suite's schema is production's schema at the chosen
 * migration, and a new migration reaches every suite automatically.
 */

/** Splits a migration file into statements (comments, quotes and dollar bodies respected). */
export function splitSqlStatements(query) {
  const statements = [];
  let current = "",
    single = false,
    double = false,
    dollar = null;
  for (let index = 0; index < query.length; index += 1) {
    const char = query[index],
      next = query[index + 1];
    if (!single && !double && !dollar && char === "-" && next === "-") {
      const end = query.indexOf("\n", index + 2);
      if (end === -1) break;
      index = end;
      continue;
    }
    if (!double && !dollar && char === "'" && query[index - 1] !== "\\") single = !single;
    if (!single && !dollar && char === '"') double = !double;
    if (!single && !double && char === "$") {
      const match = query.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        const tag = match[0];
        dollar = dollar ? (dollar === tag ? null : dollar) : tag;
        current += tag;
        index += tag.length - 1;
        continue;
      }
    }
    if (!single && !double && !dollar && char === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

function indexOfVersion(version) {
  const index = MIGRATION_VERSIONS.indexOf(version);
  assert.ok(index >= 0, "Unknown migration " + version);
  return index;
}

/** Every migration strictly before `version`, in apply order. */
export const migrationsBefore = (version) => MIGRATION_VERSIONS.slice(0, indexOfVersion(version));
/** Every migration strictly after `version`, in apply order. */
export const migrationsAfter = (version) => MIGRATION_VERSIONS.slice(indexOfVersion(version) + 1);

export const migrationStatements = (version) =>
  splitSqlStatements(readFileSync(new URL("neon/migrations/" + version, repoRoot), "utf8"));

/**
 * Applies the named migration files into `schema`, one transaction per file, through the
 * suite's own Neon-shaped client. By default the search path is `<schema>, public` while
 * migrating, so extension types (pgvector's `vector`) installed in `public` resolve; every object
 * a migration creates lands in `schema`, and a suite that applies the full ordered list creates
 * each table before anything references it. A suite that applies one migration on top of its own
 * minimal tables passes `{ publicFallback: false }` so nothing can resolve outside its schema.
 * Suites then query with the search path set to `schema` alone.
 */
export async function applyMigrations(db, schema, versions, { publicFallback = true } = {}) {
  const searchPath = publicFallback ? schema + ",public" : schema;
  for (const version of versions) {
    try {
      await db.transaction((q) => [
        q.query("SELECT set_config('search_path',$1,true)", [searchPath]),
        ...migrationStatements(version).map((statement) => q.query(statement)),
      ]);
    } catch (error) {
      throw new Error("Migration " + version + " in " + schema + ": " + error.message, {
        cause: error,
      });
    }
  }
}

/**
 * The client a suite builds its isolated schema on. On owned Postgres it is a fresh, empty
 * database in the owned container, so nothing the harness migrated into `postgres.public` can
 * be resolved through the migration search path. On the disposable Neon URL it is that
 * database itself, as before. Call `end()` in `finally`.
 */
export async function isolatedDatabase(target) {
  if (!target.owned) return { sql: target.sql, end: async () => {} };
  assert.equal(target.pool.options.host, "127.0.0.1");
  const database = "wa_iso_" + randomUUID().replaceAll("-", "");
  await target.pool.query(`CREATE DATABASE ${database}`);
  const pool = new pg.Pool({
    host: target.pool.options.host,
    port: target.pool.options.port,
    user: "postgres",
    database,
    max: 8,
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
  });
  return { sql: ownedNeonSql(pool), pool, end: () => pool.end() };
}
