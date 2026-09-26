import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function startImport(row) {
  const wakes = [];
  const queries = [];
  const source = readFileSync("src/lib/woztell/history-import.server.ts", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const mocks = {
    "../control-plane/job-wake.server.ts": { wakeAfterCommit: (lane) => wakes.push(lane) },
    "node:crypto": { createHash },
    "./woztell-history.server.ts": {},
    "../neon/db.server.ts": {
      queryRows: async (statement, params) => {
        queries.push({ statement, params });
        return [row];
      },
    },
  };
  const mockRequire = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error("Unexpected dependency: " + specifier);
  };
  const process = { env: { WOZTELL_CHANNEL_ID: "channel-1", WOZTELL_OPEN_API_TOKEN: "test" } };
  new Function("require", "module", "exports", "process", compiled)(
    mockRequire,
    module,
    module.exports,
    process,
  );
  return { call: module.exports.startHistoryImport, wakes, queries };
}

test("duplicate unchanged history imports do not wake the worker", async () => {
  for (const status of ["queued", "running", "succeeded", "cancelled"]) {
    const harness = startImport({ id: "import-1", completed: false, job_queued: false });
    const result = await harness.call("22222222-2222-4222-8222-222222222222", "forward");
    assert.equal(result.id, "import-1", status);
    assert.deepEqual(harness.wakes, [], status);
  }
});

test("new or retryable queued history import wakes exactly once", async () => {
  const harness = startImport({ id: "import-1", completed: false, job_queued: true });
  await harness.call("22222222-2222-4222-8222-222222222222", "forward");
  assert.deepEqual(harness.wakes, ["general"]);
  assert.equal(harness.queries.length, 1);
});

test("history import SQL returns queued state only for new or retried jobs", async () => {
  const harness = startImport({ id: "import-1", completed: true, job_queued: false });
  await harness.call("22222222-2222-4222-8222-222222222222", "backward");
  assert.deepEqual(harness.wakes, []);
  const sql = harness.queries[0].statement;
  assert.match(sql, /WHERE ops_jobs\.status='failed'/);
  assert.match(sql, /EXISTS\(SELECT 1 FROM job WHERE status='queued'\) AS job_queued/);
});
