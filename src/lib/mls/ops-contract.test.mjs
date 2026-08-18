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

test("VPS timer and service are non-secret and least-privilege", () => {
  assert.match(timer, /OnCalendar=\*-\*-\* 02:00:00 Asia\/Hong_Kong/);
  assert.match(timer, /Persistent=true/);
  assert.match(timer, /Unit=earnest-mls-sync\.service/);
  assert.match(service, /User=earnest-mls/);
  assert.match(service, /Group=earnest-mls/);
  assert.match(service, /WorkingDirectory=\/opt\/earnestproperty\/current/);
  assert.match(service, /EnvironmentFile=\/etc\/earnestproperty\/mls-sync\.env/);
  assert.match(service, /ExecStart=.*npm run mls:sync/);
  assert.match(service, /ReadWritePaths=\/var\/lib\/earnestproperty\/mls-sync/);
  assert.doesNotMatch(
    service + "\n" + timer,
    /DATABASE_URL|BLOB_READ_WRITE_TOKEN|CRON_SECRET|postgres(?:ql)?:\/\//i,
  );
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
