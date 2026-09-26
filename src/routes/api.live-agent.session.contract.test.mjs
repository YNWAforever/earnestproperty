import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

function loadTypeScript(relativePath, mocks = {}) {
  const source = readFileSync(join(process.cwd(), relativePath), "utf8");
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

const { readPublicJsonBody } = loadTypeScript("src/lib/ai/read-public-json-body.ts");

function sessionHandler(calls) {
  const { Route } = loadTypeScript("src/routes/api.live-agent.session.ts", {
    "@tanstack/react-start/server-only": {},
    "@tanstack/react-router": { createFileRoute: () => (definition) => definition },
    "@/lib/ai/read-public-json-body": { readPublicJsonBody },
    "@/lib/ai/live-agent.server": {
      createLiveAgentSession: async () => {
        calls.session++;
        return { session: { id: "session-1" }, accessToken: "token-1" };
      },
      toPublicLiveAgentSession: (session) => session,
    },
    "@/lib/ratelimit.server": {
      clientIpFromRequest: () => "127.0.0.1",
      enforceRateLimit: async () => {
        calls.rateLimit++;
      },
    },
  });
  return Route.server.handlers.POST;
}

test("oversized session body returns 413 without writing a rate-limit bucket", async () => {
  const calls = { rateLimit: 0, session: 0 };
  const response = await sessionHandler(calls)({
    request: new Request("https://example.com/api/live-agent/session", {
      method: "POST",
      body: JSON.stringify({ anonymousId: "x".repeat(20_000) }),
    }),
  });
  assert.equal(response.status, 413);
  assert.equal(calls.rateLimit, 0);
  assert.equal(calls.session, 0);
});

test("malformed session bodies return 400 without database writes", async () => {
  for (const body of ["{broken", "[1,2,3]", "   "]) {
    const calls = { rateLimit: 0, session: 0 };
    const response = await sessionHandler(calls)({
      request: new Request("https://example.com/api/live-agent/session", {
        method: "POST",
        body,
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(calls.rateLimit, 0);
    assert.equal(calls.session, 0);
  }
});
test("valid session body still uses rate limiting and creates a session", async () => {
  const calls = { rateLimit: 0, session: 0 };
  const response = await sessionHandler(calls)({
    request: new Request("https://example.com/api/live-agent/session", {
      method: "POST",
      body: JSON.stringify({ anonymousId: "visitor-1" }),
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(calls.rateLimit, 1);
  assert.equal(calls.session, 1);
});
test("empty session body still creates a rate-limited session", async () => {
  const calls = { rateLimit: 0, session: 0 };
  const response = await sessionHandler(calls)({
    request: new Request("https://example.com/api/live-agent/session", { method: "POST" }),
  });
  assert.equal(response.status, 200);
  assert.equal(calls.rateLimit, 1);
  assert.equal(calls.session, 1);
});
