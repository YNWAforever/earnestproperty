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
const liveAgent = loadTypeScript("src/lib/ai/live-agent.ts", {
  "../neon/admin-workflow.ts": loadTypeScript("src/lib/neon/admin-workflow.ts", {
    "../phone.js": loadTypeScript("src/lib/phone.js"),
  }),
});

const PHONE_REQUIRED_COPY = "請輸入電話號碼，方便代理聯絡你。";
const PHONE_INVALID_COPY = "電話號碼格式不正確，請輸入 8 位香港手機號碼，或連國家碼的號碼。";

class LiveAgentPublicError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    if (code !== undefined) this.code = code;
  }
}

function handoffHandler(body, calls, requestLiveAgentHandoff) {
  const { Route } = loadTypeScript("src/routes/api.live-agent.handoff.ts", {
    "@tanstack/react-start/server-only": {},
    "@tanstack/react-router": { createFileRoute: () => (definition) => definition },
    "@/lib/ai/read-public-json-body": { readPublicJsonBody: async () => body },
    "@/lib/ai/live-agent": liveAgent,
    "@/lib/ai/live-agent.server": {
      LiveAgentPublicError,
      isLiveAgentSessionId: () => true,
      requestLiveAgentHandoff:
        requestLiveAgentHandoff ??
        (async (input) => {
          calls.service.push(input);
          return { ok: true };
        }),
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
  const base = { sessionId: "session-1", accessToken: "token-1", phone: "91234567" };
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

test("missing or invalid handoff phone returns 400 zh-HK copy and never rate-limits or reaches the CRM", async () => {
  const base = { sessionId: "session-1", accessToken: "token-1" };
  for (const [phone, code, error] of [
    [undefined, "LIVE_AGENT_PHONE_REQUIRED", PHONE_REQUIRED_COPY],
    ["", "LIVE_AGENT_PHONE_REQUIRED", PHONE_REQUIRED_COPY],
    ["9123456", "LIVE_AGENT_PHONE_INVALID", PHONE_INVALID_COPY],
    [91234567, "LIVE_AGENT_PHONE_REQUIRED", PHONE_REQUIRED_COPY],
    ["+852 2345 6789", "LIVE_AGENT_PHONE_INVALID", PHONE_INVALID_COPY],
  ]) {
    const calls = { rateLimit: 0, service: [] };
    const response = await handoffHandler(
      phone === undefined ? base : { ...base, phone },
      calls,
    )({
      request: new Request("https://example.com/api/live-agent/handoff", { method: "POST" }),
    });
    assert.equal(response.status, 400, `phone ${JSON.stringify(phone)}`);
    assert.deepEqual(await response.json(), { error, code });
    assert.equal(calls.rateLimit, 0);
    assert.equal(calls.service.length, 0);
  }
});

test("service phone error keeps its code in the 400 body", async () => {
  const calls = { rateLimit: 0, service: [] };
  const response = await handoffHandler(
    { sessionId: "session-1", accessToken: "token-1", phone: "91234567" },
    calls,
    async () => {
      throw new LiveAgentPublicError(PHONE_INVALID_COPY, 400, "LIVE_AGENT_PHONE_INVALID");
    },
  )({
    request: new Request("https://example.com/api/live-agent/handoff", { method: "POST" }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: PHONE_INVALID_COPY,
    code: "LIVE_AGENT_PHONE_INVALID",
  });
  assert.equal(calls.rateLimit, 1);
});

test("valid handoff budgets still use rate limiting and reach the service", async () => {
  const calls = { rateLimit: 0, service: [] };
  const response = await handoffHandler(
    {
      sessionId: "session-1",
      accessToken: "token-1",
      phone: "91234567",
      budget_min: 0,
      budget_max: 100,
    },
    calls,
  )({
    request: new Request("https://example.com/api/live-agent/handoff", { method: "POST" }),
  });
  assert.equal(response.status, 200);
  assert.equal(calls.rateLimit, 1);
  assert.equal(calls.service.length, 1);
  assert.equal(calls.service[0].phone, "91234567");
  assert.equal(calls.service[0].budget_min, 0);
  assert.equal(calls.service[0].budget_max, 100);
});
