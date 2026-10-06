import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";

const healthRoutePath = "src/routes/api.admin.control-plane.health.ts";

test("health route is permissioned and uses stable response envelopes", () => {
  const source = readFileSync(healthRoutePath, "utf8");

  assert.match(source, /requireStaffPermission\(request, "system\.health\.read"\)/);
  assert.match(source, /runControlPlaneHealthChecks\(\)/);
  assert.match(source, /successResponse\(\s*\{/);
  assert.match(source, /errorResponse\(error, context\.requestId, status\)/);
  assert.doesNotMatch(source, /process\.env/);
});

test("health returns role-derived Operations capabilities", () => {
  const source = readFileSync("src/routes/api.admin.control-plane.health.ts", "utf8");
  assert.match(source, /const actor = await requireStaffPermission/);
  assert.match(source, /operationsCapabilitiesForRoles\(actor\.roles\)/);
  assert.match(source, /capabilities/);
  assert.doesNotMatch(source, /roles:\s*actor\.roles/);
});

test("health service queries table and column metadata once each", () => {
  const source = readFileSync("src/lib/control-plane/health.server.ts", "utf8");
  assert.equal((source.match(/information_schema\.tables/g) ?? []).length, 1);
  assert.equal((source.match(/information_schema\.columns/g) ?? []).length, 1);
});

test("migration and audit routes enforce exact permissions and bounded inputs", () => {
  const listSource = readFileSync("src/routes/api.admin.control-plane.migrations.ts", "utf8");
  const planSource = readFileSync(
    "src/routes/api.admin.control-plane.migrations.$id.plan.ts",
    "utf8",
  );
  const applySource = readFileSync(
    "src/routes/api.admin.control-plane.migrations.$id.apply.ts",
    "utf8",
  );
  const auditSource = readFileSync("src/routes/api.admin.control-plane.audit.ts", "utf8");

  assert.match(listSource, /requireStaffPermission\(request, "system\.migrations\.plan"\)/);
  assert.match(planSource, /requireStaffPermission\(request, "system\.migrations\.plan"\)/);
  assert.match(applySource, /requireStaffPermission\(request, "system\.migrations\.apply"\)/);
  assert.match(auditSource, /requireStaffPermission\(request, "audit\.read"\)/);

  assert.match(planSource, /z\.object\(\{\}\)\.strict\(\)/);
  assert.match(applySource, /approvalToken:\s*z\.string\(\)\.min\(20\)/);
  for (const source of [planSource, applySource]) {
    assert.doesNotMatch(source, /(?:sql|statement|query)\s*:/i);
  }
  for (const key of ["cursor", "limit", "outcome", "action", "requestId"]) {
    assert.match(auditSource, new RegExp(`${key}:`));
  }
  assert.match(auditSource, /\.max\(100\)/);
  assert.doesNotMatch(auditSource, /process\.env/);
});

test("audit service uses keyset pagination and re-sanitizes stored metadata", () => {
  const source = readFileSync("src/lib/control-plane/audit.server.ts", "utf8");
  assert.match(source, /\(created_at, id\) < \(\$4::timestamptz, \$5::uuid\)/);
  assert.match(source, /limit \+ 1/);
  assert.match(source, /sanitizeAuditMetadata\(row\.metadata/);
  assert.doesNotMatch(source, /OFFSET/i);
});

test("control-plane worker requires cron authorization and returns counts only", () => {
  const source = readFileSync("src/routes/api.admin.control-plane.worker.ts", "utf8");
  assert.match(source, /process\.env\.CRON_SECRET/);
  assert.match(source, /request\.headers\.get\("authorization"\)/);
  assert.match(source, /actual !== `Bearer \$\{expected\}`/);
  assert.match(source, /runClaimedJobs/);
  for (const key of ["claimed", "succeeded", "retried", "failed", "cancelled"]) {
    assert.match(source, new RegExp(key));
  }
  assert.doesNotMatch(source, /payload\s*:/i);
  assert.doesNotMatch(source, /last_error_summary/);
});

test("only the authenticated drain routes write lane heartbeats; runServiceJobs and the local fallback do not", () => {
  // FX-07 Review Focus 4: the heartbeat means "the scheduled worker reached us".
  for (const path of [
    "src/lib/control-plane/service-worker.server.ts",
    "src/lib/control-plane/job-wake.server.ts",
  ]) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /heartbeat/i, path);
  }
  for (const [path, lane] of [
    ["src/routes/api.admin.whatsapp.service-worker.ts", "service-v2"],
    ["src/routes/api.admin.control-plane.worker.ts", "general-v1"],
  ]) {
    const source = readFileSync(path, "utf8");
    const unauthorized = source.indexOf('"UNAUTHORIZED"');
    const unauthorizedReturn = source.indexOf("return", source.lastIndexOf("\n", unauthorized));
    const heartbeat = source.indexOf(`recordWorkerHeartbeat("${lane}"`);
    assert.ok(unauthorized > 0, `${path} keeps its bearer check`);
    assert.ok(unauthorizedReturn > 0 && unauthorizedReturn < unauthorized, path);
    assert.ok(heartbeat > unauthorized, `${path} writes ${lane} only after the bearer check`);
    assert.equal(source.split("recordWorkerHeartbeat(").length - 1, 1, path);
  }
});

test("job management routes validate IDs, permissions, and safe summaries", () => {
  const listSource = readFileSync("src/routes/api.admin.control-plane.jobs.ts", "utf8");
  const retrySource = readFileSync("src/routes/api.admin.control-plane.jobs.$id.retry.ts", "utf8");
  const cancelSource = readFileSync(
    "src/routes/api.admin.control-plane.jobs.$id.cancel.ts",
    "utf8",
  );

  assert.match(listSource, /requireStaffPermission\(request, "system\.jobs\.read"\)/);
  assert.match(retrySource, /requireStaffPermission\(request, "system\.jobs\.retry"\)/);
  assert.match(cancelSource, /requireStaffPermission\(request, "system\.jobs\.cancel"\)/);
  for (const source of [retrySource, cancelSource]) {
    assert.match(source, /z\.object\(\{\}\)\.strict\(\)/);
    assert.match(source, /z\.string\(\)\.uuid\(\)/);
    assert.match(source, /writeAudit/);
  }
  for (const key of ["status", "jobType", "cursor", "limit"]) {
    assert.match(listSource, new RegExp(`${key}:`));
  }
  assert.match(listSource, /\.max\(100\)/);
  for (const sensitive of [
    /payload\s*:/i,
    /phone\s*:/i,
    /prompt\s*:/i,
    /providerToken\s*:/i,
    /last_error_summary/,
  ]) {
    assert.doesNotMatch(listSource, sensitive);
  }
});

test("AI knowledge rebuild route enqueues one versioned job per active window", () => {
  const source = readFileSync("src/routes/api.admin.ai.rebuild-knowledge.ts", "utf8");
  assert.match(source, /requireStaffPermission\(request, "ai\.knowledge\.rebuild"\)/);
  assert.match(source, /enqueueJob\(/);
  assert.match(source, /jobType:\s*"ai\.knowledge\.rebuild"/);
  assert.match(source, /payloadVersion:\s*1/);
  assert.match(source, /ai\.knowledge\.rebuild:\$\{activeWindow\}/);
  assert.match(source, /status:\s*202/);
  assert.doesNotMatch(source, /rebuildAdminAiKnowledge/);
});

test("WozTell queue routes enqueue durable campaign jobs and delegate to the worker", () => {
  const queueSource = readFileSync("src/routes/api.admin.campaigns.$id.queue.ts", "utf8");
  const cronSource = readFileSync("src/routes/api.admin.jobs.send-queue.ts", "utf8");

  assert.match(queueSource, /requireStaffPermission\(request, "campaign\.queue"\)/);
  const adminSource = readFileSync("src/lib/neon/admin-data.server.ts", "utf8");
  assert.match(queueSource, /sendAdminCampaignQueue/);
  assert.doesNotMatch(queueSource, /enqueueJob\(/);
  assert.match(adminSource, /WITH flipped AS[\s\S]*INSERT INTO ops_jobs/);
  assert.match(adminSource, /SELECT 'woztell\.campaign\.deliver', 1/);
  // The SQL key uses the same epoch-millisecond token as the legacy recovery
  // route, so one queue run still resolves to one billable delivery job.
  assert.match(adminSource, /floor\(extract\(epoch from flipped\.reviewed_at\) \* 1000\)/);
  assert.match(adminSource, /wakeAfterCommit\("general"\)/);
  assert.match(cronSource, /process\.env\.CRON_SECRET/);
  assert.match(cronSource, /enqueueJob\(/);
  assert.match(cronSource, /runClaimedJobs\(/);
  assert.match(cronSource, /ORDER BY campaign_id/);
  assert.match(cronSource, /campaignDeliveryIdempotencyKey\(campaignId, queueRunAt\)/);
  assert.match(cronSource, /reviewed_at, campaign\.created_at\)::text AS queue_run_at/);
  assert.doesNotMatch(cronSource, /idempotencyKey: `woztell\.campaign\.deliver:\$\{campaignId\}`/);
  assert.doesNotMatch(cronSource, /sendWoztellResponse/);
  assert.doesNotMatch(cronSource, /opt_in_whatsapp/);
});

test("job and migration overview routes compose safe read models", () => {
  const jobsSource = readFileSync("src/routes/api.admin.control-plane.jobs.ts", "utf8");
  const migrationsSource = readFileSync("src/routes/api.admin.control-plane.migrations.ts", "utf8");

  assert.match(jobsSource, /Promise\.all\(\[listJobs\(parsed\.data\), getJobSummary\(\)\]\)/);
  assert.match(jobsSource, /summary/);
  assert.match(migrationsSource, /listMigrationStates\(\)/);
  assert.doesNotMatch(migrationsSource, /migration\.statements/);
});

/**
 * Resolves an import specifier to a file inside this repo, or null for anything
 * from node_modules. `@/x` is the tsconfig alias for `src/x`.
 *
 * @param {string} specifier
 * @param {string} fromFile
 * @returns {string | null}
 */
function resolveLocalImport(specifier, fromFile) {
  const base = specifier.startsWith("@/")
    ? join("src", specifier.slice(2))
    : specifier.startsWith(".")
      ? join(dirname(fromFile), specifier)
      : null;
  if (!base) return null;

  // Specifiers here are written both with and without an extension, and the
  // `.js` ones are real .js files (see migration-versions.js), not TS output.
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * A route's source concatenated with the sources of the repo modules it imports,
 * one level deep.
 *
 * @param {string} file
 * @returns {string}
 */
function sourceWithLocalImports(file) {
  const source = readFileSync(file, "utf8");
  const imported = [...source.matchAll(/from\s+"([^"]+)"/g)]
    .map((match) => resolveLocalImport(match[1], file))
    .filter((path) => path !== null)
    .map((path) => readFileSync(path, "utf8"));
  return [source, ...imported].join("\n");
}

// Vercel Cron issues GET. A route registering POST only does not 405 under
// TanStack -- it falls through to the SPA render -- so a scheduled job that can
// never run looks exactly like one that runs fine. Both drain endpoints had
// been dead since they were scheduled.
//
// The CRON_SECRET half of this used to grep the route file alone. That broke
// when api.youtube-sync.ts was refactored to delegate to
// createYouTubeSyncHttpHandlers(): the check moved into
// lib/youtube-sync/youtube-http.server.ts, the literal string left the route,
// and a correctly-authenticated endpoint started failing. Reading one file only
// holds while nobody extracts a handler -- so follow the route's own imports one
// level and require the secret to be read somewhere in that chain. That still
// catches the thing worth catching (a cron route with no secret check reachable
// from it) without dictating which file the check lives in.
//
// This asserts the wiring, not the behaviour. That the handler actually returns
// 401 is proved in src/lib/youtube-sync/youtube-http.test.ts ("cron rejects
// missing or invalid bearer authorization"), which can call it directly because
// it runs under bun. This file runs under node --test and cannot import .ts,
// which is why it reads source text at all.
test("any path scheduled in vercel.ts has a GET handler", () => {
  const vercelConfig = readFileSync("vercel.ts", "utf8");
  const cronBlock = vercelConfig.slice(
    vercelConfig.indexOf("crons: ["),
    vercelConfig.indexOf("redirects: ["),
  );
  const paths = [...cronBlock.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]);

  // /api/admin/control-plane/worker -> src/routes/api.admin.control-plane.worker.ts
  const routeFileFor = (path) =>
    `src/routes/api${path.replace(/^\/api/, "").replace(/\//g, ".")}.ts`;

  for (const path of paths) {
    const file = routeFileFor(path);
    const source = readFileSync(file, "utf8");
    assert.match(source, /\bGET:/, `${file} must expose a GET handler for the ${path} cron`);
    assert.match(
      sourceWithLocalImports(file),
      /CRON_SECRET/,
      `${file} must still require the CRON_SECRET bearer token on every verb — ` +
        `neither it nor the modules it imports reads CRON_SECRET`,
    );
  }
});
