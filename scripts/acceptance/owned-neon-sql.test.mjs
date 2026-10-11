import assert from "node:assert/strict";
import test from "node:test";
import { dbTargetOrOwned, ownedNeonSql } from "./owned-postgres-test.mjs";

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
