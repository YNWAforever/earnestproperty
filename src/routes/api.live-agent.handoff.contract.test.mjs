import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadTypeScript(relativePath, mocks = {}) {
  const source = readFileSync(join(root, relativePath), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const mockRequire = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error("Unexpected dependency: " + specifier);
  };
  new Function("require", "module", "exports", compiled)(mockRequire, module, module.exports);
  return module.exports;
}

const { leadBudgetError } = loadTypeScript("src/lib/admin/lead-budget.ts");

function handoffHandler(body, calls) {
  class LiveAgentPublicError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }
  const { Route } = loadTypeScript("src/routes/api.live-agent.handoff.ts", {
    "@tanstack/react-start/server-only": {},
    "@tanstack/react-router": { createFileRoute: () => (definition) => definition },
    "@/lib/ai/read-public-json-body": { readPublicJsonBody: async () => body },
    "@/lib/ai/live-agent.server": {
      LiveAgentPublicError,
      isLiveAgentSessionId: () => true,
      requestLiveAgentHandoff: async (input) => {
        calls.service.push(input);
        return { ok: true };
      },
    },
    "@/lib/ratelimit.server": {
      clientIpFromRequest: () => "127.0.0.1",
      enforceRateLimit: async () => {
        calls.rateLimit++;
      },
    },
    "@/lib/admin/lead-budget": { leadBudgetError },
  });
  return Route.server.handlers.POST;
}

test("invalid handoff budgets never write a rate-limit bucket or contact the CRM", async () => {
  const base = { sessionId: "session-1", accessToken: "token-1" };
  for (const budget of [
    { budget_min: -1 },
    { budget_min: 200, budget_max: 100 },
    { budget_max: Number.POSITIVE_INFINITY },
    { budget_min: "100" },
  ]) {
    const calls = { rateLimit: 0, service: [] };
    const response = await handoffHandler(
      { ...base, ...budget },
      calls,
    )({
      request: new Request("https://example.com/api/live-agent/handoff", { method: "POST" }),
    });
    assert.equal(response.status, 400);
    assert.equal(calls.rateLimit, 0);
    assert.equal(calls.service.length, 0);
  }
});

test("valid handoff budgets still use rate limiting and reach the service", async () => {
  const calls = { rateLimit: 0, service: [] };
  const response = await handoffHandler(
    { sessionId: "session-1", accessToken: "token-1", budget_min: 0, budget_max: 100 },
    calls,
  )({
    request: new Request("https://example.com/api/live-agent/handoff", { method: "POST" }),
  });
  assert.equal(response.status, 200);
  assert.equal(calls.rateLimit, 1);
  assert.equal(calls.service.length, 1);
  assert.equal(calls.service[0].budget_min, 0);
  assert.equal(calls.service[0].budget_max, 100);
});
