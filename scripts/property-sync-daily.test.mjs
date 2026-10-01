import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const path = new URL("../.github/workflows/property-sync-daily.yml", import.meta.url);
test("daily property workflow remains gated, serialized, immutable and narrowly scoped", () => {
  const y = readFileSync(path, "utf8");
  for (const value of [
    "workflow_dispatch:",
    "cancel-in-progress: false",
    "PROPERTY_SYNC_DAILY_ENABLED",
    "PROPERTY_SYNC_POLICY_APPROVED",
    "= python-v2.2",
    "PROPERTY_SYNC_EXPECTED_BRANCH",
    'python-version: "3.14"',
    'node-version: "24"',
    "--dry-run",
    "replay_28hse_sync.py",
    "retention-days: 7",
    "retention-days: 90",
    "if: always()",
    "--apply",
    "agent:540",
  ])
    assert.ok(y.includes(value), value);
  assert.match(y, /^\s+schedule:/m);
  assert.equal((y.match(/secrets\.DATABASE_URL_UNPOOLED/g) || []).length, 2);
  assert.ok(!/npm run build|playwright|wrangler|migrate|send-message/.test(y));
  assert.ok(
    y.indexOf("Collect without database access") < y.indexOf("secrets.DATABASE_URL_UNPOOLED"),
  );
});

test("database credential exists only on the gated apply step", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const workflow = require("js-yaml").load(readFileSync(path, "utf8"));
  assert.equal(workflow.concurrency.group, "property-sync-agent-540");
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.match(workflow.jobs.daily.if, /PROPERTY_SYNC_DAILY_ENABLED == 'true'/);
  const steps = workflow.jobs.daily.steps;
  const apply = steps.filter((step) => step.env?.DATABASE_URL_UNPOOLED);
  assert.equal(apply.length, 2);
  assert.ok(apply.every((step) => step.if === "endsWith(env.MODE, 'apply')"));
  assert.ok(
    steps.findIndex((step) => step.name === "Pin accepted full baseline") <
      steps.findIndex((step) => step.name === "Publish verified imported drafts"),
  );
  assert.ok(
    apply[0].run.indexOf("verify-daily-target.mjs") < apply[0].run.indexOf("replay_28hse_sync.py"),
  );
  assert.ok(apply[0].env.PROPERTY_SYNC_EXPECTED_DATABASE_HOST);
  assert.equal(apply[0].if, "endsWith(env.MODE, 'apply')");
  assert.match(
    apply[0].run,
    /replay_28hse_sync\.py --payload "\$PAYLOAD" --root daily-output --apply/,
  );
  const pinIndex = steps.findIndex(
    (step) => step.name === "Pin immutable request before database access",
  );
  assert.ok(pinIndex < steps.indexOf(apply[0]));
  assert.ok(!workflow.env?.DATABASE_URL_UNPOOLED);
  assert.ok(!workflow.jobs.daily.env.DATABASE_URL_UNPOOLED);
  assert.equal(
    steps.find((step) => step.name === "Pin unresolved evidence independently of artifact expiry")
      .if,
    "failure() && steps.evidence-gate.outcome == 'success'",
  );
  assert.match(
    steps.find((step) => step.name === "Restore last accepted full baseline").run,
    /daily_artifacts.py unpack/,
  );
});

test("accepted asset names derive from immutable snapshot chronology", () => {
  const y = readFileSync(path, "utf8");
  assert.match(
    y,
    /daily_artifacts\.py name --request "\$PAYLOAD" --run-id "\$GITHUB_RUN_ID" --attempt "\$GITHUB_RUN_ATTEMPT"/,
  );
  assert.match(y, /tar -czf "\$asset" baseline/);
  assert.ok(!y.includes('tar -czf "accepted-$GITHUB_RUN_ID'));
});

test("daily collection has one gated HK morning schedule and private durable evidence", async () => {
  const { createRequire } = await import("node:module");
  const workflow = createRequire(import.meta.url)("js-yaml").load(readFileSync(path, "utf8"));
  assert.deepEqual(workflow.on.schedule, [{ cron: "17 20 * * *" }]);
  const job = workflow.jobs.daily;
  assert.match(job.env.GH_REPO, /PROPERTY_SYNC_EVIDENCE_REPO/);
  assert.match(job.env.GH_TOKEN, /PROPERTY_SYNC_EVIDENCE_TOKEN/);
  const steps = job.steps;
  const gate = steps.find(
    (s) => s.name === "Validate operator gates and private evidence destination",
  );
  assert.match(gate.run, /repos\/\$GH_REPO.*\.private/);
  const pin = steps.find((s) => s.name === "Pin evidence independently of Actions artifact quota");
  assert.equal(pin.if, "always() && steps.evidence-gate.outcome == 'success'");
  assert.match(pin.run, /gh release upload property-sync-evidence/);
  for (const step of steps.filter((s) => s.uses === "actions/upload-artifact@v4")) {
    assert.match(step.if, /github.event.repository.private == true/);
    assert.equal(step["continue-on-error"], true);
  }
});
