import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import {
  GATE_MODE_ENV,
  blockedBuildMessage,
  gateDecision,
  gateMode,
} from "./build-migration-gate.mjs";
import { MIGRATION_VERSIONS } from "../../src/lib/control-plane/migration-versions.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const runGate = (env) =>
  spawnSync(process.execPath, ["scripts/neon/build-migration-gate.mjs"], {
    cwd: new URL("../../", import.meta.url),
    encoding: "utf8",
    // Strip inherited configuration so the child sees exactly what each case sets.
    env: { PATH: process.env.PATH, ...env },
  });

// The whole point of the gate is that it is ON where it matters. A default of
// `off` would make this file pass while production stayed unguarded.
test("production Vercel builds enforce, preview builds only warn", () => {
  assert.equal(gateMode({ VERCEL_ENV: "production" }), "enforce");
  assert.equal(gateMode({ VERCEL_ENV: "preview" }), "warn");
});

// Local `npm run build` and CI must not start reaching for a database: neither
// has (or should need) production credentials to build a bundle.
test("local and CI builds skip unless the gate is requested explicitly", () => {
  assert.equal(gateMode({}), "off");
  assert.equal(gateMode({ VERCEL_ENV: "development" }), "off");
  assert.equal(gateMode({ VERCEL_ENV: "production", [GATE_MODE_ENV]: "enforce" }), "enforce");
});

// The escape hatch has to work in both directions, or an incident where the fix
// IS the deploy would be blocked by the gate that exists to protect it.
test("an explicit override beats the Vercel default", () => {
  assert.equal(gateMode({ VERCEL_ENV: "production", [GATE_MODE_ENV]: "warn" }), "warn");
  assert.equal(gateMode({ VERCEL_ENV: "production", [GATE_MODE_ENV]: "off" }), "off");
  assert.equal(gateMode({ VERCEL_ENV: "production", [GATE_MODE_ENV]: "  OFF  " }), "off");
  assert.equal(gateMode({ VERCEL_ENV: "production", [GATE_MODE_ENV]: "enforced" }), "enforce");
});

test("the gate only queries a database it actually has a URL for", () => {
  assert.deepEqual(gateDecision({ mode: "enforce", databaseUrl: null }), {
    action: "skip",
    reason:
      "no DATABASE_URL/DATABASE_URL_UNPOOLED in this environment, so the schema this build expects cannot be verified",
  });
  assert.deepEqual(gateDecision({ mode: "off", databaseUrl: "postgres://direct" }), {
    action: "skip",
    reason:
      "MIGRATION_DRIFT_GATE is off (set it to `enforce` to check this build against the database)",
  });
  assert.deepEqual(gateDecision({ mode: "enforce", databaseUrl: "postgres://direct" }), {
    action: "check",
  });
  assert.deepEqual(gateDecision({ mode: "warn", databaseUrl: "postgres://direct" }), {
    action: "check",
  });
});

// This message is the entire product of a blocked build: the person reading it
// has a red Vercel log and nothing else. It has to name the migrations, the
// remedy and the override, or the first instinct is to disable the gate.
test("a blocked build names the migrations, the remedy and the override", () => {
  const message = blockedBuildMessage([
    "20261105120000_blog_presentation_contracts.sql",
    "20261105140000_blog_repository_mutations.sql",
  ]);

  assert.match(message, /Build blocked/);
  assert.match(message, /20261105120000_blog_presentation_contracts\.sql/);
  assert.match(message, /20261105140000_blog_repository_mutations\.sql/);
  assert.match(message, /neon:migrate/, "must say how to apply them");
  assert.match(message, new RegExp(`${GATE_MODE_ENV}=warn`), "must document the override");
  assert.match(message, /2026-11-06/, "must name the incident this prevents");
  assert.match(message, new RegExp(String(MIGRATION_VERSIONS.length)), "must state the count");
});

// The version list has one home. If the gate grew its own copy, a migration
// added to only one of them would make the gate report "0 pending" forever --
// the exact class of silent gap this file exists to close.
test("the gate reuses MIGRATION_VERSIONS instead of keeping its own list", () => {
  const source = read("scripts/neon/build-migration-gate.mjs");
  assert.match(source, /from "\.\.\/\.\.\/src\/lib\/control-plane\/migration-versions\.js"/);
  assert.doesNotMatch(source, /\d{14}_[a-z0-9_]+\.sql/, "no hardcoded migration filenames");
  assert.match(source, /pendingMigrations/, "must use the shared diff, not its own comparison");
});

// `check:migration-drift` already reports drift, after the deploy exists. The
// gate is only worth anything if the build actually runs it.
test("prebuild runs the gate, after the existing required-env check", () => {
  const pkg = JSON.parse(read("package.json"));
  const prebuild = pkg.scripts?.prebuild;

  assert.ok(prebuild, "prebuild must exist");
  const envCheck = prebuild.indexOf("scripts/check-required-env.mjs");
  const gate = prebuild.indexOf("scripts/neon/build-migration-gate.mjs");
  assert.ok(envCheck >= 0, "the existing required-env check must stay");
  assert.ok(gate >= 0, "prebuild must run the migration gate");
  assert.ok(gate > envCheck, "the gate runs after the env check, so it sees a configured env");
});

// Reported before merge instead of after deploy. The workflow already ran on
// push to main, which is too late to stop the deployment that followed.
test("the drift workflow also runs on pull requests", () => {
  const workflow = read(".github/workflows/migration-drift.yml");
  // pull_request must be a BARE trigger with no path filter. A required check
  // that only runs for some pull requests stays "expected" forever on the rest
  // and blocks them instead of protecting them, which is worse than no gate.
  assert.match(
    workflow,
    /^on:\n {2}pull_request:\n {2}push:/m,
    "pull_request must have no path filter so the required check always reports",
  );
  // The job id is the check name branch protection requires. Renaming it
  // silently detaches the gate.
  assert.match(
    workflow,
    /^ {2}migration-drift:\n {4}runs-on:/m,
    "the migration-drift job id must stay stable for branch protection",
  );
  // The push trigger is the post-merge backstop, not a required check, so it
  // keeps its path filter and does not wake Neon for a docs-only merge.
  assert.match(
    workflow,
    /push:\n {4}branches: \[main\][\s\S]*?paths:/,
    "the post-merge backstop keeps its path filter",
  );
  assert.match(workflow, /neon\/migrations\/\*\*/, "must still cover migration changes");
  assert.match(workflow, /migration-versions\.js/, "must cover the manifest too");
});

// CLI contract, without a database: skipping and fail-open are both silent
// successes, so they need to be provable by exit code and by what gets logged.
test("the CLI exits 0 and says why when it is not enforcing", () => {
  const skipped = runGate({ VERCEL_ENV: "development" });
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.match(skipped.stdout, /\[migration-gate\] skipped:/);
  assert.match(skipped.stdout, /MIGRATION_DRIFT_GATE is off/);
});

test("an unreachable database warns instead of freezing every deploy", () => {
  const result = runGate({
    VERCEL_ENV: "production",
    DATABASE_URL_UNPOOLED: "postgres://127.0.0.1:1/does-not-exist",
  });

  assert.equal(result.status, 0, "a database outage must not block shipping the fix");
  assert.match(result.stderr, /\[migration-gate\] could not verify the schema/);
  assert.match(result.stderr, /deploying unverified/);
});
