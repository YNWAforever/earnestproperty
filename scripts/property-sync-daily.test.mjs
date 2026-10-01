import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const path = new URL("../.github/workflows/property-sync-daily.yml", import.meta.url);
async function workflow() {
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)("js-yaml").load(readFileSync(path, "utf8"));
}
test("daily property workflow retains gated scheduling, privacy, branch and policy checks", async () => {
  const w = await workflow();
  assert.deepEqual(w.on.schedule, [{ cron: "17 20 * * *" }]);
  assert.equal(w.concurrency.group, "property-sync-agent-540");
  assert.equal(w.concurrency["cancel-in-progress"], false);
  assert.match(w.jobs.preflight.if, /PROPERTY_SYNC_DAILY_ENABLED/);
  assert.match(w.env.GH_REPO, /PROPERTY_SYNC_EVIDENCE_REPO/);
  assert.match(w.env.GH_TOKEN, /PROPERTY_SYNC_EVIDENCE_TOKEN/);
  const gate = w.jobs.preflight.steps.find((s) => s.id === "evidence-gate");
  assert.match(gate.run, /daily_artifacts.py private/);
  assert.match(gate.run, /--ref "\$GITHUB_REF" --branch "\$EXPECTED_BRANCH"/);
  assert.match(gate.run, /= python-v2.2/);
  const text = JSON.stringify(w);
  assert.ok(!/npm run build|playwright|wrangler|migrate|send-message/.test(text));
  for (const job of Object.values(w.jobs))
    for (const step of job.steps.filter((s) => s.uses === "actions/upload-artifact@v4")) {
      assert.match(step.if, /github.event.repository.private == true/);
      assert.equal(step["continue-on-error"], true);
    }
});
test("DB and media credentials are restricted to the intended stages and guarded apply steps", async () => {
  const w = await workflow();
  assert.ok(!w.env.DATABASE_URL_UNPOOLED);
  assert.ok(!w.env.BLOB_READ_WRITE_TOKEN);
  const dbSteps = [];
  for (const [name, job] of Object.entries(w.jobs)) {
    assert.ok(!job.env?.DATABASE_URL_UNPOOLED);
    for (const step of job.steps) {
      if (step.env?.DATABASE_URL_UNPOOLED) dbSteps.push({ name, step });
      if (step.env?.BLOB_READ_WRITE_TOKEN) assert.equal(name, "publish");
    }
  }
  assert.deepEqual(
    dbSteps.map((s) => s.name),
    ["preflight", "ingest", "publish", "record"],
  );
  assert.match(dbSteps[0].step.run, /read-sync-authority/);
  assert.ok(!/--apply/.test(dbSteps[0].step.run));
  assert.equal(dbSteps[1].step.if, "endsWith(env.MODE, 'apply')");
  assert.ok(
    dbSteps[1].step.run.indexOf("verify-daily-target.mjs") <
      dbSteps[1].step.run.indexOf("replay_28hse_sync.py"),
  );
  assert.match(w.jobs.publish.if, /needs.collect.result == 'success'/);
  assert.match(w.jobs.publish.if, /publication-only/);
  assert.match(w.jobs.record.if, /PROPERTY_SYNC_OBSERVABILITY_ENABLED/);
  assert.match(dbSteps[3].step.run, /record-sync-execution/);
  assert.ok(
    !/crawl|run_28hse_sync|publish-daily-listings|apply-source-snapshot/.test(dbSteps[3].step.run),
  );
  assert.ok(dbSteps[3].step.env.PROPERTY_SYNC_EXPECTED_DATABASE_HOST);
});
test("accepted snapshot chronology and private failure evidence survive the staged handoff", async () => {
  const w = await workflow();
  const apply = w.jobs.ingest.steps.find((s) => s.env?.DATABASE_URL_UNPOOLED);
  assert.match(
    apply.run,
    /daily_artifacts.py name --request "\$PAYLOAD" --run-id "\$GITHUB_RUN_ID" --attempt "\$GITHUB_RUN_ATTEMPT"/,
  );
  assert.match(apply.run, /tar -czf "\$asset" baseline/);
  const failure = w.jobs.collect.steps.find(
    (s) => s.name === "Preserve interrupted private checkpoints",
  );
  assert.match(failure.if, /failure\(\).*cancelled\(\)/);
  assert.match(failure.run, /unresolved-/);
  const pin = w.jobs.collect.steps.find(
    (s) => s.name === "Freeze and pin immutable request and raw before database access",
  );
  assert.match(pin.run, /daily_artifacts.py verify/);
  assert.match(pin.run, /daily_artifacts.py pin/);
  const replay = w.jobs.collect.steps.find(
    (s) => s.name === "Download exact frozen replay evidence",
  );
  assert.match(replay.run, /\^request-\[0-9\]/);
  assert.ok(!/run_28hse_sync/.test(replay.run));
});

