import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJobWake, signalJobWake, wakeEnabledFromEnv } from "./job-wake.js";

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
test("job drains have one business-hours Cloudflare sweep and no Vercel schedule", () => {
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

const FLAG = ["OPS_EVENT", "WAKE", "ENABLED"].join("_");

function scan(path, hits) {
  if (!existsSync(path)) return;
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const name of readdirSync(path)) {
      if (name === "node_modules" || name === ".wrangler" || name === "dist") continue;
      scan(join(path, name), hits);
    }
  } else if (readFileSync(path, "utf8").includes(FLAG)) {
    hits.push(path);
  }
}

test("wakes when OPS_WAKE_URL set without flag", () => {
  assert.equal(wakeEnabledFromEnv({ OPS_WAKE_URL: "https://alarm.example" }), true);
  assert.equal(wakeEnabledFromEnv({ [FLAG]: "true" }), false);
  assert.equal(wakeEnabledFromEnv({ OPS_WAKE_URL: "  ", [FLAG]: "true" }), false);
  assert.equal(wakeEnabledFromEnv({}), false);
  assert.match(
    readFileSync(new URL("./job-wake.server.ts", import.meta.url), "utf8"),
    /enabled:\s*wakeEnabledFromEnv\(process\.env\)/,
  );
});

test("the wake flag is gone from code, scripts and env docs", () => {
  const hits = [];
  const root = new URL("../../../", import.meta.url);
  for (const name of ["src", "scripts", "workers", ".env.example", "CLAUDE.md", "README.md"]) {
    const path = fileURLToPath(new URL(name, root));
    assert.ok(existsSync(path), `${name} must exist so the scan cannot pass vacuously`);
    scan(path, hits);
  }
  assert.deepEqual(hits, []);
});

test("test harnesses blank OPS_WAKE_URL so no test can signal a real worker", () => {
  for (const [file, pattern] of [
    ["scripts/no-link-local-postgres.test.mjs", /OPS_WAKE_URL:\s*""/],
    ["scripts/test-public-synthetic-browser.mjs", /OPS_WAKE_URL:\s*""/],
    ["scripts/no-link-safe-checks.mjs", /safeEnv\.OPS_WAKE_URL\s*=\s*""/],
  ]) {
    assert.match(readFileSync(file, "utf8"), pattern, file);
  }
  const assignment = readFileSync("src/lib/whatsapp-enquiries/assignment.test.mjs", "utf8");
  assert.match(assignment, /process\.env\.OPS_WAKE_URL\s*=\s*""/);
  assert.match(assignment, /finally\s*\{[\s\S]*OPS_WAKE_URL/);
});

test("a test run never enables the wake, even with OPS_WAKE_URL set", () => {
  const url = "https://alarm.example";
  assert.equal(wakeEnabledFromEnv({ OPS_WAKE_URL: url, NODE_TEST_CONTEXT: "child" }), false);
  assert.equal(wakeEnabledFromEnv({ OPS_WAKE_URL: url, NODE_ENV: "test" }), false);
  assert.equal(wakeEnabledFromEnv({ OPS_WAKE_URL: url, NODE_ENV: "production" }), true);
  // The real node --test process: the check the server uses must be false.
  assert.ok(process.env.NODE_TEST_CONTEXT, "node --test sets NODE_TEST_CONTEXT");
  const previous = process.env.OPS_WAKE_URL;
  process.env.OPS_WAKE_URL = url;
  try {
    assert.equal(wakeEnabledFromEnv(process.env), false);
  } finally {
    if (previous === undefined) delete process.env.OPS_WAKE_URL;
    else process.env.OPS_WAKE_URL = previous;
  }
});

test("job-wake.server.ts trims OPS_WAKE_URL before use", () => {
  const source = readFileSync(new URL("./job-wake.server.ts", import.meta.url), "utf8");
  assert.match(source, /process\.env\.OPS_WAKE_URL\?\.trim\(\)/);
});
