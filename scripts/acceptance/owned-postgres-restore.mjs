import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";

/** Clone a verified owned test database. Never restores over any existing database. */
export async function withRestoredOwnedSnapshot({ containerId, pool }, run) {
  const inspect = spawnSync("docker", ["inspect", containerId], { encoding: "utf8" });
  assert.equal(inspect.status, 0);
  const metadata = JSON.parse(inspect.stdout)[0];
  assert.match(metadata.Name, /^\/earnest-(?:no-link|remediation)-qa-[a-f0-9-]{36}$/);
  assert.equal(
    metadata.Config.Image,
    "pgvector/pgvector@sha256:d2ef61f42ef767baa5a1475393303cc235bcd92febd9d7014eddb48b41f3bad0",
  );
  const bindings = metadata.NetworkSettings.Ports["5432/tcp"];
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].HostIp, "127.0.0.1");
  assert.equal(pool.options.host, "127.0.0.1");
  assert.equal(pool.options.port, Number(bindings[0].HostPort));
  assert.equal(pool.options.database, "postgres");
  const dump = spawnSync(
    "docker",
    ["exec", containerId, "pg_dump", "-U", "postgres", "-Fc", "-d", "postgres"],
    { timeout: 30000, maxBuffer: 32 * 1024 * 1024 },
  );
  assert.equal(dump.status, 0, dump.stderr.toString());
  assert.ok(dump.stdout.byteLength > 0);
  const database = "earnest_restore_" + randomUUID().replaceAll("-", "");
  assert.match(database, /^earnest_restore_[a-f0-9]{32}$/);
  await pool.query(`CREATE DATABASE ${database}`);
  let restored;
  try {
    const result = spawnSync(
      "docker",
      [
        "exec",
        "-i",
        containerId,
        "pg_restore",
        "-U",
        "postgres",
        "--exit-on-error",
        "--no-owner",
        "-d",
        database,
      ],
      { input: dump.stdout, timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    assert.equal(result.status, 0, result.stderr.toString());
    restored = new pg.Pool({ ...pool.options, database });
    await run({
      pool: restored,
      query: async (sql, params = []) => (await restored.query(sql, params)).rows,
      dumpBytes: dump.stdout.byteLength,
    });
  } finally {
    await restored?.end();
    await pool.query(`DROP DATABASE ${database}`);
  }
}
