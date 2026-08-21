import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
  new URL("./api.mls-sync.ts", import.meta.url),
  "utf8",
);
const vercel = readFileSync(
  new URL("../../vercel.ts", import.meta.url),
  "utf8",
);

test("mls route is protected and read-only", () => {
  assert.match(source, /createFileRoute\(["']\/api\/mls-sync["']\)/);
  assert.match(source, /authorization/i);
  assert.match(source, /CRON_SECRET/);
  assert.match(source, /status:\s*401/);
  assert.match(source, /DATABASE_URL/);
  assert.match(source, /status:\s*503/);
  assert.match(source, /getLatestSyncRun/);
  assert.doesNotMatch(source, /createMlsImporter|\.sync\s*\(/);
});

test("protected status identifies the Cloudflare Container publisher", () => {
  assert.match(source, /publisher:\s*["']cloudflare-container["']/);
  assert.doesNotMatch(source, /publisher:\s*["']vps["']/);
  assert.doesNotMatch(source, /\bPOST\b|\bPUT\b|\bDELETE\b/);
});

test("Vercel no longer schedules MLS but retains control-plane safety crons", () => {
  assert.match(vercel, /crons/);
  assert.doesNotMatch(vercel, /\/api\/mls-sync/);
  assert.match(vercel, /\/api\/admin\/control-plane\/worker/);
  assert.match(vercel, /\/api\/admin\/jobs\/send-queue/);
});

// Vercel Hobby rejects any cron that would run more than once a day, and it fails
// the *deploy*, not the request — so a schedule like "*/5 * * * *" bricks the whole
// release. The sub-daily cadence the job queue needs lives in a Cloudflare Worker
// (workers/cron/); vercel.ts only ever carries the once-a-day floor.
test("every vercel.ts cron runs at most once a day", () => {
  const schedules = [...vercel.matchAll(/schedule:\s*"([^"]+)"/g)].map(
    ([, value]) => value,
  );
  assert.ok(schedules.length > 0, "vercel.ts should still declare crons");

  for (const schedule of schedules) {
    const [minute, hour] = schedule.split(/\s+/);
    for (const [field, name] of [
      [minute, "minute"],
      [hour, "hour"],
    ]) {
      assert.doesNotMatch(
        field,
        /[*/,-]/,
        `cron "${schedule}" has a non-literal ${name} field, so it runs more than once a day — Hobby will reject the deploy`,
      );
    }
  }
});

test("the sub-daily job drain is scheduled from the cloudflare worker", () => {
  const worker = readFileSync(
    new URL("../../workers/cron/src/index.ts", import.meta.url),
    "utf8",
  );
  const config = readFileSync(
    new URL("../../workers/cron/wrangler.jsonc", import.meta.url),
    "utf8",
  );

  // The endpoints Vercel can no longer poll frequently must be reachable from
  // somewhere that can, or queued jobs sit until the daily floor.
  for (const path of [
    "/api/admin/control-plane/worker",
    "/api/admin/jobs/send-queue",
  ]) {
    assert.ok(
      worker.includes(path),
      `${path} must be driven by the cron worker`,
    );
  }
  assert.match(worker, /Bearer \$\{secret\}/);

  // Cloudflare passes the cron expression back verbatim, so an expression present
  // in wrangler.jsonc but absent from the SCHEDULE map fires and does nothing.
  const configured = [...config.matchAll(/"(\*\/\d+ [^"]+)"/g)].map(
    ([, value]) => value,
  );
  assert.ok(
    configured.length > 0,
    "wrangler.jsonc should declare cron triggers",
  );
  for (const expression of configured) {
    assert.ok(
      worker.includes(`"${expression}"`),
      `cron "${expression}" is triggered but not mapped to an endpoint in SCHEDULE`,
    );
  }
});
