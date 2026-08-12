import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { operationsCapabilitiesForRoles } from "./capabilities.ts";
import { hasPermission } from "./permissions.ts";
import { errorResponse, mapControlPlaneError, successResponse } from "./errors.ts";
import { createOperationContext } from "./request-context.ts";
import { sanitizeAuditMetadata } from "./audit.server.ts";
import { aggregateHealth } from "./health.server.ts";
import { issueMigrationApproval, verifyMigrationApproval } from "./migration-approval.ts";
import { computeMigrationChecksum, listRegisteredMigrations } from "./migration-registry.server.ts";
import { applyMigration, planMigration } from "./migrations.server.ts";
import { canCancelJob, jobFailureTransition, manualRetryTransition, retryDelayMs } from "./jobs.ts";
import {
  createAiKnowledgeRebuildHandler,
  createWoztellCampaignDeliveryHandler,
  isRetryableJobError,
  parseRegisteredJobPayload,
  registerJobHandler,
  retryableJobError,
} from "./job-handlers.server.ts";
import * as jobsServer from "./jobs.server.ts";

test("permission matrix defaults to deny", () => {
  assert.equal(hasPermission(["agent"], "system.health.read"), true);
  assert.equal(hasPermission(["agent"], "system.jobs.retry"), false);
  assert.equal(hasPermission(["unknown"], "system.health.read"), false);
});

test("operations capabilities expose no protected panels beyond each role", () => {
  assert.deepEqual(operationsCapabilitiesForRoles(["agent"]), {
    jobsRead: false,
    jobsRetry: false,
    jobsCancel: false,
    auditRead: false,
    migrationsPlan: false,
    migrationsApply: false,
  });
  assert.deepEqual(operationsCapabilitiesForRoles(["manager"]), {
    jobsRead: true,
    jobsRetry: true,
    jobsCancel: true,
    auditRead: true,
    migrationsPlan: false,
    migrationsApply: false,
  });
  assert.equal(operationsCapabilitiesForRoles(["admin"]).migrationsApply, true);
  assert.deepEqual(operationsCapabilitiesForRoles(["unknown"]), {
    jobsRead: false,
    jobsRetry: false,
    jobsCancel: false,
    auditRead: false,
    migrationsPlan: false,
    migrationsApply: false,
  });
});

test("structured postgres codes map to stable public errors", () => {
  assert.deepEqual(mapControlPlaneError({ code: "42P01" }), {
    code: "SCHEMA_RELATION_MISSING",
    message: "A required database relation is missing.",
    retryable: false,
  });
  assert.equal(mapControlPlaneError(new Error("password=secret")).code, "INTERNAL_ERROR");
});

test("responses use stable success and error envelopes", async () => {
  const success = await successResponse({ value: 1 }, "request-1").json();
  assert.deepEqual(success, { ok: true, data: { value: 1 }, requestId: "request-1" });

  const error = await errorResponse({ code: "23505" }, "request-2", 409).json();
  assert.deepEqual(error, {
    ok: false,
    error: {
      code: "CONFLICT_DUPLICATE",
      message: "The operation conflicts with existing data.",
      retryable: false,
    },
    requestId: "request-2",
  });
});

test("operation contexts include a UUID request id and ISO timestamp", () => {
  const context = createOperationContext();
  assert.match(context.requestId, /^[0-9a-f-]{36}$/);
  assert.doesNotThrow(() => new Date(context.startedAt).toISOString());
});

test("audit metadata recursively removes sensitive values", () => {
  assert.deepEqual(
    sanitizeAuditMetadata({
      token: "secret",
      phone: "91234567",
      nested: { title: "ok", password: "x" },
    }),
    { token: "[REDACTED]", phone: "[REDACTED]", nested: { title: "ok", password: "[REDACTED]" } },
  );
});

