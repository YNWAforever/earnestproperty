import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "./client.mjs";
const request = {
  model: "jev-latest",
  state: {},
  questions: { a: { type: "noul", instructions: "test" } },
};
const good = () => ({
  model: "jev-1.13.0",
  answers: { a: { type: "noul", noul: 0 } },
  usage: { input_tokens: 10, output_tokens: 2 },
});
const options = { mode: "live", apiKey: "test-key" };
test("disabled and missing key never call transport", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
  };
  assert.equal((await evaluate(request, { fetchImpl, apiKey: "present" })).reason, "disabled");
  assert.equal((await evaluate(request, { mode: "live", fetchImpl })).reason, "missing_key");
  assert.equal(calls, 0);
});
for (const probability of [0, 1])
  test(`accept probability ${probability} and strip metadata`, async () => {
    const body = good();
    body.answers.a.noul = probability;
    body.secret = "private";
    const r = await evaluate(request, {
      ...options,
      fetchImpl: async (url, init) => {
        assert.equal(url, "https://api.typesafe.ai/v1/systemone");
        assert.equal(init.redirect, "error");
        assert.equal(init.headers.Authorization, "Bearer test-key");
        return new Response(JSON.stringify(body));
      },
    });
    assert.equal(r.status, "ok");
    assert.equal(r.observations.a, probability);
    assert.equal("secret" in r, false);
  });
for (const [name, mutate] of Object.entries({
  missing: (b) => delete b.answers.a,
  type: (b) => (b.answers.a.type = "score"),
  range: (b) => (b.answers.a.noul = 2),
  string: (b) => (b.answers.a.noul = "0"),
  usage: (b) => (b.usage.input_tokens = -1),
  model: (b) => (b.model = ""),
  null: (b) => (b.answers = null),
}))
  test(`invalid response ${name}`, async () => {
    const b = good();
    mutate(b);
    assert.equal(
      (
        await evaluate(request, {
          ...options,
          fetchImpl: async () => new Response(JSON.stringify(b)),
        })
      ).reason,
      "invalid_response",
    );
  });
test("invalid JSON", async () =>
  assert.equal(
    (
      await evaluate(request, {
        ...options,
        fetchImpl: async () => new Response("private-not-json"),
      })
    ).reason,
    "invalid_response",
  ));
for (const [status, reason] of [
  [401, "unauthorized"],
  [403, "unauthorized"],
  [429, "rate_limited"],
  [500, "provider_error"],
])
  test(`HTTP ${status} no retry or body leak`, async () => {
    let calls = 0;
    const r = await evaluate(request, {
      ...options,
      fetchImpl: async () => {
        calls++;
        return new Response("secret", { status });
      },
    });
    assert.equal(r.reason, reason);
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(r).includes("secret"));
  });
test("network error is sanitized", async () =>
  assert.equal(
    (
      await evaluate(request, {
        ...options,
        fetchImpl: async () => {
          throw Error("secret");
        },
      })
    ).reason,
    "network_error",
  ));
for (const stage of ["headers", "body"])
  test(`timeout covers ${stage} and aborts`, async () => {
    let signal;
    const r = await evaluate(request, {
      ...options,
      timeoutMs: 10,
      fetchImpl: async (_, init) => {
        signal = init.signal;
        if (stage === "headers") return new Promise(() => {});
        return { ok: true, json: () => new Promise(() => {}) };
      },
    });
    assert.equal(r.reason, "timeout");
    assert.equal(signal.aborted, true);
  });
