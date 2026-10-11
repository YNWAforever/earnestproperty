import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { MIGRATION_VERSIONS } from "../../src/lib/control-plane/migration-versions.js";

export const repoRoot = new URL("../../", import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
      const candidate = specifier.startsWith("@/")
        ? new URL("src/" + specifier.slice(2), repoRoot)
        : specifier.startsWith(".") && context.parentURL
          ? new URL(specifier, context.parentURL)
          : null;
      if (candidate?.href.startsWith(repoRoot.href)) {
        for (const extension of [".ts", ".tsx", ".js", ".mjs"]) {
          const target = new URL(candidate.href + extension);
          if (existsSync(target)) return next(target.href, context);
        }
      }
      throw error;
    }
  },
});

const image =
  "pgvector/pgvector@sha256:d2ef61f42ef767baa5a1475393303cc235bcd92febd9d7014eddb48b41f3bad0";
function docker(...args) {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 30000 });
  if (result.error || result.status !== 0)
    throw new Error("Owned Docker test: " + (result.error?.message ?? result.stderr));
  return result.stdout.trim();
}

// No connection URL is accepted. Every writable target is a new container with
// verified identity and a dynamically assigned loopback-only port.
export async function withOwnedPostgres(run) {
  const name = "earnest-remediation-qa-" + randomUUID();
  let id;
  let pool;
  try {
    id = docker(
      "run",
      "--rm",
      "--pull",
      "never",
      "--detach",
      "--name",
      name,
      "--env",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "--publish",
      "127.0.0.1::5432",
      image,
    );
    assert.match(id, /^[a-f0-9]{64}$/);
    const metadata = JSON.parse(docker("inspect", id))[0];
    assert.equal(metadata.Name, "/" + name);
    assert.equal(metadata.Config.Image, image);
    const bindings = metadata.NetworkSettings.Ports["5432/tcp"];
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].HostIp, "127.0.0.1");
    pool = new pg.Pool({
      host: "127.0.0.1",
      port: Number(bindings[0].HostPort),
      user: "postgres",
      database: "postgres",
      max: 8,
      connectionTimeoutMillis: 10000,
      statement_timeout: 30000,
    });
    // Wait for a real SELECT 1 (not just an open port) under a bounded deadline.
    const readyDeadline = Date.now() + 60000;
    for (;;) {
      try {
        await pool.query("SELECT 1");
        break;
      } catch (error) {
        if (Date.now() > readyDeadline) throw error;
        await delay(200);
      }
    }
    await pool.query(
      "CREATE TABLE app_migrations(version text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
    );
    for (const version of MIGRATION_VERSIONS) {
      const client = await pool.connect();
      const sql = readFileSync(new URL("neon/migrations/" + version, repoRoot), "utf8");
      const transactional = !/ALTER\s+TYPE\s+\S+\s+ADD\s+VALUE/i.test(sql);
      try {
        if (transactional) await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO app_migrations(version) VALUES($1)", [version]);
        if (transactional) await client.query("COMMIT");
      } catch (error) {
        if (transactional) await client.query("ROLLBACK");
        throw new Error("Migration " + version + ": " + error.message, { cause: error });
      } finally {
        client.release();
      }
    }
    const query = async (sql, params = []) => (await pool.query(sql, params)).rows;
    const transaction = async (statements, options = {}) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (options.isolationLevel === "Serializable")
          await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
        const rows = [];
        for (const { statement, params = [] } of statements)
          rows.push((await client.query(statement, params)).rows);
        await client.query("COMMIT");
        return rows;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    };
    await run({
      pool,
      query,
      transaction,
      containerId: id,
      migrationCount: MIGRATION_VERSIONS.length,
    });
  } finally {
    await pool?.end();
    if (id) {
      const metadata = JSON.parse(docker("inspect", id))[0];
      assert.equal(metadata.Name, "/" + name);
      assert.equal(metadata.Config.Image, image);
      docker("stop", id);
    }
  }
}

export async function mockOwnedServerDb(mock, query, transaction) {
  const url = new URL("src/lib/neon/db.server.ts", repoRoot).href;
  const actual = await import(url);
  mock.module(url, {
    exports: {
      ...actual,
      queryRows: query,
      transactionRows: transaction,
      getSql: () => ({
        query,
        transaction: (build, options) =>
          transaction(
            build({
              query: (statement, params = []) => ({ statement, params }),
            }),
            options,
          ),
      }),
    },
  });
}

/** Existing MLS functions accept client ports; bind them only to the owned pool. */
export function ownedMlsPorts(pool) {
  assert.equal(pool.options.host, "127.0.0.1");
  const connectionString = `postgresql://postgres@127.0.0.1:${pool.options.port}/postgres`;
  return {
    connectionString,
    createClient: (config) => {
      assert.equal(config.connectionString, connectionString);
      let client;
      return {
        neonConfig: {},
        connect: async () => {
          client = await pool.connect();
        },
        query: (sql, params) => client.query(sql, params),
        end: async () => {
          client?.release();
        },
      };
    },
  };
}