test("audit metadata applies bounded strings, arrays, and nesting", () => {
  const metadata = sanitizeAuditMetadata({
    description: "x".repeat(600),
    items: Array.from({ length: 55 }, (_, index) => index),
    nested: { a: { b: { c: { d: { e: "hidden" } } } } },
    accessToken: "hidden",
  });

  assert.equal(metadata.description.length, 500);
  assert.equal(metadata.items.length, 50);
  assert.equal(metadata.nested.a.b.c.d, "[TRUNCATED]");
  assert.equal(metadata.accessToken, "[REDACTED]");
});
test("audit metadata redacts recipient and provider payloads and caps object width", () => {
  const wide = Object.fromEntries(
    Array.from({ length: 60 }, (_, index) => [`key${String(59 - index).padStart(2, "0")}`, index]),
  );
  const metadata = sanitizeAuditMetadata({
    jobId: "job-1",
    migrationId: "migration-1",
    status: "queued",
    nested: {
      email: "recipient@example.test",
      memberId: "member-1",
      recipient: { id: "contact-1" },
      provider: { token: "provider-secret" },
      headers: { authorization: "Bearer secret" },
      payload: { text: "private message" },
      details: { phone: "91234567" },
    },
    wide,
  });

  assert.deepEqual(
    { jobId: metadata.jobId, migrationId: metadata.migrationId, status: metadata.status },
    { jobId: "job-1", migrationId: "migration-1", status: "queued" },
  );
  for (const key of [
    "email",
    "memberId",
    "recipient",
    "provider",
    "headers",
    "payload",
    "details",
  ]) {
    assert.equal(metadata.nested[key], "[REDACTED]");
  }
  assert.equal(Object.keys(metadata.wide).length, 50);
  assert.deepEqual(
    Object.keys(metadata.wide),
    Array.from({ length: 50 }, (_, index) => `key${String(index).padStart(2, "0")}`),
  );
});

test("required failed checks make health failed while optional failures degrade", () => {
  assert.equal(
    aggregateHealth([
      { key: "database", required: true, status: "healthy" },
      { key: "woztell", required: false, status: "failed" },
    ]).status,
    "degraded",
  );
  assert.equal(
    aggregateHealth([{ key: "database", required: true, status: "failed" }]).status,
    "failed",
  );
});

test("migration approval is bound to actor, checksum, schema and expiry", async () => {
  const input = {
    migrationId: "20260715090000_test",
    checksum: "sha256:test",
    schemaFingerprint: "schema:test",
    actorStaffId: "staff-1",
  };
  const issueDeps = { secret: "test-secret", now: () => 1_000 };
  const verifyDeps = { secret: "test-secret", now: () => 1_030 };
  const token = await issueMigrationApproval(input, issueDeps);

  assert.equal((await verifyMigrationApproval(token, input, verifyDeps)).ok, true);
  for (const changed of [
    { ...input, migrationId: "other" },
    { ...input, checksum: "sha256:other" },
    { ...input, schemaFingerprint: "schema:other" },
    { ...input, actorStaffId: "other" },
  ]) {
    const result = await verifyMigrationApproval(token, changed, verifyDeps);
    assert.deepEqual(result, { ok: false, error: "MIGRATION_APPROVAL_INVALID" });
  }

  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  assert.deepEqual(await verifyMigrationApproval(tampered, input, verifyDeps), {
    ok: false,
    error: "MIGRATION_APPROVAL_INVALID",
  });
  assert.deepEqual(
    await verifyMigrationApproval(token, input, { secret: "test-secret", now: () => 1_300 }),
    { ok: false, error: "MIGRATION_APPROVAL_INVALID" },
  );
});

