import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createJobWake } from "./job-wake.js";

test("disabled wake does not schedule or run any work", async () => {
  const pending = [],
    calls = [];
  createJobWake({
    enabled: false,
    waitUntil: (p) => pending.push(p),
    run: (lane) => calls.push(lane),
  })("service");
  assert.equal(pending.length, 0);
  assert.equal(calls.length, 0);
});
test("wake registers bounded work without waiting for completion", async () => {
  const pending = [],
    calls = [];
  let release;
  const blocked = new Promise((r) => (release = r));
  const wake = createJobWake({
    enabled: true,
    waitUntil: (p) => pending.push(p),
    run: async (lane) => {
      calls.push(lane);
      await blocked;
    },
  });
  assert.equal(wake("service"), undefined);
  assert.equal(pending.length, 1);
  await Promise.resolve();
  assert.deepEqual(calls, ["service"]);
  release();
  await Promise.all(pending);
});
test("worker failure is observable without rejecting the committed request or retry looping", async () => {
  const pending = [],
    errors = [];
  let calls = 0;
  createJobWake({
    enabled: true,
    waitUntil: (p) => pending.push(p),
    run: async () => {
      calls++;
      throw new Error("sensitive provider payload");
    },
    report: (code) => errors.push(code),
  })("general");
  await Promise.all(pending);
  assert.equal(calls, 1);
  assert.deepEqual(errors, ["JOB_WAKE_FAILED"]);
});
test("lifetime registration failure never masks a committed mutation", async () => {
  const errors = [];
  const wake = createJobWake({
    enabled: true,
    waitUntil: () => {
      throw new Error("unavailable");
    },
    run: async () => {},
    report: (code) => errors.push(code),
  });
  assert.doesNotThrow(() => wake("service"));
  await Promise.resolve();
  assert.deepEqual(errors, ["JOB_WAKE_REGISTRATION_FAILED"]);
});
test("one low-frequency sweep covers all job lanes", () => {
  const config = readFileSync("workers/cron/wrangler.jsonc", "utf8");
  assert.match(config, /"crons": \["\*\/15 \* \* \* \*"\]/);
  const source = readFileSync("workers/cron/src/index.ts", "utf8");
  for (const path of [
    "/api/admin/whatsapp/service-worker",
    "/api/admin/control-plane/worker",
    "/api/admin/jobs/send-queue",
  ])
    assert.ok(source.includes(path));
});

test("recovery sweep attempts every lane even when one endpoint fails", async () => {
  const { default: worker } = await import("../../../workers/cron/src/index.ts");
  const original = globalThis.fetch,
    calls = [],
    pending = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (String(url).endsWith("service-worker")) throw new Error("synthetic failure");
    return new Response('{"claimed":0}');
  };
  try {
    await worker.scheduled(
      { cron: "*/15 * * * *" },
      { SITE_ORIGIN: "https://example.invalid", CRON_SECRET: "synthetic" },
      { waitUntil: (p) => pending.push(p) },
    );
    await Promise.all(pending);
    assert.equal(calls.length, 3);
    for (const { options } of calls) {
      assert.equal(options.method, "POST");
      assert.equal(options.headers.authorization, "Bearer synthetic");
    }
  } finally {
    globalThis.fetch = original;
  }
});
test("missing cron secret or unknown trigger never connects to the app", async () => {
  const { default: worker } = await import("../../../workers/cron/src/index.ts");
  let scheduled = 0;
  await worker.scheduled(
    { cron: "*/15 * * * *" },
    { SITE_ORIGIN: "https://example.invalid" },
    { waitUntil: () => scheduled++ },
  );
  await worker.scheduled(
    { cron: "* * * * *" },
    { SITE_ORIGIN: "https://example.invalid", CRON_SECRET: "synthetic" },
    { waitUntil: () => scheduled++ },
  );
  assert.equal(scheduled, 0);
});
