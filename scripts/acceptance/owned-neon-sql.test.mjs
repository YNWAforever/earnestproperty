import assert from "node:assert/strict";
import test from "node:test";
import {
  dbTargetOrOwned,
  onDbTarget,
  ownedNeonSql,
  targetClientPorts,
  withOwnedPostgres,
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

test("adapter keeps the original error when ROLLBACK also fails", async () => {
  const pool = fakePool({ failOn: "FAIL" });
  const sql = ownedNeonSql(pool);
  const client = await pool.connect();
  const original = client.query;
  client.query = async (text, params) => {
    if (text === "ROLLBACK") {
      pool.log.push([text]);
      throw new Error("rollback lost the connection");
    }
    return original(text, params);
  };
  await assert.rejects(
    sql.transaction((t) => [t.query("FAIL")]),
    (error) => {
      assert.equal(error.message, "boom", "the statement's error, not the rollback's");
      assert.equal(error.rollbackError?.message, "rollback lost the connection");
      return true;
    },
  );
  assert.equal(pool.log.at(-1)[0], "ROLLBACK");
  assert.equal(pool.released(), 1);
});

/**
 * A docker CLI stand-in for withOwnedPostgres. `run` answers like `docker run --detach`
 * unless `runFails` says otherwise; inspect reflects the name and image it was started with.
 */
function fakeDocker({ runFails, rmFails } = {}) {
  const calls = [];
  let started;
  const docker = (...args) => {
    calls.push(args);
    const [command] = args;
    if (command === "run") {
      const name = args[args.indexOf("--name") + 1];
      if (runFails) throw new Error("Owned Docker test: " + runFails);
      started = { id: "a".repeat(64), name, image: args.at(-1) };
      return started.id;
    }
    if (command === "inspect")
      return JSON.stringify([
        {
          Name: "/" + started.name,
          Config: { Image: started.image },
          NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54329" }] } },
        },
      ]);
    if (command === "rm" && rmFails) throw new Error("Owned Docker test: " + rmFails);
    return "";
  };
  return { docker, calls };
}

test("a docker run that fails or times out removes the container it may have created", async () => {
  const { docker, calls } = fakeDocker({ runFails: "spawnSync docker ETIMEDOUT" });
  let ran = false;
  await assert.rejects(
    withOwnedPostgres(
      async () => {
        ran = true;
      },
      { docker },
    ),
    /ETIMEDOUT/,
    "the run error is what the caller sees",
  );
  assert.equal(ran, false);
  const run = calls.find(([command]) => command === "run");
  const name = run[run.indexOf("--name") + 1];
  assert.match(name, /^earnest-remediation-qa-[0-9a-f-]{36}$/);
  // Only this harness's container, by the exact name it was given; never a prune.
  assert.deepEqual(calls.slice(1), [["rm", "-f", name]]);
  assert.ok(!calls.some(([command]) => command === "prune" || command === "system"));
});

test("a failed cleanup after a failed docker run still surfaces the run error", async () => {
  const { docker, calls } = fakeDocker({
    runFails: "port is already allocated",
    rmFails: "No such container",
  });
  await assert.rejects(
    withOwnedPostgres(async () => {}, { docker }),
    (error) => {
      assert.match(error.message, /port is already allocated/);
      assert.match(error.cleanupError?.message ?? "", /No such container/);
      return true;
    },
  );
  assert.deepEqual(
    calls.map(([command]) => command),
    ["run", "rm"],
  );
});

test("the owned transaction helper keeps the original error when ROLLBACK also fails", async () => {
  const log = [];
  const releases = [];
  const client = {
    async query(text) {
      log.push(text);
      if (text.startsWith("INSERT bad")) throw new Error("duplicate key");
      if (text === "ROLLBACK") throw new Error("connection terminated");
      return { rows: [] };
    },
    release(error) {
      releases.push(error);
    },
  };
  const pool = {
    async query() {
      return { rows: [{ "?column?": 1 }] };
    },
    async connect() {
      return client;
    },
    async end() {},
  };
  const { docker, calls } = fakeDocker();
  let caught;
  await withOwnedPostgres(
    async ({ transaction }) => {
      caught = await transaction([{ statement: "INSERT bad" }]).catch((error) => error);
    },
    { docker, createPool: () => pool, migrationVersions: [] },
  );
  assert.equal(caught?.message, "duplicate key", "the statement's error, not the rollback's");
  assert.equal(caught.rollbackError?.message, "connection terminated");
  assert.deepEqual(log, ["BEGIN", "INSERT bad", "ROLLBACK"]);
  // A connection whose ROLLBACK failed is discarded, not returned to the pool.
  assert.equal(releases.length, 1);
  assert.equal(releases[0]?.message, "connection terminated");
  assert.deepEqual(
    calls.map(([command]) => command),
    ["run", "inspect", "inspect", "stop"],
  );
});
