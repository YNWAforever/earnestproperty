import test from "node:test";
import assert from "node:assert/strict";
import { runSnapshotBridge } from "./apply-source-snapshot.mjs";
import { SnapshotError } from "../../src/lib/mls/ingestion-contract.mjs";
import { reviewFixture } from "../../src/lib/mls/controlled-review-fixtures.mjs";

test("explicit operator review plan and hash reach only the native patch options", async () => {
  const f = reviewFixture();
  let received;
  await runSnapshotBridge(
    [
      "--payload",
      "patch.json",
      "--patch",
      "--review-plan",
      "plan.json",
      "--review-plan-hash",
      f.options.reviewPlanHash,
    ],
    {
      env: new Proxy(
        {},
        {
          get() {
            assert.fail("offline must not load credentials");
          },
        },
      ),
      readPayload: async (name) => JSON.stringify(name === "patch.json" ? f.payload : f.plan),
      ingest: async (_payload, options) => {
        received = options;
        return { status: "dry_run" };
      },
    },
  );
  assert.deepEqual(received.reviewPlan, f.plan);
  assert.equal(received.reviewPlanHash, f.options.reviewPlanHash);
  assert.equal(received.apply, false);
});

test("review plan hash mismatch fails before native ingest or credentials", async () => {
  const f = reviewFixture();
  await assert.rejects(
    () =>
      runSnapshotBridge(
        [
          "--payload",
          "patch.json",
          "--patch",
          "--review-plan",
          "plan.json",
          "--review-plan-hash",
          "e".repeat(64),
        ],
        {
          env: new Proxy(
            {},
            {
              get() {
                assert.fail("no credentials");
              },
            },
          ),
          readPayload: async (n) => JSON.stringify(n === "patch.json" ? f.payload : f.plan),
          ingest() {
            assert.fail("no ingest");
          },
        },
      ),
    (e) => e.code === "patch_review_plan_hash_mismatch",
  );
});

test("review flags require explicit patch mode, both sidecar flags and 28hse source", async () => {
  const hash = "a".repeat(64);
  for (const args of [
    ["--payload", "p", "--review-plan", "r"],
    ["--payload", "p", "--patch", "--review-plan-hash", hash],
    ["--payload", "p", "--review-plan", "r", "--review-plan-hash", hash],
    [
      "--payload",
      "p",
      "--source",
      "propertyhk",
      "--patch",
      "--review-plan",
      "r",
      "--review-plan-hash",
      hash,
    ],
    [
      "--payload",
      "p",
      "--patch",
      "--review-plan",
      "r",
      "--review-plan",
      "r",
      "--review-plan-hash",
      hash,
    ],
  ])
    await assert.rejects(
      () =>
        runSnapshotBridge(args, {
          readPayload: async () =>
            JSON.stringify({ source: args.includes("propertyhk") ? "propertyhk" : "28hse" }),
          ingest() {
            assert.fail("no ingest");
          },
          env: new Proxy(
            {},
            {
              get() {
                assert.fail("no env");
              },
            },
          ),
        }),
      (e) => e.code === "INVALID_ARGUMENTS",
    );
});
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
test("controlled patch requires the explicit patch switch and forwards it", async () => {
  let options;
  const result = await runSnapshotBridge(["--payload", "patch.json", "--patch"], {
    env: {},
    readPayload: async () => '{"source":"28hse"}',
    ingest: async (_payload, received) => {
      options = received;
      return { success: true, status: "dry_run" };
    },
  });
  assert.equal(result.status, "dry_run");
  assert.deepEqual(options, {
    apply: false,
    expectedSource: "28hse_agent_540",
    controlledPatch: true,
  });
  await assert.rejects(
    runSnapshotBridge(["--payload", "patch.json", "--patch", "--patch"], {
      readPayload: async () => '{"source":"28hse"}',
      ingest: () => assert.fail("duplicate patch flag must not reach ingest"),
    }),
    SnapshotError,
  );
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
