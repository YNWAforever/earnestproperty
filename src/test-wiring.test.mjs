import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

/**
 * This repo has no aggregate `npm test`. Tests are split by runner -- `.mjs`
 * under `node --test`, `.ts`/`.tsx` under `bun test` -- and invoked through
 * named `test:*` scripts.
 *
 * The consequence is that a test file which no script names is never executed
 * by anyone. That is not hypothetical: a repo audit found twelve such files,
 * one of which had been failing for some time because the product deliberately
 * changed underneath it and nobody saw the red.
 *
 * This test closes the loop. Adding a test file without wiring it into a script
 * now fails here, loudly, naming the file.
 */

function testFilesUnderSrc(dir = "src") {
  const entries = readdirSync(join(root, dir), { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return testFilesUnderSrc(path);
    return /\.test\.(mjs|ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function testScriptBodies() {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return Object.entries(pkg.scripts ?? {})
    .filter(([name]) => name.startsWith("test:"))
    .map(([, body]) => body)
    .join("\n");
}

test("every test file under src/ is named in a test:* script", () => {
  const scripts = testScriptBodies();
  const orphans = testFilesUnderSrc().filter((file) => !scripts.includes(file));

  assert.deepEqual(
    orphans,
    [],
    `These test files are in no test:* script, so nothing runs them:\n` +
      orphans.map((file) => `  ${file}`).join("\n") +
      `\n\nAdd each to an appropriate script in package.json -- .mjs files to a ` +
      `\`node --test\` list, .ts/.tsx files to a \`bun test\` list. There is no ` +
      `aggregate \`npm test\` here, so an unwired file is a file nobody ever runs.`,
  );
});

// The integration suite is deliberately excluded from the default scripts (it
// needs a live DATABASE_URL), but it must still be reachable from SOME script
// or it rots unnoticed like the twelve above.
test("the DB integration suite has its own opt-in script", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const dbScript = pkg.scripts?.["test:control-plane:db"];

  assert.ok(dbScript, "test:control-plane:db must exist as the opt-in DB suite entry point");
  assert.match(dbScript, /control-plane\.integration\.test\.mjs/);
});

// A test file that exists but contains no assertions passes vacuously and tells
// nobody anything. Cheap to check, and it catches a stubbed-out file left behind.
test("no test file under src/ is empty of assertions", () => {
  const empty = testFilesUnderSrc().filter((file) => {
    const source = readFileSync(join(root, file), "utf8");
    return !/\b(assert|expect)\s*[.(]/.test(source);
  });

  assert.deepEqual(empty, [], `These test files contain no assertions: ${empty.join(", ")}`);
});

// Guard against the recursion trap: this file must itself be wired in.
test("this wiring guard is itself wired into a script", () => {
  assert.match(testScriptBodies(), /src\/test-wiring\.test\.mjs/);
});

// statSync is imported for parity with sibling test helpers that walk the tree;
// referencing it here keeps the import honest rather than silently unused.
test("the source tree walk sees a real directory", () => {
  assert.equal(statSync(join(root, "src")).isDirectory(), true);
});

test("CI runs every test script that does not need a database or browser server", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  const ciScripts = new Set(
    [...workflow.matchAll(/^\s*- run: npm run (test:[\w:-]+)\s*$/gm)].map((match) => match[1]),
  );
  const environmentDependent = new Set([
    "test:a11y",
    "test:admin-properties:db",
    "test:admin:paging:db",
    "test:public-performance:db",
    "test:cms:db",
    "test:crm:db",
    "test:woztell:db",
    "test:whatsapp-enquiries:db",
    "test:staff-notifications:db",
    "test:staff-notifications:e2e",
    "test:control-plane:db",
    "test:live-agent:local-db",
    "test:mls:db",
    "test:property-sync:db",
    "test:property-sync:publication:db",
    // Manual private acceptance workflow requires a verified disposable target.
    "test:property-sync:admin:db",
    "test:property-sync:withdrawal:db",
    "test:property-sync:private-replay:db",
    "test:staff-bootstrap:db",
    "test:youtube-sync:db",
  ]);
  const omitted = Object.keys(pkg.scripts).filter(
    (name) => name.startsWith("test:") && !environmentDependent.has(name) && !ciScripts.has(name),
  );

  assert.deepEqual(omitted, [], `Add these deterministic suites to CI: ${omitted.join(", ")}`);
  assert.deepEqual(
    [...environmentDependent].filter((name) => !pkg.scripts[name]),
    [],
    "Every environment-dependent suite must remain explicitly registered in package.json",
  );
});

test("CI requires zero lint and typecheck errors", () => {
  const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");

  assert.match(workflow, /^        run: npm run lint$/m);
  assert.match(workflow, /^        run: npm run typecheck$/m);
  assert.doesNotMatch(workflow, /ESLINT_BASELINE|TSC_BASELINE/);
});

test("CI exposes the browser suite as an explicit staging environment gate", () => {
  const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");

  assert.match(workflow, /browser-staging:/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /PLAYWRIGHT_BASE_URL: \$\{\{ vars\.STAGING_BASE_URL \}\}/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /npm run test:a11y/);
});

test("Playwright starts the local server only when no remote base URL is supplied", () => {
  const config = readFileSync(join(root, "playwright.config.ts"), "utf8");

  assert.match(config, /const remoteBaseUrl = process\.env\.PLAYWRIGHT_BASE_URL;/);
  assert.match(config, /webServer: remoteBaseUrl\s*\? undefined\s*:/);
});

test("source-sync DB and private original regression have explicit guarded manual CI entrypoints", async () => {
  const { createRequire } = await import("node:module");
  const w = createRequire(import.meta.url)("js-yaml").load(
    readFileSync(join(root, ".github/workflows/property-sync-acceptance.yml"), "utf8"),
  );
  assert.deepEqual(Object.keys(w.on), ["workflow_dispatch"]);
  const portableDb = JSON.stringify(w.jobs.disposable);
  for (const name of ["test:property-sync:admin:db", "test:property-sync:withdrawal:db"])
    assert.ok(portableDb.includes(name));
  const p = w.jobs.private_regression;
  assert.ok(p, "private regression is wired, not only local");
  assert.equal(p.needs, "disposable");
  assert.match(p.if, /PROPERTY_SYNC_PRIVATE_REGRESSION_ENABLED/);
  assert.equal(w.permissions.contents, "read");
  const text = JSON.stringify(p);
  assert.match(text, /PRIVATE_REGRESSION_READ_TOKEN/);
  assert.match(text, /PRIVATE_FIXTURE_SIZE_MISMATCH/);
  assert.match(text, /PRIVATE_FIXTURE_HASH_MISMATCH/);
  assert.ok(text.includes("npm run test:property-sync:private-replay:db"));
  assert.doesNotMatch(
    text,
    /DATABASE_URL_UNPOOLED|BLOB_READ_WRITE_TOKEN|upload-artifact|PROPERTY_SYNC_WORKFLOW_TOKEN/,
  );
});
