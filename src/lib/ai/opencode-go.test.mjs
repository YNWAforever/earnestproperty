import assert from "node:assert/strict";
import test from "node:test";
import { createOpenCodeGoClient } from "./opencode-go.server.ts";

const enabledConfig = {
  baseUrl: "https://go.example/v1",
  apiKey: "secret",
  model: "go-content",
  enabled: true,
};

test("OpenCode client posts to normalized chat completions endpoint", async () => {
  const requests = [];
  const client = createOpenCodeGoClient({
    config: { ...enabledConfig, baseUrl: "https://go.example/v1/" },
    sleepImpl: async () => undefined,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"patches":[{"claimType":"subjective"}]}' } }],
          usage: { total_tokens: 9 },
        }),
        { status: 200 },
      );
    },
  });

  const result = await client.generateProposal({ system: "rules", prompt: "record" });

  assert.equal(requests[0].url, "https://go.example/v1/chat/completions");
  assert.equal(requests[0].init.headers.authorization, "Bearer secret");
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    model: "go-content",
    messages: [
      { role: "system", content: "rules" },
      { role: "user", content: "record" },
    ],
    temperature: 0.1,
    stream: false,
    response_format: { type: "json_object" },
  });
  assert.deepEqual(result.value, { patches: [{ claimType: "subjective" }] });
  assert.deepEqual(result.usageMetadata, { total_tokens: 9 });
});

test("OpenCode client retries 429 twice", async () => {
  let attempts = 0;
  const delays = [];
  const client = createOpenCodeGoClient({
    config: enabledConfig,
    sleepImpl: async (ms) => {
      delays.push(ms);
    },
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) return new Response("", { status: 429 });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"patches":[]}' } }] }),
        { status: 200 },
      );
    },
  });

  const result = await client.generateProposal({ system: "rules", prompt: "record" });

  assert.equal(result.ok, true);
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [300, 600]);
});

test("OpenCode cancels retryable response bodies", async () => {
  let cancelled = 0;
  let attempts = 0;
  const client = createOpenCodeGoClient({
    config: enabledConfig,
    sleepImpl: async () => undefined,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("provider detail"));
          },
          cancel() {
            cancelled += 1;
          },
        });
        return new Response(body, { status: 503 });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"patches":[]}' } }] }),
        { status: 200 },
      );
    },
  });

  const result = await client.generateProposal({ system: "rules", prompt: "record" });

  assert.equal(result.ok, true);
  assert.equal(attempts, 3);
  assert.equal(cancelled, 2);
});
test("OpenCode client retries network failures twice", async () => {
  let attempts = 0;
  const client = createOpenCodeGoClient({
    config: enabledConfig,
    sleepImpl: async () => undefined,
    fetchImpl: async () => {
      attempts += 1;
      throw new Error("provider network detail");
    },
  });

  const result = await client.generateProposal({ system: "rules", prompt: "record" });

  assert.equal(result.ok, false);
  assert.equal(result.error, "OPENCODE_GO_GENERATION_FAILED");
  assert.equal(attempts, 3);
});

test("OpenCode client retries 5xx twice", async () => {
  let attempts = 0;
  const client = createOpenCodeGoClient({
    config: enabledConfig,
    sleepImpl: async () => undefined,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) return new Response("provider detail", { status: 503 });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"patches":[]}' } }] }),
        { status: 200 },
      );
    },
  });

  const result = await client.generateProposal({ system: "rules", prompt: "record" });

  assert.equal(result.ok, true);
  assert.equal(attempts, 3);
});
test("disabled configuration returns OPENCODE_GO_NOT_CONFIGURED without fetch", async () => {
  let called = false;
  const client = createOpenCodeGoClient({
    config: { baseUrl: null, apiKey: null, model: null, enabled: false },
    sleepImpl: async () => undefined,
    fetchImpl: async () => {
      called = true;
      throw new Error("must not run");
    },
  });

  const result = await client.generateProposal({ system: "rules", prompt: "record" });

  assert.deepEqual(result, {
    ok: false,
    value: null,
    model: null,
    latencyMs: 0,
    usageMetadata: {},
    error: "OPENCODE_GO_NOT_CONFIGURED",
  });
  assert.equal(called, false);
});

test("OpenCode client keeps malformed provider responses behind a stable error", async () => {
  const client = createOpenCodeGoClient({
    config: enabledConfig,
    sleepImpl: async () => undefined,
    fetchImpl: async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), {
        status: 200,
      }),
  });

  const result = await client.generateProposal({ system: "rules", prompt: "record" });

  assert.deepEqual(result.usageMetadata, {});
  assert.equal(result.value, null);
  assert.equal(result.error, "OPENCODE_GO_RESPONSE_INVALID");
});