const ISOLATION = {
  ReadUncommitted: "READ UNCOMMITTED",
  ReadCommitted: "READ COMMITTED",
  RepeatableRead: "REPEATABLE READ",
  Serializable: "SERIALIZABLE",
};

function shape(result, options = {}) {
  if (options.fullResults) return result;
  return options.arrayMode ? result.rows.map((row) => Object.values(row)) : result.rows;
}

/**
 * A client with the shape of `neon(url)` from @neondatabase/serverless 1.x, backed by an owned
 * pg pool. `query(text, params)` is lazy (like the driver) and resolves to the rows array;
 * `transaction(build, options)` takes an array of those queries or a callback receiving `t`
 * (`t.query` makes the same lazy query) and resolves to one rows array per query, in order.
 * All queries run on one connection inside one BEGIN/COMMIT, with the requested isolation
 * level; any error rolls back and is rethrown.
 */
export function ownedNeonSql(pool) {
  const lazy = (text, params = [], runner) => ({
    parameterizedQuery: { query: text, params },
    then: (resolve, reject) => runner(text, params).then(resolve, reject),
    catch: (reject) => runner(text, params).catch(reject),
  });
  const query = (text, params = []) =>
    lazy(text, params, async (sqlText, values) => shape(await pool.query(sqlText, values)));
  const transaction = async (build, options = {}) => {
    const queries = typeof build === "function" ? build({ query }) : build;
    for (const item of queries)
      assert.ok(item?.parameterizedQuery, "transaction expects queries made by sql.query");
    const level = options.isolationLevel ? ISOLATION[options.isolationLevel] : undefined;
    assert.ok(!options.isolationLevel || level, "Unknown isolation level");
    const begin =
      "BEGIN" +
      (level ? " ISOLATION LEVEL " + level : "") +
      (options.readOnly ? " READ ONLY" : "") +
      (options.deferrable ? " DEFERRABLE" : "");
    const client = await pool.connect();
    try {
      await client.query(begin);
      const results = [];
      for (const { parameterizedQuery } of queries)
        results.push(
          shape(await client.query(parameterizedQuery.query, parameterizedQuery.params), options),
        );
      await client.query("COMMIT");
      return results;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  return { query, transaction };
}

function dockerServerAvailable() {
  const result = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8",
    timeout: 15000,
  });
  return !result.error && result.status === 0;
}

/**
 * Runs `run({ sql, owned, ... })` against either an explicitly provided disposable Neon
 * database (TEST_DATABASE_URL, behind the disposable-target guard) or a fresh owned container.
 * In CI a missing database is a failure, never a skipped pass. Outside CI with no Docker the
 * owned harness fails with its usual "Owned Docker test: ..." error, as it always has.
 * `deps.urlVar` names the env var holding the disposable URL (default TEST_DATABASE_URL), so a
 * suite whose on-demand Neon run uses ASTRA_TEST_DATABASE_URL keeps that contract.
 */
export async function dbTargetOrOwned(run, deps = {}) {
  const env = deps.env ?? process.env;
  const url = env[deps.urlVar ?? "TEST_DATABASE_URL"];
  if (url) {
    const { assertDisposableNeonTestTarget } = await import(
      new URL("src/lib/neon/disposable-test-target.mjs", repoRoot).href
    );
    await assertDisposableNeonTestTarget(url, { env });
    const { neon } = await import("@neondatabase/serverless");
    return run({ sql: neon(url), owned: false, url });
  }
  if (env.CI === "true" && !(deps.dockerAvailable ?? dockerServerAvailable)())
    throw new Error("OWNED_DB_REQUIRED_NO_SKIPPED_PASS");
  return (deps.withOwned ?? withOwnedPostgres)((owned) =>
    run({ ...owned, sql: ownedNeonSql(owned.pool), owned: true }),
  );
}

/**
 * MLS-style client ports for a dbTargetOrOwned target: the owned pool's ports, or real Neon
 * Clients on the guarded disposable URL. Callers set `neonConfig.webSocketConstructor` as before.
 */
export async function targetClientPorts(target) {
  if (target.owned) return ownedMlsPorts(target.pool);
  const { Client } = await import("@neondatabase/serverless");
  return { connectionString: target.url, createClient: (config) => new Client(config) };
}

/** A node:test body `(target, t) => ...` run on dbTargetOrOwned(¡K, deps). */
export const onDbTarget = (body, deps) => (t) => dbTargetOrOwned((target) => body(target, t), deps);
