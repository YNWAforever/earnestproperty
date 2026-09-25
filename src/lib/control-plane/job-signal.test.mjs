import assert from "node:assert/strict";
import test from "node:test";

import { signalJobWake } from "./job-wake.js";

test("post-commit signal targets one lane with server-only authorization", async () => {
  const calls = [];
  await signalJobWake({
    url: "https://scheduler.example/",
    secret: "synthetic",
    lane: "service",
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return new Response(null, { status: 202 });
    },
  });
  assert.deepEqual(
    calls.map((call) => new URL(call.url).pathname),
    ["/wake/service"],
  );
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.authorization, "Bearer synthetic");
});

test("a failed signal rejects so the caller can run the local fallback", async () => {
  await assert.rejects(
    signalJobWake({
      url: "https://scheduler.example/",
      secret: "synthetic",
      lane: "general",
      fetcher: async () => new Response(null, { status: 503 }),
    }),
    /JOB_WAKE_SIGNAL_FAILED/,
  );
});
