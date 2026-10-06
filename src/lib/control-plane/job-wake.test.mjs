import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createJobWake, signalJobWake } from "./job-wake.js";

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
test("job drains have one 10-minute Cloudflare sweep and no Vercel schedule", () => {
  const source = readFileSync("workers/cron/wrangler.jsonc", "utf8");
  const config = JSON.parse(source.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));
  const vercel = readFileSync("vercel.ts", "utf8");
  const worker = readFileSync("workers/cron/src/index.ts", "utf8");
  // Owner decision 4: every 10 min 08:00-21:50 HKT, hourly overnight (UTC cron strings).
  assert.deepEqual(config.triggers.crons, ["*/10 0-13 * * *", "0 14-23 * * *"]);
  assert.equal(config.vars.SITE_ORIGIN, "https://www.earnestproperty.com");
  assert.match(worker, /async scheduled\(/);
  assert.match(worker, /sweepLanes\(/);
  assert.match(worker, /createLaneDrain\(/);
  assert.match(worker, /getByName\(lane\)\.signal\(\)/);
  assert.match(worker, /authorization.*Bearer/);
  // The cron sweeps; it must never signal(), which would reset the failure backoff every tick.
  assert.doesNotMatch(worker.slice(worker.indexOf("async scheduled(")), /\.signal\(\)/);
  assert.match(vercel, /crons:\s*\[\s*\]/);
  assert.doesNotMatch(vercel, /path:\s*"\/api\/admin\/(control-plane\/worker|jobs\/send-queue)"/);
});

test("maintenance stays event driven while property refresh has one gated daily schedule", () => {
  const vercel = readFileSync("vercel.ts", "utf8");
  const migration = readFileSync(".github/workflows/migration-drift.yml", "utf8");
  const properties = readFileSync(".github/workflows/property-sync-daily.yml", "utf8");
  assert.match(vercel, /crons:\s*\[\s*\]/);
  assert.doesNotMatch(migration, /^\s+schedule:/m);
  assert.match(properties, /^\s+schedule:/m);
  assert.match(properties, /cron: "17 20 \* \* \*"/);
  assert.match(properties, /vars\.PROPERTY_SYNC_DAILY_ENABLED == 'true'/);
  assert.match(migration, /workflow_dispatch:/);
  assert.match(migration, /neon\/migrations\/\*\*/);
  assert.match(properties, /workflow_dispatch:/);
});

test("stalled scheduler requests time out so the caller can fall back", async () => {
  await assert.rejects(
    signalJobWake({
      url: "https://scheduler.example",
      secret: "test-secret",
      lane: "service",
      timeoutMs: 20,
      fetcher: async (_url, options) => {
        assert.ok(options.signal instanceof AbortSignal);
        await new Promise((_, reject) => {
          options.signal.addEventListener("abort", () => reject(options.signal.reason), {
            once: true,
          });
        });
      },
    }),
    { name: "TimeoutError" },
  );
});