test("migration checksums are stable and registry declarations are enforced", async () => {
  const statements = [{ statement: "SELECT $1::jsonb", params: [{ zebra: 1, alpha: [2, 3] }] }];
  const checksum = await computeMigrationChecksum(statements);
  assert.equal(
    checksum,
    await computeMigrationChecksum([
      { statement: "SELECT $1::jsonb", params: [{ alpha: [2, 3], zebra: 1 }] },
    ]),
  );
  assert.notEqual(checksum, await computeMigrationChecksum([{ statement: "SELECT 2" }]));

  await assert.rejects(
    () =>
      listRegisteredMigrations([
        {
          id: "test",
          checksum: "sha256:incorrect",
          dependencies: [],
          summary: "test",
          statements,
          postconditions: [],
        },
      ]),
    (error) => error?.code === "VALIDATION_ERROR",
  );
  assert.equal(
    mapControlPlaneError({ code: "MIGRATION_APPROVAL_INVALID" }).code,
    "MIGRATION_APPROVAL_INVALID",
  );
});

test("migration service revalidates schema and applies once through a transaction", async () => {
  const defaultRegistry = await listRegisteredMigrations();
  assert.equal(defaultRegistry[0].id, "20260715120000_ops_jobs_status_updated_index");

  const statements = [{ statement: "SELECT 1" }];
  const migration = {
    id: "test_migration",
    checksum: await computeMigrationChecksum(statements),
    dependencies: [],
    summary: "Test migration",
    statements,
    postconditions: [],
  };
  const tables = [
    "app_migrations",
    "staff_users",
    "staff_roles",
    "ops_audit_logs",
    "ops_jobs",
    "ops_job_attempts",
    "ops_migration_runs",
  ];
  const columns = {
    app_migrations: ["version", "applied_at"],
    staff_users: ["id"],
    staff_roles: ["staff_user_id", "role"],
    ops_audit_logs: ["id", "permission", "action", "outcome", "request_id", "metadata"],
    ops_jobs: ["id", "job_type", "payload_version", "status", "idempotency_key"],
    ops_job_attempts: ["id", "job_id", "attempt_number", "outcome"],
    ops_migration_runs: ["id", "migration_id", "checksum", "schema_fingerprint", "result"],
  };
  let applied = false;
  let schemaChanged = false;
  const failureRuns = [];
  const transactions = [];
  const audits = [];
  const queryRows = async (statement, params = []) => {
    if (statement.includes("information_schema.tables")) {
      return tables
        .concat(schemaChanged ? ["stale_marker"] : [])
        .map((table_name) => ({ table_name }));
    }
    if (statement.includes("information_schema.columns")) {
      return Object.entries(columns).flatMap(([table_name, names]) =>
        names.map((column_name) => ({ table_name, column_name })),
      );
    }
    if (statement === "SELECT version FROM app_migrations") {
      return applied ? [{ version: migration.id }] : [];
    }
    if (statement.includes("SELECT migration_id FROM ops_migration_runs")) return [];
    if (statement.includes("INSERT INTO ops_migration_runs")) {
      failureRuns.push(params);
      return [];
    }
    throw new Error(`Unexpected query: ${statement}`);
  };
  const transactionRows = async (batch) => {
    transactions.push(batch);
    applied = true;
    return batch.map(() => []);
  };
  const writeAudit = async (entry) => {
    audits.push(entry);
  };
  const actor = {
    staffId: "staff-1",
    authUserId: "auth-1",
    email: "staff@example.test",
    name: "Staff",
    roles: ["admin"],
    bootstrap: false,
  };
  const deps = {
    registry: [migration],
    approvalSecret: "test-secret",
    queryRows,
    transactionRows,
    writeAudit,
    now: () => 1_000,
  };

  const plan = await planMigration({ migrationId: migration.id, actor }, deps);
  const result = await applyMigration(
    {
      migrationId: migration.id,
      approvalToken: plan.approvalToken,
      actor,
      context: { requestId: crypto.randomUUID(), startedAt: new Date().toISOString() },
    },
    deps,
  );
  assert.equal(result.status, "succeeded");
  assert.equal(transactions.length, 1);
  assert.match(transactions[0][0].statement, /pg_advisory_xact_lock/);
  assert.match(transactions[0][1].statement, /current_fingerprint/);
  assert.ok(transactions[0].some(({ statement }) => /INSERT INTO app_migrations/.test(statement)));
  assert.match(transactions[0].at(-1).statement, /INSERT INTO ops_audit_logs/);
  assert.equal(audits.length, 0);
  await assert.rejects(
    () => planMigration({ migrationId: migration.id, actor }, deps),
    (error) => error?.code === "CONFLICT_DUPLICATE",
  );

  applied = false;
  const stalePlan = await planMigration({ migrationId: migration.id, actor }, deps);
  schemaChanged = true;
  await assert.rejects(
    () =>
      applyMigration(
        {
          migrationId: migration.id,
          approvalToken: stalePlan.approvalToken,
          actor,
          context: { requestId: crypto.randomUUID(), startedAt: new Date().toISOString() },
        },
        deps,
      ),
    (error) => error?.code === "MIGRATION_APPROVAL_INVALID",
  );
  assert.equal(failureRuns.length, 1);
  assert.equal(audits.at(-1).outcome, "failure");
});

