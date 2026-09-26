import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function backfillHandler(calls) {
  const source = readFileSync("src/routes/api.admin.woztell.backfill.ts", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const mocks = {
    "@tanstack/react-start/server-only": {},
    "@tanstack/react-router": { createFileRoute: () => (definition) => definition },
    "@/lib/neon/auth.server": {
      requireStaffAccess: async () => ({ staffId: "admin-1" }),
    },
    "@/lib/woztell/history-import.server": {
      startHistoryImport: async (staffId, mode) => {
        calls.push({ staffId, mode });
        return { id: "run-1", completed: false };
      },
    },
  };
  const mockRequire = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error("Unexpected dependency: " + specifier);
  };
  const process = { env: { WOZTELL_OPEN_API_TOKEN: "test", WOZTELL_CHANNEL_ID: "test" } };
  new Function("require", "module", "exports", "process", compiled)(
    mockRequire,
    module,
    module.exports,
    process,
  );
  return module.exports.Route.server.handlers.POST;
}

function request(body) {
  return new Request("https://example.com/api/admin/woztell/backfill", {
    method: "POST",
    ...(body === undefined ? {} : { body }),
  });
}

test("malformed and non-object backfill bodies never queue an import", async () => {
  for (const body of ["{broken", "[1,2,3]", "null"]) {
    const calls = [];
    const response = await backfillHandler(calls)({ request: request(body) });
    assert.equal(response.status, 400);
    assert.deepEqual(calls, []);
  }
});

test("valid and empty backfill requests retain their forward default", async () => {
  for (const body of [undefined, JSON.stringify({ mode: "forward" })]) {
    const calls = [];
    const response = await backfillHandler(calls)({ request: request(body) });
    assert.equal(response.status, 202);
    assert.deepEqual(calls, [{ staffId: "admin-1", mode: "forward" }]);
  }
});

test("backward backfill remains explicit and invalid modes do not queue", async () => {
  const calls = [];
  const handler = backfillHandler(calls);
  assert.equal(
    (await handler({ request: request(JSON.stringify({ mode: "sideways" })) })).status,
    400,
  );
  assert.deepEqual(calls, []);
  assert.equal(
    (await handler({ request: request(JSON.stringify({ mode: "backward" })) })).status,
    202,
  );
  assert.deepEqual(calls, [{ staffId: "admin-1", mode: "backward" }]);
});
