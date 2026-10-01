import test from "node:test";
import assert from "node:assert/strict";
import { runSnapshotBridge } from "./apply-source-snapshot.mjs";
import { SnapshotError } from "../../src/lib/mls/ingestion-contract.mjs";
test("T28 bridge defaults to dry run and never loads DB credentials", async () => {
  let options;
  const env = new Proxy(
    {},
    {
      get() {
        assert.fail("dryrun must not inspect credentials");
      },
    },
  );
  const result = await runSnapshotBridge(["--payload", "saved.json"], {
    env,
    readPayload: async () => '{"source":"28hse"}',
    ingest: async (p, o) => {
      options = o;
      return { success: true, status: "dry_run" };
    },
  });
  assert.equal(result.status, "dry_run");
  assert.deepEqual(options, { apply: false, expectedSource: "28hse_agent_540" });
});
test("apply accepts only collected 28hse payload and explicit switch", async () => {
  let options;
  await runSnapshotBridge(["--payload", "saved.json", "--apply"], {
    env: {
      DATABASE_URL_UNPOOLED: "postgres://fixture:fixture@ep-disposable-test.neon.tech/neondb",
      PROPERTY_SYNC_EXPECTED_DATABASE_HOST: "ep-disposable-test.neon.tech",
    },
    readPayload: async () => '{"source":"28hse"}',
    ingest: async (p, o) => {
      options = o;
      return {};
    },
  });
  assert.deepEqual(options, {
    apply: true,
    expectedSource: "28hse_agent_540",
    connectionString: "postgres://fixture:fixture@ep-disposable-test.neon.tech/neondb",
  });
  for (const args of [[], ["--payload", "x", "--crawl"], ["--payload", "x", "--apply", "--apply"]])
    await assert.rejects(runSnapshotBridge(args), SnapshotError);
  let calls = 0;
  await assert.rejects(
    runSnapshotBridge(["--payload", "x"], {
      readPayload: async () => '{"source":"propertyhk"}',
      ingest: () => calls++,
    }),
    SnapshotError,
  );
  assert.equal(calls, 0);
});
test("oversize/malformed frozen artifact never reaches ingestion", async () => {
  for (const content of ["{", " ".repeat(5 * 1024 * 1024 + 1)])
    await assert.rejects(
      runSnapshotBridge(["--payload", "x"], {
        readPayload: async () => content,
        ingest: () => assert.fail("no ingest"),
      }),
      SnapshotError,
    );
});

test("bridge errors expose only safe code, status and bounded retry metadata", async () => {
  const { safeBridgeError } = await import("./apply-source-snapshot.mjs");
  assert.deepEqual(
    safeBridgeError(
      new SnapshotError("OUTCOME_UNKNOWN", 503, { retryAfter: 5, secret: "private" }),
    ),
    { success: false, error: "OUTCOME_UNKNOWN", status: 503, retryAfter: 5 },
  );
  assert.deepEqual(safeBridgeError(new Error("postgres://secret")), {
    success: false,
    error: "INGESTION_UNAVAILABLE",
    status: 503,
  });
});

test("apply refuses wrong DB host before the ingestion service can write", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      runSnapshotBridge(["--payload", "saved.json", "--apply"], {
        env: {
          DATABASE_URL_UNPOOLED: "postgres://fixture:fixture@wrong.neon.tech/neondb",
          PROPERTY_SYNC_EXPECTED_DATABASE_HOST: "approved.neon.tech",
        },
        readPayload: async () => '{"source":"28hse"}',
        ingest: () => {
          calls++;
        },
      }),
    /TARGET_UNVERIFIED/,
  );
  assert.equal(calls, 0);
});

test("Property.hk bridge requires explicit source selection and protected policy in service", async () => {
  let called = 0;
  const ports = {
    env: {},
    readPayload: async () => '{"source":"propertyhk"}',
    ingest: async (p, o) => {
      called++;
      assert.equal(o.expectedSource, "propertyhk");
      assert.equal(o.apply, false);
      return { success: true };
    },
  };
  await runSnapshotBridge(["--source", "propertyhk", "--payload", "frozen.json"], ports);
  assert.equal(called, 1);
  await assert.rejects(runSnapshotBridge(["--source", "other", "--payload", "x"], ports));
  await assert.rejects(
    runSnapshotBridge(["--source", "propertyhk", "--payload", "x"], {
      ...ports,
      readPayload: async () => '{"source":"28hse"}',
    }),
  );
  assert.equal(called, 1);
});
