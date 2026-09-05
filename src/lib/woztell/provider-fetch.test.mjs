import assert from "node:assert/strict";
import test from "node:test";
import { boundedProviderFetch } from "./provider-fetch.ts";
test("fetch timeout even when provider ignores abort", async () => {
  await assert.rejects(
    boundedProviderFetch(
      "https://fake",
      {},
      { timeoutMs: 10, fetchImpl: () => new Promise(() => {}) },
    ),
    /TIMEOUT/,
  );
});
test("body deadline and streamed size limits", async () => {
  await assert.rejects(
    boundedProviderFetch(
      "https://fake",
      {},
      { timeoutMs: 10, fetchImpl: async () => new Response(new ReadableStream({ start() {} })) },
    ),
    /TIMEOUT/,
  );
  await assert.rejects(
    boundedProviderFetch(
      "https://fake",
      {},
      { maxBytes: 3, fetchImpl: async () => new Response("large") },
    ),
    /TOO_LARGE/,
  );
});
