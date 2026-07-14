import assert from "node:assert/strict";
import test from "node:test";

import { hasPermission } from "./permissions.ts";
import { errorResponse, mapControlPlaneError, successResponse } from "./errors.ts";
import { createOperationContext } from "./request-context.ts";
import { sanitizeAuditMetadata } from "./audit.server.ts";
import { aggregateHealth } from "./health.server.ts";
import {
  issueMigrationApproval,
  verifyMigrationApproval,
} from "./migration-approval.ts";
import {
  computeMigrationChecksum,
  listRegisteredMigrations,
} from "./migration-registry.server.ts";
import { applyMigration, planMigration } from "./migrations.server.ts";

test("permission matrix defaults to deny", () => {
  assert.equal(hasPermission(["agent"], "system.health.read"), true);
  assert.equal(hasPermission(["agent"], "system.jobs.retry"), false);
  assert.equal(hasPermission(["unknown"], "system.health.read"), false);
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

test("required failed checks make health failed while optional failures degrade", () => {
  assert.equal(
    aggregateHealth([
      { key: "database", required: true, status: "healthy" },
      { key: "woztell", required: false, status: "failed" },
    ]).status,
    "degraded",
  );
  assert.equal(
    aggregateHealth([
      { key: "database", required: true, status: "failed" },
    ]).status,
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
  const statements = [
    { statement: "SELECT $1::jsonb", params: [{ zebra: 1, alpha: [2, 3] }] },
  ];
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
  assert.equal(mapControlPlaneError({ code: "MIGRATION_APPROVAL_INVALID" }).code, "MIGRATION_APPROVAL_INVALID");
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
  assert.match(transactions[0].at(-2).statement, /INSERT INTO app_migrations/);
  assert.equal(audits.at(-1).outcome, "success");
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
