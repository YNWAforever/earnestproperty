import assert from "node:assert/strict";
import { test } from "node:test";

import { withMlsAdvisoryLock } from "./neon-lock.mjs";

function queryResult(rows = []) {
  return { rows, rowCount: rows.length, command: "SELECT", fields: [], oid: 0 };
}

function fakeClient({ acquired = true, lockRows, unlockRows, ...failures } = {}) {
  const events = [];
  return {
    events,
    async connect() {
      events.push("connect");
      if (failures.connectError) throw failures.connectError;
    },
    async query(statement, params) {
      assert.deepEqual(params, ["earnestproperty:mls-sync"]);
      if (statement.includes("pg_try_advisory_lock")) {
        events.push("lock");
        if (failures.lockError) throw failures.lockError;
        return queryResult(lockRows ?? [{ acquired }]);
      }
      if (statement.includes("pg_advisory_unlock")) {
        events.push("unlock");
        if (failures.unlockError) throw failures.unlockError;
        return queryResult(unlockRows ?? [{ released: true }]);
      }
      throw new Error(`unexpected query: ${statement}`);
    },
    async end() {
      events.push("end");
      if (failures.endError) throw failures.endError;
    },
  };
}

const websocket = class FixtureWebSocket {};

test("one dedicated session holds and always releases the run lock", async () => {
  const client = fakeClient({ acquired: true });
  let clientConfig;
  const result = await withMlsAdvisoryLock({
    connectionString: "postgres://test",
    WebSocketImpl: websocket,
    createClient(config) {
      clientConfig = config;
      return client;
    },
    work: async (lockedClient) => {
      assert.equal(lockedClient, client);
      return "done";
    },
  });

  assert.equal(result, "done");
  assert.deepEqual(client.events, ["connect", "lock", "unlock", "end"]);
  assert.deepEqual(clientConfig, {
    connectionString: "postgres://test",
    connectionTimeoutMillis: 15_000,
    query_timeout: 30_000,
  });
});

test("all dependency preflights fail before constructing a database client", async () => {
  const cases = [
    { connectionString: "", WebSocketImpl: websocket, createClient() {}, work() {} },
    {
      connectionString: "postgres://test",
      WebSocketImpl: undefined,
      createClient() {},
      work() {},
    },
    {
      connectionString: "postgres://test",
      WebSocketImpl: websocket,
      createClient: null,
      work() {},
    },
    {
      connectionString: "postgres://test",
      WebSocketImpl: websocket,
      createClient() {},
      work: null,
    },
  ];

  for (const fixture of cases) {
    let constructed = false;
    const suppliedCreateClient = fixture.createClient;
    await assert.rejects(
      withMlsAdvisoryLock({
        ...fixture,
        createClient:
          typeof suppliedCreateClient === "function"
            ? (...args) => {
                constructed = true;
                return suppliedCreateClient(...args);
              }
            : suppliedCreateClient,
      }),
      /DATABASE_URL_UNPOOLED|WebSocket|createClient|work/i,
    );
    assert.equal(constructed, false);
  }
});

test("lock contention skips work and closes the session", async () => {
  const client = fakeClient({ acquired: false });
  let ran = false;
  const result = await withMlsAdvisoryLock({
    connectionString: "postgres://test",
    WebSocketImpl: websocket,
    createClient: () => client,
    work: async () => {
      ran = true;
    },
  });

  assert.deepEqual(result, { kind: "lock_unavailable" });
  assert.equal(ran, false);
  assert.deepEqual(client.events, ["connect", "lock", "end"]);
});

test("lock and unlock booleans are parsed strictly", async () => {
  for (const lockRows of [[], [{ acquired: "t" }], [{ acquired: 1 }], [{ acquired: null }]]) {
    const client = fakeClient({ lockRows });
    await assert.rejects(
      withMlsAdvisoryLock({
        connectionString: "postgres://test",
        WebSocketImpl: websocket,
        createClient: () => client,
        work: async () => "unreachable",
      }),
      /lock result/i,
    );
    assert.deepEqual(client.events, ["connect", "lock", "end"]);
  }

  const malformedUnlock = fakeClient({ unlockRows: [{ released: "t" }] });
  await assert.rejects(
    withMlsAdvisoryLock({
      connectionString: "postgres://test",
      WebSocketImpl: websocket,
      createClient: () => malformedUnlock,
      work: async () => "done",
    }),
    /unlock result/i,
  );
  assert.deepEqual(malformedUnlock.events, ["connect", "lock", "unlock", "end"]);
});

test("a work exception remains primary while unlock and end are still attempted", async () => {
  const workError = new Error("work failed exactly");
  const unlockError = new Error("unlock failed during work cleanup");
  const endError = new Error("end failed during work cleanup");
  const client = fakeClient({ unlockError, endError });

  await assert.rejects(
    withMlsAdvisoryLock({
      connectionString: "postgres://test",
      WebSocketImpl: websocket,
      createClient: () => client,
      work: async () => {
        throw workError;
      },
    }),
    (error) => {
      assert.equal(error, workError);
      assert.deepEqual(error.cleanupErrors, [unlockError, endError]);
      return true;
    },
  );
  assert.deepEqual(client.events, ["connect", "lock", "unlock", "end"]);
});

test("successful work surfaces unlock failure before end failure", async () => {
  const unlockError = new Error("unlock failed exactly");
  const endError = new Error("end failed exactly");
  const client = fakeClient({ unlockError, endError });

  await assert.rejects(
    withMlsAdvisoryLock({
      connectionString: "postgres://test",
      WebSocketImpl: websocket,
      createClient: () => client,
      work: async () => "done",
    }),
    (error) => {
      assert.equal(error, unlockError);
      assert.deepEqual(error.cleanupErrors, [endError]);
      return true;
    },
  );
  assert.deepEqual(client.events, ["connect", "lock", "unlock", "end"]);
});

test("failed connection setup still closes the client", async () => {
  const connectionError = new Error("connect failed exactly");
  const client = fakeClient({ connectError: connectionError });

  await assert.rejects(
    withMlsAdvisoryLock({
      connectionString: "postgres://test",
      WebSocketImpl: websocket,
      createClient: () => client,
      work: async () => "unreachable",
    }),
    (error) => error === connectionError,
  );
  assert.deepEqual(client.events, ["connect", "end"]);
});

test("a client-construction error propagates without attempting work", async () => {
  const constructionError = new Error("construct failed exactly");
  let worked = false;
  await assert.rejects(
    withMlsAdvisoryLock({
      connectionString: "postgres://test",
      WebSocketImpl: websocket,
      createClient() {
        throw constructionError;
      },
      work: async () => {
        worked = true;
      },
    }),
    (error) => error === constructionError,
  );
  assert.equal(worked, false);
});
