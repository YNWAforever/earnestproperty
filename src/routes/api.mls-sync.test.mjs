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

test("Cloudflare wakes the appropriate job lane only after a signal or due alarm", () => {
  const worker = readFileSync(new URL("../../workers/cron/src/index.ts", import.meta.url), "utf8");
  const config = readFileSync(
    new URL("../../workers/cron/wrangler.jsonc", import.meta.url),
    "utf8",
  );

  assert.match(worker, /\/api\/admin\/control-plane\/worker/);
  assert.match(worker, /\/api\/admin\/whatsapp\/service-worker/);
  assert.match(worker, /\/wake\/general/);
  assert.match(worker, /\/wake\/service/);
  assert.match(worker, /Bearer \$\{this\.env\.CRON_SECRET\}/);
  assert.doesNotMatch(worker, /\/api\/admin\/jobs\/send-queue/);
  assert.match(config, /"crons"\s*:\s*\[\s*\]/);
});
