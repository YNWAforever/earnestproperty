import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const input = {
  requestId: "11111111-1111-4111-8111-111111111111",
  conversationId: "22222222-2222-4222-8222-222222222222",
  kind: "text",
  payload: { text: "Hello" },
};

function loadIntent(row) {
  const wakes = [];
  const statements = [];
  const source = readFileSync("src/lib/woztell/outbound-intent.server.ts", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const mocks = {
    "../control-plane/job-wake.server.ts": {
      wakeAfterCommit: (lane) => wakes.push(lane),
    },
    "node:crypto": { createHash, randomUUID },
    "./provider-result.ts": { parseWoztellProviderResult: () => ({}) },
  };
  const mockRequire = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error("Unexpected dependency: " + specifier);
  };
  new Function("require", "module", "exports", compiled)(mockRequire, module, module.exports);
  const queryRows = async (statement) => {
    statements.push(statement);
    return [row];
  };
  return {
    enqueue: () => module.exports.enqueueOutboundIntent(input, input.requestId, null, queryRows),
    wakes,
    statements,
  };
}

test("a repeated queued intent does not wake or update conversation recency", async () => {
  const harness = loadIntent({ id: input.requestId, state: "queued", job_queued: false });
  const result = await harness.enqueue();
  assert.deepEqual(result, { id: input.requestId, state: "queued" });
  assert.deepEqual(harness.wakes, []);
  assert.match(harness.statements[0], /FROM intent i JOIN message m ON m.id=i.message_id/);
  assert.match(harness.statements[0], /EXISTS\(SELECT 1 FROM job\) AS job_queued/);
});

test("a newly inserted delivery job wakes service once", async () => {
  const harness = loadIntent({ id: input.requestId, state: "queued", job_queued: true });
  const result = await harness.enqueue();
  assert.deepEqual(result, { id: input.requestId, state: "queued" });
  assert.deepEqual(harness.wakes, ["service"]);
});
