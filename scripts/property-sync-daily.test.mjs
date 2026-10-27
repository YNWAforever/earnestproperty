import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { executionSummary } from "./mls/record-sync-execution.mjs";
const path = new URL("../.github/workflows/property-sync-daily.yml", import.meta.url);
async function workflow() {
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)("js-yaml").load(readFileSync(path, "utf8"));
}
test("daily property workflow retains gated scheduling, privacy, branch and policy checks", async () => {
  const w = await workflow();
  assert.deepEqual(w.on.schedule, [{ cron: "0 1 * * *" }]);
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

test("scheduled owner publication requires fresh inventory evidence inside the frozen bundle", async () => {
  const w = await workflow();
  const owner = w.jobs["owner-publish"];
  const publish = owner.steps.find(
    (step) => step.name === "Publish owner capture into site listings",
  );
  assert.match(publish.run, /GITHUB_EVENT_NAME.*schedule/);
  assert.match(publish.run, /--require-homepage-inventory/);
  assert.match(publish.run, /homepageInventory/);
  assert.doesNotMatch(
    JSON.stringify(owner),
    /firecrawl|run_28hse_sync|scrapingbee|curl|requests\.get/i,
  );
});

test("native jobs export measured clocks even after failure without new credentials", async () => {
  const w = await workflow();
  for (const name of ["preflight", "collect", "ingest", "publish", "verify"]) {
    const job = w.jobs[name];
    const start = job.steps[0];
    const end = job.steps.at(-1);
    assert.equal(start.id, "execution-start", name);
    assert.equal(end.id, "execution-finish", name);
    assert.equal(end.if, "always()", name);
    assert.match(start.run, /date -u.*GITHUB_OUTPUT/, name);
    assert.match(end.run, /date -u.*GITHUB_OUTPUT/, name);
    assert.equal(job.outputs.started_at, "${{ steps.execution-start.outputs.at }}", name);
    assert.equal(job.outputs.finished_at, "${{ steps.execution-finish.outputs.at }}", name);
    assert.deepEqual(job.permissions, { contents: "read" }, name);
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

test("public verification proof is exported only after the real HTTP checker succeeds", async () => {
  const w = await workflow();
  const verify = w.jobs.verify;
  const step = verify.steps.find((item) => item.id === "public-verify");
  assert.ok(step, "real public verification needs an explicit step identity");
  assert.equal(
    verify.outputs.public_verified,
    "${{ steps.public-verify.outputs.public_verified }}",
  );
  assert.match(step.run, /if \[ "\$PUBLICATION_RESULT" = success \]; then/);
  assert.match(step.run, /set -euo pipefail/);
  const checkIndex = step.run.indexOf("node scripts/mls/verify-sync-publication.mjs");
  const proofIndex = step.run.indexOf('echo "public_verified=true" >> "$GITHUB_OUTPUT"');
  assert.ok(
    checkIndex >= 0 && proofIndex > checkIndex,
    "proof must follow the successful real check",
  );
  assert.ok(
    proofIndex < step.run.lastIndexOf("fi"),
    "proof stays inside publication-success branch",
  );
  const summary = verify.steps.find((item) => item.name === "Safe job summary");
  assert.ok(!summary.run.includes("public_verified=true"));
});

test("actual verification shell never exports proof on a skipped or failed check", async () => {
  const w = await workflow();
  const step = w.jobs.verify.steps.find((item) => item.id === "public-verify");
  const directory = mkdtempSync(join(tmpdir(), "property-sync-verification-"));
  const bash =
    [process.env.PROPERTY_SYNC_TEST_BASH, "C:/Program Files/Git/bin/bash.exe"]
      .filter(Boolean)
      .find((candidate) => existsSync(candidate)) ?? "bash";
  const stubs = `
    gh() { return 0; }
    node() { echo checked >> "$CHECK_CALLS"; return "$CHECK_EXIT"; }
  `;
  try {
    for (const [publication, checkExit, expectedExit, checked] of [
      ["failure", "0", 0, false],
      ["skipped", "0", 0, false],
      ["success", "1", 1, true],
      ["success", "0", 0, true],
    ]) {
      const output = join(directory, `${publication}-${checkExit}.outputs`);
      const calls = join(directory, `${publication}-${checkExit}.calls`);
      const result = spawnSync(bash, ["-c", stubs + step.run], {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          BASH_ENV: "",
          PUBLICATION_RESULT: publication,
          GITHUB_RUN_ID: "123",
          GITHUB_RUN_ATTEMPT: "1",
          GITHUB_OUTPUT: output.replaceAll("\\", "/"),
          CHECK_CALLS: calls.replaceAll("\\", "/"),
          CHECK_EXIT: checkExit,
        },
      });
      assert.ifError(result.error);
      assert.equal(result.status, expectedExit, result.stderr);
      assert.equal(existsSync(calls), checked);
      assert.equal(
        existsSync(output) ? readFileSync(output, "utf8").trim() : "",
        publication === "success" && checkExit === "0" ? "public_verified=true" : "",
      );
    }
  } finally {
    assert.ok(directory.startsWith(join(tmpdir(), "property-sync-verification-")));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("manual canary and scheduled apply require their own operator gates", async () => {
  const w = await workflow();
  const gate = w.jobs.preflight.steps.find((s) => s.id === "evidence-gate");
  const directory = mkdtempSync(join(tmpdir(), "property-sync-apply-gate-"));
  const bash =
    [process.env.PROPERTY_SYNC_TEST_BASH, "C:/Program Files/Git/bin/bash.exe"]
      .filter(Boolean)
      .find((candidate) => existsSync(candidate)) ?? "bash";
  try {
    for (const [event, mode, daily, manual, policy, allowed] of [
      ["workflow_dispatch", "apply", "false", "true", "python-v2.2", true],
      ["workflow_dispatch", "replay-apply", "false", "true", "python-v2.2", true],
      ["workflow_dispatch", "publication-only", "false", "true", "python-v2.2", true],
      ["schedule", "apply", "false", "true", "python-v2.2", false],
      ["workflow_dispatch", "apply", "true", "false", "python-v2.2", false],
      ["workflow_dispatch", "apply", "false", "", "python-v2.2", false],
      ["schedule", "apply", "true", "false", "python-v2.2", false],
      ["workflow_dispatch", "apply", "false", "true", "unapproved", false],
      ["pull_request", "apply", "true", "true", "python-v2.2", false],
      ["workflow_dispatch", "shadow", "false", "false", "", true],
    ]) {
      const result = spawnSync(
        bash,
        ["-c", "python() { return 0; }; gh() { return 0; };\n" + gate.run],
        {
          cwd: directory,
          encoding: "utf8",
          env: {
            ...process.env,
            BASH_ENV: "",
            GITHUB_EVENT_NAME: event,
            MODE: mode,
            APPLY_ENABLED: daily,
            MANUAL_APPLY_ENABLED: manual,
            POLICY_APPROVED: policy,
            SCOPE: "agent:540",
            GITHUB_REF: "refs/heads/main",
            EXPECTED_BRANCH: "main",
            GH_REPO: "private-evidence",
          },
        },
      );
      assert.ifError(result.error);
      assert.equal(
        result.status === 0,
        allowed,
        `${event}/${mode} daily=${daily} manual=${manual}: ${result.stderr}`,
      );
    }
    assert.equal(w.env.MANUAL_APPLY_ENABLED, "${{ vars.PROPERTY_SYNC_MANUAL_APPLY_ENABLED }}");
    assert.equal(w.env.APPLY_ENABLED, undefined);
    assert.equal(w.env.MODE, "${{ inputs.mode || 'owner-publication' }}");
    assert.equal(w.env.OWNER_DAILY_ENABLED, "${{ vars.OWNER_PUBLICATION_DAILY_ENABLED }}");
    assert.equal(w.env.OWNER_CAPTURE_ASSET, "${{ vars.OWNER_PUBLICATION_CAPTURE_ASSET }}");
    assert.equal(
      w.jobs.preflight.if,
      "github.event_name == 'workflow_dispatch' || vars.PROPERTY_SYNC_DAILY_ENABLED == 'true'",
    );
  } finally {
    assert.ok(directory.startsWith(join(tmpdir(), "property-sync-apply-gate-")));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("actual collection shell exports safe diagnostics while preserving failed exit and handoff gate", async () => {
  const w = await workflow();
  const step = w.jobs.collect.steps.find((item) => item.name === "Collect without database access");
  const directory = mkdtempSync(join(tmpdir(), "property-sync-collection-"));
  const bash =
    [process.env.PROPERTY_SYNC_TEST_BASH, "C:/Program Files/Git/bin/bash.exe"]
      .filter(Boolean)
      .find((candidate) => existsSync(candidate)) ?? "bash";
  const stubs = `
    python() {
      if [ "$1" = scripts/property-sync/run_28hse_sync.py ]; then
        printf '%s\\n' "$COLLECTOR_RESULT"
        if [ "$COLLECTOR_EXIT" = 0 ]; then
          mkdir -p daily-output/snapshots/28hse/test
          printf '{}' > daily-output/snapshots/28hse/test/request.json
        fi
        return "$COLLECTOR_EXIT"
      fi
      command "$PYTHON_TEST" "$DIAGNOSTICS_SCRIPT" "\${@:2}"
    }
  `;
  try {
    for (const exit of [1, 0]) {
      const output = join(directory, `collection-${exit}.outputs`);
      const environment = join(directory, `collection-${exit}.environment`);
      const collection = exit
        ? { error_code: "SOURCE_ROBOTS_HTTP_403", pages_read: 0, pages_failed: 2 }
        : { pages_read: 4, pages_failed: 0 };
      const result = spawnSync(bash, ["-c", stubs + step.run], {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          BASH_ENV: "",
          GITHUB_OUTPUT: output.replaceAll("\\", "/"),
          GITHUB_ENV: environment.replaceAll("\\", "/"),
          PYTHON_TEST: process.env.PROPERTY_SYNC_TEST_PYTHON ?? "python",
          DIAGNOSTICS_SCRIPT: fileURLToPath(
            new URL("./property-sync/daily_artifacts.py", import.meta.url),
          ).replaceAll("\\", "/"),
          COLLECTOR_EXIT: String(exit),
          COLLECTOR_RESULT: JSON.stringify({
            success: exit === 0,
            collection,
            privateResponse: "must remain private",
          }),
        },
      });
      assert.ifError(result.error);
      assert.equal(result.status, exit, result.stderr);
      const outputs = Object.fromEntries(
        readFileSync(output, "utf8")
          .trim()
          .split("\n")
          .map((line) => line.split("=")),
      );
      assert.deepEqual(
        outputs,
        Object.fromEntries(Object.entries(collection).map(([k, v]) => [k, String(v)])),
      );
      assert.equal(
        existsSync(environment),
        exit === 0,
        "failed collection must never export a handoff payload",
      );
      const summary = executionSummary({
        workflowRunId: "123",
        gitSha: "a".repeat(40),
        needs: { collect: { result: exit ? "failure" : "success", outputs } },
      });
      assert.equal(summary.stages.collection.pagesRead, exit ? 0 : 4);
      assert.equal(summary.stages.collection.pagesFailed, exit ? 2 : 0);
      assert.equal(
        summary.stages.collection.errorCode,
        exit ? "SOURCE_ROBOTS_HTTP_403" : undefined,
      );
      assert.equal(summary.privateEvidenceRef, undefined);
    }
    for (const key of ["error_code", "pages_read", "pages_failed"])
      assert.equal(w.jobs.collect.outputs[key], `\${{ steps.collection.outputs.${key} }}`);
    assert.equal(step.id, "collection");
  } finally {
    assert.ok(directory.startsWith(join(tmpdir(), "property-sync-collection-")));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("scheduled runs publish the approved owner capture and do not collect or use Firecrawl", async () => {
  const w = await workflow();
  assert.deepEqual(w.on.schedule, [{ cron: "0 1 * * *" }]);
  assert.ok(w.on.workflow_dispatch.inputs.mode.options.includes("owner-publication"));
  assert.ok(w.on.workflow_dispatch.inputs.mode.options.includes("owner-publication-dry-run"));
  for (const name of ["collect", "ingest", "publish", "record"])
    assert.match(w.jobs[name].if, /github\.event_name != 'schedule'/, name);
  const owner = w.jobs["owner-publish"];
  assert.equal(owner["timeout-minutes"], 90);
  assert.match(owner.if, /github\.event_name == 'schedule'/);
  const text = JSON.stringify(owner);
  assert.match(text, /scripts\/mls\/owner-publication\.mjs --apply --driver=neon-ws/);
  assert.match(text, /--confirm-production=/);
  assert.match(text, /OWNER_PUBLICATION_WROTE_NOTHING/);
  assert.match(text, /secrets\.IMPORT_DATABASE_URL/);
  assert.match(text, /secrets\.IMPORT_BLOB_READ_WRITE_TOKEN/);
  assert.doesNotMatch(
    text,
    /secrets\.DATABASE_URL|secrets\.BLOB_READ_WRITE_TOKEN|FIRECRAWL|run_28hse_sync|PROPERTY_SYNC_28HSE_TRANSPORT/,
  );
  const dry = owner.steps.find((step) => step.name === "Read owner capture without writing");
  assert.equal(dry.if, "env.MODE == 'owner-publication-dry-run'");
  assert.doesNotMatch(dry.run, /--apply/);
  const apply = owner.steps.find(
    (step) => step.name === "Publish owner capture into site listings",
  );
  for (const step of [apply, dry]) {
    assert.match(step.run, /owner-publication\.mjs\b[\s\S]*?>\/dev\/null/);
    assert.doesNotMatch(step.run, /\bcat\b|\btee\b/);
  }
  assert.match(apply.run, /published, alreadyPublished: current, held/);
  assert.doesNotMatch(apply.run, /report\.items|candidates|price/);
  assert.ok(!dry.env.IMPORT_BLOB_READ_WRITE_TOKEN);
  const gate = w.jobs.preflight.steps.find((step) => step.id === "evidence-gate");
  const hash = "a".repeat(64);
  const asset = `owner-capture-${hash}.tar.gz`;
  const directory = mkdtempSync(join(tmpdir(), "property-sync-owner-gate-"));
  const bash =
    [process.env.PROPERTY_SYNC_TEST_BASH, "C:/Program Files/Git/bin/bash.exe"]
      .filter(Boolean)
      .find((candidate) => existsSync(candidate)) ?? "bash";
  try {
    for (const [event, mode, daily, manual, capture, allowed] of [
      ["schedule", "owner-publication", "true", "false", asset, true],
      ["schedule", "owner-publication", "false", "true", asset, false],
      [
        "schedule",
        "owner-publication",
        "true",
        "true",
        `owner-capture-${"b".repeat(64)}.tar.gz`,
        false,
      ],
      ["schedule", "owner-publication-dry-run", "true", "true", asset, false],
      ["schedule", "apply", "true", "true", asset, false],
      ["workflow_dispatch", "owner-publication", "false", "true", asset, true],
      ["workflow_dispatch", "owner-publication", "true", "false", asset, false],
      ["workflow_dispatch", "owner-publication-dry-run", "false", "false", asset, true],
      ["pull_request", "owner-publication", "true", "true", asset, false],
    ]) {
      const result = spawnSync(
        bash,
        ["-c", "python() { return 0; }; gh() { return 0; };\n" + gate.run],
        {
          cwd: directory,
          encoding: "utf8",
          env: {
            ...process.env,
            BASH_ENV: "",
            GITHUB_EVENT_NAME: event,
            MODE: mode,
            OWNER_DAILY_ENABLED: daily,
            OWNER_MANUAL_ENABLED: manual,
            OWNER_INPUT_SHA256: hash,
            OWNER_CAPTURE_ASSET: capture,
            MANUAL_APPLY_ENABLED: "true",
            POLICY_APPROVED: "python-v2.2",
            SCOPE: "agent:540",
            GITHUB_REF: "refs/heads/main",
            EXPECTED_BRANCH: "main",
            GH_REPO: "private-evidence",
          },
        },
      );
      assert.ifError(result.error);
      assert.equal(
        result.status === 0,
        allowed,
        `${event}/${mode} daily=${daily} manual=${manual}: ${result.stderr}`,
      );
    }
  } finally {
    assert.ok(directory.startsWith(join(tmpdir(), "property-sync-owner-gate-")));
    rmSync(directory, { recursive: true, force: true });
  }
});
