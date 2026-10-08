import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { createAiGatewayClient } from "./provider.server.ts";

// Synthetic config only: the fetch is always injected, so nothing leaves the process.
const config = {
  apiKey: "test-key-not-real",
  textModel: "test/model",
  enabled: true,
  embeddingModel: null,
};

const input = { system: "system text", prompt: "prompt text" };

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const okBody = { choices: [{ message: { content: "answer" } }], model: "test/model" };

function delayedResponse(ms, status, body, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(jsonResponse(status, body)), ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}

function silenceConsoleError(t) {
  const spy = mock.method(console, "error", () => {});
  t.after(() => spy.mock.restore());
  return spy;
}

test("a hung provider gives up within the budget with at most one retry", async (t) => {
  silenceConsoleError(t);
  let calls = 0;
  const fetchImpl = (_url, init) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    });
  };
  const client = createAiGatewayClient({ fetchImpl, budgetMs: 60, config });

  const started = Date.now();
  const result = await client.generateText(input);
  const elapsed = Date.now() - started;

  assert.equal(result.ok, false);
  assert.equal(result.error, "AI_GENERATION_FAILED");
  assert.equal(result.reason, "AI_TIMEOUT");
  assert.ok(calls <= 2, `expected at most 2 calls, got ${calls}`);
  assert.ok(elapsed < 600, `expected to give up under 600 ms, took ${elapsed} ms`);
});

test("a response within the budget is returned, and no retry starts after the budget is spent", async (t) => {
  silenceConsoleError(t);

  // Plenty of budget left after the 503: one retry, and its 200 is returned.
  // Ruling: the brief's budgetMs 1000 cannot satisfy its own retry floor
  // (AI_RETRY_DELAY_MS + 1000 = 1300 ms must remain; only ~950 ms do), so this case
  // uses 2000 ms. The production rule is unchanged.
  let calls = 0;
  const sleeps = [];
  const retrying = createAiGatewayClient({
    budgetMs: 2000,
    config,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
    fetchImpl: (_url, init) => {
      calls += 1;
      return calls === 1
        ? delayedResponse(50, 503, { error: "busy" }, init.signal)
        : Promise.resolve(jsonResponse(200, okBody));
    },
  });
  const retried = await retrying.generateText(input);
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [300]);
  assert.equal(retried.ok, true);
  assert.equal(retried.text, "answer");

  // Budget nearly spent after the 503: no second call.
  let tightCalls = 0;
  const tight = createAiGatewayClient({
    budgetMs: 60,
    config,
    fetchImpl: (_url, init) => {
      tightCalls += 1;
      return delayedResponse(50, 503, { error: "busy" }, init.signal);
    },
  });
  const spent = await tight.generateText(input);
  assert.equal(tightCalls, 1);
  assert.equal(spent.ok, false);
  assert.equal(spent.reason, "AI_HTTP_503");
});

test("401 is not retried and logs AI_HTTP_401", async (t) => {
  const spy = silenceConsoleError(t);
  let calls = 0;
  const client = createAiGatewayClient({
    config,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(401, { error: "unauthorized" });
    },
  });

  const result = await client.generateText(input);

  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.error, "AI_GENERATION_FAILED");
  assert.equal(result.reason, "AI_HTTP_401");
  assert.deepEqual(
    spy.mock.calls.map((call) => call.arguments),
    [["[ai] provider_failed", { reason: "AI_HTTP_401", status: 401 }]],
  );
});

test("the failure log carries only the reason and status", async (t) => {
  const spy = silenceConsoleError(t);
  const client = createAiGatewayClient({
    config,
    // A 500 with no budget for a retry keeps this to one attempt and one log line.
    budgetMs: 500,
    fetchImpl: async () => jsonResponse(500, { error: "PROMPT_SECRET_合成 echoed back" }),
  });

  const result = await client.generateText({ system: "system text", prompt: "PROMPT_SECRET_合成" });

  assert.equal(result.ok, false);
  assert.equal(spy.mock.callCount(), 1);
  assert.deepEqual(spy.mock.calls[0].arguments, [
    "[ai] provider_failed",
    { reason: "AI_HTTP_500", status: 500 },
  ]);
  const logged = JSON.stringify(spy.mock.calls.map((call) => call.arguments));
  for (const forbidden of ["PROMPT_SECRET", "test-key-not-real", "ai-gateway"]) {
    assert.ok(!logged.includes(forbidden), `log must not contain ${forbidden}`);
  }
});

test("a missing content field is AI_RESPONSE_INVALID", async (t) => {
  const spy = silenceConsoleError(t);
  let calls = 0;
  const client = createAiGatewayClient({
    config,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(200, { choices: [{ message: {} }] });
    },
  });

  const result = await client.generateText(input);

  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.error, "AI_GENERATION_FAILED");
  assert.equal(result.reason, "AI_RESPONSE_INVALID");
  assert.deepEqual(spy.mock.calls[0].arguments, [
    "[ai] provider_failed",
    { reason: "AI_RESPONSE_INVALID", status: 200 },
  ]);
});

test("generateJson returns the fallback with the reason when the provider fails", async (t) => {
  silenceConsoleError(t);
  const client = createAiGatewayClient({
    config,
    fetchImpl: async () => jsonResponse(403, { error: "forbidden" }),
  });

  const result = await client.generateJson({ ...input, fallback: { safe: true } });

  assert.equal(result.ok, false);
  assert.deepEqual(result.value, { safe: true });
  assert.equal(result.error, "AI_GENERATION_FAILED");
  assert.equal(result.reason, "AI_HTTP_403");
});
