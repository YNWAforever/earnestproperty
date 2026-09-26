import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const input = {
  jobType: "test.integration",
  payloadVersion: 1,
  payload: { value: 1 },
  idempotencyKey: "one-run",
};
const queued = { id: "job-1", job_type: "test.integration", status: "queued" };

function loadJobs(duplicate = false) {
  const wakes = [];
  const statements = [];
  const source = readFileSync("src/lib/control-plane/jobs.server.ts", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const mocks = {
    "./job-wake.server.ts": {
      wakeAfterCommit: (lane) => wakes.push(lane),
      laneForJob: () => "general",
    },
    "./job-handlers.server.ts": {
      parseRegisteredJobPayload: (_type, _version, payload) => ({ payload }),
    },
    "../neon/db.server.ts": {
      queryRows: async (statement) => {
        statements.push(statement);
        if (statement.includes("INSERT INTO ops_jobs"))
          return duplicate && statement.includes("DO NOTHING") ? [] : [queued];
        return [queued];
      },
    },
  };
  const mockRequire = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error("Unexpected dependency: " + specifier);
  };
  new Function("require", "module", "exports", compiled)(mockRequire, module, module.exports);
  return { jobs: module.exports, wakes, statements };
}

test("a newly inserted job wakes its lane once", async () => {
  const { jobs, wakes, statements } = loadJobs();
  const row = await jobs.enqueueJob(input);
  assert.equal(row.id, queued.id);
  assert.deepEqual(wakes, ["general"]);
  assert.equal(statements.length, 1);
});

test("an idempotent queued job returns its existing row without a second wake", async () => {
  const { jobs, wakes, statements } = loadJobs(true);
  const row = await jobs.enqueueJob(input);
  assert.equal(row.id, queued.id);
  assert.deepEqual(wakes, []);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /ON CONFLICT \(idempotency_key\) DO NOTHING/);
  assert.match(statements[1], /WHERE idempotency_key=\$1/);
});
