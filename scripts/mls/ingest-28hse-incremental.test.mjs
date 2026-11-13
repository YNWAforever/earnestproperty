import assert from "node:assert/strict";
import test from "node:test";
import { runIncrementalBridge } from "./ingest-28hse-incremental.mjs";
import { incrementalBatch } from "../../src/lib/mls/incremental-test-fixtures.mjs";
const env = {
  DATABASE_URL_UNPOOLED: "postgres://u:p@approved.neon.tech/neondb",
  PROPERTY_SYNC_EXPECTED_DATABASE_HOST: "approved.neon.tech",
};
test("CLI passes only explicit incremental authority and writes the receipt", async () => {
  let written;
  const result = await runIncrementalBridge(
    ["--payload", "capture", "--apply", "--out", "receipt"],
    {
      env,
      read: async () => JSON.stringify(incrementalBatch()),
      ingest: async (payload, options) => {
        assert.equal(payload.source, "28hse");
        assert.deepEqual(options, {
          apply: true,
          incremental: true,
          expectedSource: "28hse_agent_540",
          connectionString: env.DATABASE_URL_UNPOOLED,
        });
        return {
          success: true,
          incremental: true,
          receipt_id: "r",
          summary: { candidate_count: 1 },
        };
      },
      write: async (path, content) => {
        assert.equal(path, "receipt");
        written = JSON.parse(content);
      },
    },
  );
  assert.deepEqual(result, written);
});
test("CLI rejects target and mode flags before reading or ingesting", async () => {
  for (const [args, badEnv] of [
    [
      ["--payload", "capture", "--apply"],
      { ...env, PROPERTY_SYNC_EXPECTED_DATABASE_HOST: "wrong.neon.tech" },
    ],
    [["--payload", "capture", "--patch"], env],
    [["--payload", "capture", "--source", "propertyhk"], env],
    [["--payload", "capture", "--apply", "--apply"], env],
  ]) {
    await assert.rejects(
      () =>
        runIncrementalBridge(args, {
          env: badEnv,
          read() {
            throw Error("read touched");
          },
          ingest() {
            throw Error("ingest touched");
          },
        }),
      /TARGET_UNVERIFIED|INVALID_ARGUMENTS/,
    );
  }
});
test("dry-run CLI validates incremental payload without credentials", async () => {
  const result = await runIncrementalBridge(["--payload", "capture"], {
    env: {},
    read: async () => JSON.stringify(incrementalBatch()),
  });
  assert.equal(result.status, "dry_run");
  assert.equal(result.incremental, true);
  assert.equal(result.full_snapshot, false);
});
