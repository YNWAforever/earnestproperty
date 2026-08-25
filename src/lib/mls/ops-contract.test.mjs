import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const service = await readFile(
  new URL("../../../ops/systemd/earnest-mls-sync.service", import.meta.url),
  "utf8",
);
const timer = await readFile(
  new URL("../../../ops/systemd/earnest-mls-sync.timer", import.meta.url),
  "utf8",
);
const runbook = await readFile(
  new URL("../../../docs/mls-production-activation.md", import.meta.url),
  "utf8",
);
const baseConfig = await readFile(
  new URL("../../../workers/mls-container/wrangler.jsonc", import.meta.url),
  "utf8",
);
const scheduledConfig = await readFile(
  new URL(
    "../../../workers/mls-container/wrangler.scheduled.jsonc",
    import.meta.url,
  ),
  "utf8",
);
const cronReadme = await readFile(
  new URL("../../../workers/cron/README.md", import.meta.url),
  "utf8",
);
const cronConfig = await readFile(
  new URL("../../../workers/cron/wrangler.jsonc", import.meta.url),
  "utf8",
);
const cronWorker = await readFile(
  new URL("../../../workers/cron/src/index.ts", import.meta.url),
  "utf8",
);

test("VPS systemd units are inert and Cloudflare configs own the schedule", () => {
  assert.match(service, /RETIRED.*Cloudflare/i);
  assert.match(timer, /RETIRED.*Cloudflare/i);
  assert.doesNotMatch(service, /^ExecStart=.*scripts\/mls\/sync\.mjs/m);
  assert.doesNotMatch(timer, /^OnCalendar=/m);
  assert.match(baseConfig, /"workers_dev"\s*:\s*false/);
  assert.doesNotMatch(baseConfig, /"schedules"/);
  assert.match(scheduledConfig, /"schedules"\s*:\s*\[\s*"0 18 \* \* \*"\s*\]/);
  assert.doesNotMatch(
    baseConfig + scheduledConfig,
    /DATABASE_URL_UNPOOLED|BLOB_READ_WRITE_TOKEN|MLS_R2_SECRET_ACCESS_KEY/,
  );
});

test("retired VPS units contain no executable MLS command or credentials", () => {
  assert.doesNotMatch(
    service + "\n" + timer,
    /DATABASE_URL|BLOB_READ_WRITE_TOKEN|CRON_SECRET|postgres(?:ql)?:\/\//i,
  );
  assert.doesNotMatch(service + "\n" + timer, /^ExecStart=/m);
  assert.doesNotMatch(timer, /^OnCalendar=/m);
});

test("the existing cron worker snapshot remains MLS-free", () => {
  const snapshot = cronReadme + "\n" + cronConfig + "\n" + cronWorker;
  assert.doesNotMatch(snapshot, /MlsRunWorkflow|MlsRunContainer|MLS_RUN_/);
});

test("runbook records gated migration, shadow, cutover, monitoring, and rollback", () => {
  for (const phrase of [
    "20260817120000_dual_source_listing_sync.sql",
    "seven daily shadow",
    "seven monitored live runs",
    "MLS_PUBLISH_ENABLED",
    "publisher",
    "Rollback",
  ]) {
    assert.ok(runbook.toLowerCase().includes(phrase.toLowerCase()), phrase);
  }
  assert.match(runbook, /systemd-analyze calendar/);
  assert.match(runbook, /npm run mls:shadow/);
  assert.match(runbook, /npm run mls:legacy-sync/);
  assert.doesNotMatch(runbook, /DATABASE_URL_UNPOOLED\s*=\s*postgres/i);
  assert.doesNotMatch(runbook, /BLOB_READ_WRITE_TOKEN\s*=\s*\S+/i);
});

test("Cloudflare runbook exposes the gated operator contract", () => {
  for (const marker of [
    "Workers Paid",
    "wrangler.jsonc",
    "wrangler.scheduled.jsonc",
    "0 18 * * *",
    "MLS_SCHEDULED_MODE=shadow",
    "MLS_PUBLISH_ENABLED=false",
    "MLS_MEDIA_RIGHTS_CONFIRMED=false",
    "90-day bucket lock",
    "manual first publish",
    "seven approved healthy Hong Kong dates",
    "publication_outcome_unknown",
    "publisher: cloudflare-container",
    "No provider command in this runbook is authorized by code approval",
  ]) {
    assert.match(
      runbook,
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
      marker,
    );
  }
  assert.doesNotMatch(runbook, /systemctl enable|systemctl start|place.*VPS/i);
});