test("job workers renew leases, expose checkpoints, and stop heartbeats", () => {
  const renewSource = jobsServer.renewJobLease.toString();
  const runnerSource = jobsServer.runClaimedJobs.toString();

  assert.match(renewSource, /lease_expires_at >= now/);
  // The runner drains more than one job per invocation, but claims them ONE AT
  // A TIME. claimJobs stamps a single shared lease_expires_at across a batch
  // while the runner executes serially, so a batched claim left later jobs with
  // an expired lease before they started: they could neither run, fail, nor
  // complete (renewJobLease/failJob/completeJob all require
  // lease_expires_at >= now()), were miscounted as `cancelled`, and were
  // re-queued with the attempt burned until max_attempts failed them for good.
  assert.match(runnerSource, /for \(let index = 0; index < maxJobs/);
  assert.match(runnerSource, /claimJobs\(\{ \.\.\.input, limit: 1 \}\)/);
  assert.match(runnerSource, /MAX_JOBS_PER_RUN/);
  // Stops before the serverless timeout rather than trusting a job count.
  assert.match(runnerSource, /RUN_BUDGET_MS/);
  // The batch form must not come back.
  assert.doesNotMatch(runnerSource, /claimJobs\(\{ \.\.\.input, limit \}\)/);
  assert.match(jobsServer.completeJob.toString(), /lease_expires_at >= now/);
  assert.match(jobsServer.failJob.toString(), /lease_expires_at >= now/);
  assert.doesNotMatch(jobsServer.enqueueJob.toString(), /status IN \('cancelled', 'failed'\)/);
  assert.match(jobsServer.retryJob.toString(), /status IN \('failed', 'cancelled'\)/);
  assert.match(jobsServer.retryJob.toString(), /max_attempts = attempt_count \+ 1/);
  assert.match(runnerSource, /startLeaseHeartbeat/);
  assert.match(runnerSource, /checkpoint: heartbeat\.checkpoint/);
  assert.equal(runnerSource.match(/heartbeat\.stop/g)?.length, 2);
});

test("manual job commands couple success audits to their state transitions", () => {
  for (const command of [jobsServer.retryJob, jobsServer.cancelJob]) {
    const source = command.toString();
    assert.match(source, /WITH/);
    assert.match(source, /INSERT INTO ops_audit_logs/);
    assert.match(source, /FROM (retried|cancelled)/);
  }
});

test("retryable failures back off and exhausted failures stop", () => {
  assert.deepEqual(
    jobFailureTransition({ attemptCount: 1, maxAttempts: 3, retryable: true, nowMs: 1_000 }),
    { status: "queued", runAfterMs: 3_000 },
  );
  assert.deepEqual(
    jobFailureTransition({ attemptCount: 3, maxAttempts: 3, retryable: true, nowMs: 1_000 }),
    { status: "failed", runAfterMs: null },
  );
  assert.deepEqual(
    jobFailureTransition({ attemptCount: 1, maxAttempts: 3, retryable: false, nowMs: 1_000 }),
    { status: "failed", runAfterMs: null },
  );
  assert.equal(retryDelayMs(20), 15 * 60 * 1_000);
});

test("manual retry grants exactly one additional attempt", () => {
  assert.deepEqual(manualRetryTransition({ status: "failed", attemptCount: 5, maxAttempts: 5 }), {
    status: "queued",
    maxAttempts: 6,
  });
  assert.deepEqual(
    manualRetryTransition({ status: "cancelled", attemptCount: 2, maxAttempts: 5 }),
    { status: "queued", maxAttempts: 3 },
  );
  assert.equal(
    manualRetryTransition({ status: "succeeded", attemptCount: 1, maxAttempts: 5 }),
    null,
  );
});

test("only unfinished or failed jobs can be cancelled", () => {
  assert.equal(canCancelJob("queued"), true);
  assert.equal(canCancelJob("running"), true);
  assert.equal(canCancelJob("failed"), true);
  assert.equal(canCancelJob("succeeded"), false);
  assert.equal(canCancelJob("cancelled"), false);
});

test("job handlers are versioned and validate payloads before execution", () => {
  const handler = {
    jobType: "test.controlplane",
    payloadVersion: 1,
    parsePayload(input) {
      if (!input || typeof input !== "object" || typeof input.value !== "number") {
        throw Object.assign(new Error("Invalid payload"), { code: "VALIDATION_ERROR" });
      }
      return { value: input.value };
    },
    async run() {
      return { summary: { processed: 1 } };
    },
  };
  registerJobHandler(handler);
  assert.deepEqual(parseRegisteredJobPayload("test.controlplane", 1, { value: 2 }).payload, {
    value: 2,
  });
  assert.throws(
    () => parseRegisteredJobPayload("test.controlplane", 1, { value: "bad" }),
    (error) => error?.code === "VALIDATION_ERROR",
  );
  assert.equal(isRetryableJobError(retryableJobError("TIMEOUT", "Timed out")), true);
  assert.equal(isRetryableJobError(new Error("Permanent")), false);
});

test("AI knowledge handler delegates safely and marks provider timeouts retryable", async () => {
  const payload = { requestedByStaffId: "11111111-1111-4111-8111-111111111111" };
  let checkpoints = 0;
  const handler = createAiKnowledgeRebuildHandler({
    runKnowledgeRebuild: async (input) => {
      assert.deepEqual(input, payload);
      return { indexedSources: 4, indexedChunks: 12, embeddingDimensionFailures: 1 };
    },
  });
  assert.deepEqual(
    await handler.run(payload, {
      jobId: "job-1",
      attempt: 1,
      checkpoint: async () => {
        checkpoints += 1;
      },
    }),
    {
      summary: { indexedSources: 4, indexedChunks: 12, embeddingDimensionFailures: 1 },
    },
  );

  assert.equal(checkpoints, 2);
  const timeoutHandler = createAiKnowledgeRebuildHandler({
    runKnowledgeRebuild: async () => {
      throw Object.assign(new Error("Provider timed out"), { code: "INTEGRATION_TIMEOUT" });
    },
  });
  await assert.rejects(
    () =>
      timeoutHandler.run(payload, {
        jobId: "job-2",
        attempt: 1,
        checkpoint: async () => {},
      }),
    (error) => isRetryableJobError(error) && error.code === "AI_KNOWLEDGE_REBUILD_TIMEOUT",
  );
});

test("WozTell campaign handler maps timeout to retry and permanent rejection to failure", async () => {
  const payload = { campaignId: "11111111-1111-4111-8111-111111111111" };
  const success = createWoztellCampaignDeliveryHandler({
    deliverCampaign: async () => ({ sent: 3, blocked: 1, failed: 0, checked: 4 }),
  });
  assert.deepEqual(await success.run(payload, { jobId: "job-1", attempt: 1 }), {
    summary: { sent: 3, blocked: 1, failed: 0, checked: 4 },
  });

  const timeout = createWoztellCampaignDeliveryHandler({
    deliverCampaign: async () => {
      throw Object.assign(new Error("timeout"), { code: "WOZTELL_PROVIDER_TIMEOUT" });
    },
  });
  await assert.rejects(
    () => timeout.run(payload, { jobId: "job-2", attempt: 1 }),
    (error) => isRetryableJobError(error) && error.code === "WOZTELL_CAMPAIGN_RETRYABLE",
  );

  const rejected = createWoztellCampaignDeliveryHandler({
    deliverCampaign: async () => ({ sent: 0, blocked: 0, failed: 1, checked: 1 }),
  });
  await assert.rejects(
    () => rejected.run(payload, { jobId: "job-3", attempt: 1 }),
    (error) => error?.code === "WOZTELL_CAMPAIGN_REJECTED" && !isRetryableJobError(error),
  );
});

// enqueueJob's ON CONFLICT is `DO UPDATE SET idempotency_key =
// EXCLUDED.idempotency_key` -- a self-assignment that returns the EXISTING row
// rather than re-arming it. That is correct for de-duplicating one queue run,
// but with a campaign-stable key it also meant a campaign whose job had reached
// 'succeeded' or exhausted max_attempts could never be queued again: the route
// answered 202 with the dead job's status and the UI reported success.
test("campaign delivery idempotency key is scoped to a queue run, not the campaign", async () => {
  const { campaignDeliveryIdempotencyKey } = await import("./jobs.ts");

  const campaign = "11111111-1111-4111-8111-111111111111";
  const firstRun = "2026-08-11T02:00:00.000Z";
  const secondRun = "2026-08-11T09:30:00.000Z";

  // Same run enqueued twice (admin button racing the send-queue cron) collapses
  // to one job -- this is what stops a campaign being delivered twice.
  assert.equal(
    campaignDeliveryIdempotencyKey(campaign, firstRun),
    campaignDeliveryIdempotencyKey(campaign, firstRun),
  );

  // A later re-queue of the same campaign is a DIFFERENT job.
  assert.notEqual(
    campaignDeliveryIdempotencyKey(campaign, firstRun),
    campaignDeliveryIdempotencyKey(campaign, secondRun),
  );

  assert.match(campaignDeliveryIdempotencyKey(campaign, firstRun), /^woztell\.campaign\.deliver:/);
});

// The two enqueue paths do NOT hand over the same string for the same row: the
// admin route passes the driver's Date via toISOString()
// ("2026-08-11T02:00:00.000Z"), while the send-queue cron reads
// timestamptz::text from Postgres ("2026-08-11 02:00:00+00", with microseconds).
// Interpolating those verbatim produced two different keys for ONE queue run,
// so both paths enqueued and the campaign was delivered twice -- billably, to
// real customers. The key normalises to epoch millis so representation drift on
// either side cannot resurrect that.
test("both enqueue paths derive the same key from the same queue run", async () => {
  const { campaignDeliveryIdempotencyKey } = await import("./jobs.ts");
  const campaign = "11111111-1111-4111-8111-111111111111";

  const fromAdminRoute = "2026-08-11T02:00:00.000Z";
  const fromCronSql = "2026-08-11 02:00:00+00";
  const fromCronSqlWithMicroseconds = "2026-08-11 02:00:00.000123+00";

  assert.equal(
    campaignDeliveryIdempotencyKey(campaign, fromAdminRoute),
    campaignDeliveryIdempotencyKey(campaign, fromCronSql),
  );
  assert.equal(
    campaignDeliveryIdempotencyKey(campaign, fromAdminRoute),
    campaignDeliveryIdempotencyKey(campaign, fromCronSqlWithMicroseconds),
  );

  // An unparseable value must not collapse every campaign onto one key, which
  // would silently suppress real enqueues.
  assert.notEqual(
    campaignDeliveryIdempotencyKey(campaign, "garbage"),
    campaignDeliveryIdempotencyKey(campaign, "other-garbage"),
  );
});

test("the send-queue cron falls back to an immutable timestamp, not updated_at", () => {
  const cron = readFileSync("src/routes/api.admin.jobs.send-queue.ts", "utf8");

  // saveAdminCampaign writes status unconditionally, so a campaign can be
  // 'queued' with reviewed_at still NULL. updated_at changes on every later
  // write and would hand the cron a fresh key -- and a fresh delivery job --
  // after any edit.
  assert.match(
    cron,
    /COALESCE\(campaign\.reviewed_at, campaign\.created_at\)::text AS queue_run_at/,
  );
  assert.doesNotMatch(cron, /COALESCE\(campaign\.reviewed_at, campaign\.updated_at\)/);
});

test("re-materializing a campaign never re-queues a possibly-delivered recipient", () => {
  const source = readFileSync("src/lib/neon/admin-data.server.ts", "utf8");
  const start = source.indexOf("INSERT INTO whatsapp_campaign_recipients (campaign_id");
  const clause = source.slice(
    start,
    source.indexOf("[campaignId, uniqueEligibleContactIds]", start),
  );

  assert.notEqual(start, -1);
  // WOZTELL_DELIVERY_UNKNOWN means the provider took the message but never
  // confirmed the outcome, so the customer may already have it. Re-queueing
  // sends (and bills) a second real WhatsApp message.
  assert.match(
    clause,
    /error = 'WOZTELL_DELIVERY_UNKNOWN'\s+THEN whatsapp_campaign_recipients\.status/,
  );
  assert.match(
    clause,
    /error = 'WOZTELL_DELIVERY_UNKNOWN'\s+THEN whatsapp_campaign_recipients\.error/,
  );
});

test("the queue flip re-asserts the same statuses canQueueAdminCampaign accepts", () => {
  const source = readFileSync("src/lib/neon/admin-data.server.ts", "utf8");
  const start = source.indexOf("UPDATE whatsapp_campaigns c\n      SET status = 'queued'");
  const clause = source.slice(start, source.indexOf("RETURNING c.id", start));

  assert.notEqual(start, -1);
  // Accepting 'draft' here contradicted the gate above it, so a concurrent
  // save-back-to-draft mid-queue still sent. Check the IN list itself rather
  // than the whole clause, which legitimately mentions 'draft' in a comment.
  const statusIn = clause.match(/AND c\.status IN \(([^)]*)\)/);
  assert.ok(statusIn, "queue flip must re-assert c.status");
  assert.equal(statusIn[1].trim(), "'review', 'scheduled'");
});

// Keyset cursors are built from a to_char(... 'US') column, not from the
// millisecond-truncated display value. Feeding a truncated timestamp back into
// `(created_at, id) < (...)` silently skipped every row whose true timestamp
// fell between the truncated and actual value -- audit entries and jobs
// vanished across page boundaries with no error.
test("keyset cursors carry microsecond precision, not truncated ISO strings", () => {
  const audit = readFileSync("src/lib/control-plane/audit.server.ts", "utf8");
  const jobs = readFileSync("src/lib/control-plane/jobs.server.ts", "utf8");

  for (const [name, source] of [
    ["audit.server.ts", audit],
    ["jobs.server.ts", jobs],
  ]) {
    assert.match(
      source,
      /to_char\(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS\.US"Z"'\) AS created_at_cursor/,
      `${name} must select a microsecond-precision cursor column`,
    );
    assert.match(source, /created_at_cursor/, `${name} must use that column for the cursor`);
  }

  // The cursor must not be rebuilt from the truncated display field.
  assert.doesNotMatch(audit, /encodeAuditCursor\(\{ createdAt: last\.created_at,/);
  assert.doesNotMatch(jobs, /encodeJobCursor\(\{ createdAt: last\.createdAt,/);
});
