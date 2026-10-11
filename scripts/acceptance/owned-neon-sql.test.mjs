import assert from "node:assert/strict";
import test from "node:test";
import {
  dbTargetOrOwned,
  onDbTarget,
  ownedNeonSql,
  targetClientPorts,
} from "./owned-postgres-test.mjs";

function fakePool({ failOn } = {}) {
  const log = [];
  let released = 0;
  const client = {
    async query(text, params) {
      log.push(params ? [text, params] : [text]);
      if (failOn && text.includes(failOn)) throw new Error("boom");
      return { rows: [{ text }], rowCount: 1 };
    },
    release() {
      released += 1;
    },
  };
  return {
    log,
    released: () => released,
    async connect() {
      return client;
    },
    async query(text, params) {
      return client.query(text, params);
    },
  };
}

test("adapter runs a callback transaction in one BEGIN/COMMIT", async () => {
  const pool = fakePool();
  const sql = ownedNeonSql(pool);
  const results = await sql.transaction(
    (t) => [t.query("SELECT 1 AS a", []), t.query("SELECT $1 AS b", [2])],
    { isolationLevel: "Serializable" },
  );
  const texts = pool.log.map(([text]) => text);
  assert.equal(texts.filter((text) => text.startsWith("BEGIN")).length, 1);
  assert.match(texts[0], /^BEGIN ISOLATION LEVEL SERIALIZABLE/);
  assert.deepEqual(texts.slice(1), ["SELECT 1 AS a", "SELECT $1 AS b", "COMMIT"]);
  assert.deepEqual(pool.log[2][1], [2]);
  assert.equal(results.length, 2);
  assert.deepEqual(results[1], [{ text: "SELECT $1 AS b" }]);
  assert.equal(pool.released(), 1);

  const arrayPool = fakePool();
  const arrayed = await ownedNeonSql(arrayPool).transaction([
    ownedNeonSql(arrayPool).query("SELECT 7"),
  ]);
  assert.deepEqual(
    arrayPool.log.map(([text]) => text),
    ["BEGIN", "SELECT 7", "COMMIT"],
  );
  assert.deepEqual(arrayed, [[{ text: "SELECT 7" }]]);
});

test("adapter query returns the rows array like the Neon driver", async () => {
  const pool = fakePool();
  assert.deepEqual(await ownedNeonSql(pool).query("SELECT 1", []), [{ text: "SELECT 1" }]);
});

test("adapter rolls back on error", async () => {
  const pool = fakePool({ failOn: "FAIL" });
  const sql = ownedNeonSql(pool);
  await assert.rejects(
    sql.transaction((t) => [t.query("SELECT 1"), t.query("FAIL")]),
    /boom/,
  );
  const texts = pool.log.map(([text]) => text);
  assert.equal(texts.at(-1), "ROLLBACK");
  assert.ok(!texts.includes("COMMIT"));
  assert.equal(pool.released(), 1);
});

test("CI without a database fails instead of skipping", async () => {
  let ran = false;
  await assert.rejects(
    dbTargetOrOwned(
      async () => {
        ran = true;
      },
      { env: { CI: "true" }, dockerAvailable: () => false },
    ),
    (error) => error.message === "OWNED_DB_REQUIRED_NO_SKIPPED_PASS",
  );
  assert.equal(ran, false);
});

test("without TEST_DATABASE_URL the owned Postgres is used and handed an adapter", async () => {
  const pool = fakePool();
  let received;
  await dbTargetOrOwned(
    async (target) => {
      received = target;
    },
    {
      env: { CI: "true" },
      dockerAvailable: () => true,
      withOwned: async (run) => run({ pool }),
    },
  );
  assert.equal(received.owned, true);
  assert.deepEqual(await received.sql.query("SELECT 1"), [{ text: "SELECT 1" }]);
});

test("urlVar picks the disposable URL variable a suite already uses", async () => {
  const seen = [];
  const deps = {
    env: { CI: "true", TEST_DATABASE_URL: "postgres://elsewhere.invalid/x" },
    dockerAvailable: () => true,
    withOwned: async (run) => run({ pool: fakePool() }),
    urlVar: "ASTRA_TEST_DATABASE_URL",
  };
  await dbTargetOrOwned(async (target) => seen.push(target.owned), deps);
  assert.deepEqual(seen, [true], "an unrelated TEST_DATABASE_URL is not the ASTRA target");
  await assert.rejects(
    dbTargetOrOwned(async () => seen.push("ran"), { ...deps, dockerAvailable: () => false }),
    (error) => error.message === "OWNED_DB_REQUIRED_NO_SKIPPED_PASS",
  );
  await assert.rejects(
    dbTargetOrOwned(async () => seen.push("ran"), {
      ...deps,
      env: { ASTRA_TEST_DATABASE_URL: "postgres://user@ep-x.neon.tech/neondb" },
    }),
    /confirmation is required/,
    "the ASTRA URL still goes through the disposable-target guard",
  );
  assert.deepEqual(seen, [true]);
});

test("onDbTarget hands the target and the test context to the body", async () => {
  const context = { name: "t" };
  let received;
  await onDbTarget(
    async (target, t) => {
      received = [target.owned, t];
    },
    { env: {}, withOwned: async (run) => run({ pool: fakePool() }) },
  )(context);
  assert.deepEqual(received, [true, context]);
});

test("targetClientPorts binds owned clients to the loopback pool", async () => {
  const pool = { options: { host: "127.0.0.1", port: 54321 }, connect: async () => ({}) };
  const ports = await targetClientPorts({ owned: true, pool });
  assert.equal(ports.connectionString, "postgresql://postgres@127.0.0.1:54321/postgres");
  assert.throws(() => ports.createClient({ connectionString: "postgres://other.invalid/x" }));
  assert.deepEqual(ports.createClient({ connectionString: ports.connectionString }).neonConfig, {});
});
