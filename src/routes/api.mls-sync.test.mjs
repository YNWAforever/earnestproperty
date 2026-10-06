import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { latestRunPublisher } from "../lib/mls/status-publisher.mjs";

const source = readFileSync(new URL("./api.mls-sync.ts", import.meta.url), "utf8");
const vercel = readFileSync(new URL("../../vercel.ts", import.meta.url), "utf8");

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

test("protected status identifies the actual run publisher with legacy compatibility", () => {
  assert.match(source, /publisher: latestRunPublisher\(latestRun\)/);
  assert.equal(latestRunPublisher(null), "cloudflare-container");
  assert.equal(
    latestRunPublisher({ sourceStatus: { old_site: { status: "healthy" } } }),
    "cloudflare-container",
  );
  assert.equal(
    latestRunPublisher({
      sourceStatus: {
        propertyhk: { policy_version: "no-hermes-v2", publisher: "python-snapshot-v2" },
      },
    }),
    "python-snapshot-v2",
  );
  assert.doesNotMatch(source, /publisher:\s*["']vps["']/);
  assert.doesNotMatch(source, /\bPOST\b|\bPUT\b|\bDELETE\b/);
});

test("Vercel has no idle database schedules", () => {
  assert.match(vercel, /crons:\s*\[\s*\]/);
  assert.doesNotMatch(vercel, /\/api\/mls-sync/);
  assert.doesNotMatch(vercel, /schedule:\s*"/);
});

test("Cloudflare wakes the appropriate job lane after a signal, a due alarm or the job sweep", () => {
  const worker = readFileSync(new URL("../../workers/cron/src/index.ts", import.meta.url), "utf8");
  const alarm = readFileSync(
    new URL("../../workers/cron/src/job-alarm.js", import.meta.url),
    "utf8",
  );
  const config = readFileSync(
    new URL("../../workers/cron/wrangler.jsonc", import.meta.url),
    "utf8",
  );

  assert.match(alarm, /\/api\/admin\/control-plane\/worker/);
  assert.match(alarm, /\/api\/admin\/whatsapp\/service-worker/);
  assert.match(worker, /\/wake\/general/);
  assert.match(worker, /\/wake\/service/);
  assert.match(worker, /secret: this\.env\.CRON_SECRET/);
  assert.match(alarm, /Bearer \$\{secret\}/);
  assert.doesNotMatch(worker + alarm, /\/api\/admin\/jobs\/send-queue/);
  const { crons } = JSON.parse(
    config.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"),
  ).triggers;
  assert.deepEqual(crons, ["*/10 0-13 * * *", "0 14-23 * * *"]);
});
