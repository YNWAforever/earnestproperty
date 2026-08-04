import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.match(queueSource, /jobType:\s*"woztell\.campaign\.deliver"/);
  assert.match(queueSource, /payloadVersion:\s*1/);
  assert.match(queueSource, /woztell\.campaign\.deliver:\$\{params\.id\}/);
  assert.match(cronSource, /process\.env\.CRON_SECRET/);
  assert.match(cronSource, /enqueueJob\(/);
  assert.match(cronSource, /runClaimedJobs\(/);
  assert.match(cronSource, /ORDER BY campaign_id/);
  assert.match(cronSource, /woztell\.campaign\.deliver:\$\{campaignId\}/);
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