test("staged workflow budgets isolate collector and reuse immutable evidence downstream", async () => {
  const { createRequire } = await import("node:module");
  const w = createRequire(import.meta.url)("js-yaml").load(readFileSync(path, "utf8"));
  for (const [stage, budget] of Object.entries({
    collect: 120,
    ingest: 20,
    publish: 45,
    verify: 10,
  })) {
    assert.ok(w.jobs[stage], stage + " job missing");
    assert.equal(w.jobs[stage]["timeout-minutes"], budget);
  }
  const collector = JSON.stringify(w.jobs.collect);
  assert.ok(!/DATABASE_URL|BLOB_READ_WRITE_TOKEN/.test(collector));
  for (const stage of ["ingest", "publish"]) {
    const job = JSON.stringify(w.jobs[stage]);
    assert.ok(!/run_28hse_sync|crawl_agent|Fetcher|run_propertyhk_sync/.test(job));
    assert.match(job, /daily_artifacts.py verify/);
  }
  assert.ok(w.on.workflow_dispatch.inputs.mode.options.includes("publication-only"));
  const ingest = JSON.stringify(w.jobs.ingest);
  assert.match(ingest, /read-sync-authority/);
});

test("watchdog is independent, read-only and emits no external messages", async () => {
  const { createRequire } = await import("node:module");
  const w = createRequire(import.meta.url)("js-yaml").load(
    readFileSync(
      new URL("../.github/workflows/property-sync-watchdog.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(w.on.schedule, [{ cron: "15 0 * * *" }]);
  assert.equal(w.permissions.contents, "read");
  const job = JSON.stringify(w.jobs);
  assert.ok(!/--apply|BLOB_READ_WRITE_TOKEN|send-message|email|whatsapp/i.test(job));
  assert.match(job, /sync-watchdog.mjs/);
});

test("manual source acceptance uses only disposable credentials and runs DB gates serially", async () => {
  const { createRequire } = await import("node:module");
  const w = createRequire(import.meta.url)("js-yaml").load(
    readFileSync(
      new URL("../.github/workflows/property-sync-acceptance.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(Object.keys(w.on), ["workflow_dispatch"]);
  assert.equal(w.permissions.contents, "read");
  const job = JSON.stringify(w.jobs);
  assert.ok(
    !/DATABASE_URL_UNPOOLED|BLOB_READ_WRITE_TOKEN|PROPERTY_SYNC_WORKFLOW_TOKEN|PROPERTY_SYNC_EVIDENCE_TOKEN/.test(
      job,
    ),
  );
  assert.match(job, /ASTRA_TEST_DATABASE_URL/);
  assert.match(job, /ASTRA_TEST_BRANCH_ID/);
  assert.match(job, /PROPERTY_SYNC_DB_ACCEPTANCE_ENABLED/);
  const runSteps = w.jobs.disposable.steps.filter(
    (s) => s.run && /test:property-sync:.*db/.test(s.run),
  );
  assert.equal(runSteps.length, 4);
  assert.equal(
    w.jobs.disposable.env.ASTRA_TEST_DATABASE_CONFIRMED,
    "${{ vars.ASTRA_TEST_DATABASE_CONFIRMED }}",
  );
});
