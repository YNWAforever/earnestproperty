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
      connectionTimeoutMillis: 2000,
      statement_timeout: 30000,
    });
    for (let attempt = 0; ; attempt++) {
      try {
        await pool.query("SELECT 1");
        break;
      } catch (error) {
        if (attempt === 60) throw error;
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
