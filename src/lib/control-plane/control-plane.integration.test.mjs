import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const migrationPath = "neon/migrations/20260714180000_backend_control_plane.sql";

test("control plane migration creates durable operations tables", () => {
  const sql = readFileSync(migrationPath, "utf8");

  for (const table of ["ops_audit_logs", "ops_jobs", "ops_job_attempts", "ops_migration_runs"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }

  assert.match(sql, /CHECK \(outcome IN \('success', 'failure', 'denied'\)\)/);
  assert.match(sql, /CHECK \(payload_version > 0\)/);
  assert.match(sql, /CHECK \(status IN \('queued', 'running', 'succeeded', 'failed', 'cancelled'\)\)/);
  assert.match(sql, /CHECK \(attempt_count >= 0\)/);
  assert.match(sql, /CHECK \(max_attempts > 0\)/);
  assert.match(sql, /UNIQUE \(idempotency_key\)/);
  assert.match(sql, /CHECK \(attempt_number > 0\)/);
  assert.match(sql, /CHECK \(outcome IN \('succeeded', 'failed', 'cancelled'\)\)/);
  assert.match(sql, /UNIQUE \(job_id, attempt_number\)/);
  assert.match(sql, /CHECK \(result IN \('succeeded', 'failed'\)\)/);
  for (const index of [
    "idx_ops_jobs_queue",
    "idx_ops_jobs_lease",
    "idx_ops_audit_logs_request_id",
    "idx_ops_audit_logs_created_at",
    "idx_ops_job_attempts_job_id",
    "idx_ops_migration_runs_request_id",
    "idx_ops_migration_runs_migration_id",
  ]) {
    assert.match(sql, new RegExp(`CREATE INDEX IF NOT EXISTS ${index}`));
  }
  assert.match(sql, /FOR EACH ROW EXECUTE FUNCTION prevent_ops_audit_mutation/);
  assert.match(sql, /END IF;\s*END\s*\$\$;/);
});

test("database helper uses Neon transaction batching", () => {
  const source = readFileSync("src/lib/neon/db.server.ts", "utf8");
  assert.match(source, /sql\.transaction\(/);
  assert.match(source, /tx\.query\(statement, params\)/);
});

test("control plane migration applies and protects audit rows in a disposable database", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const databaseEnv = { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL };
  delete databaseEnv.DATABASE_URL_UNPOOLED;
  const migrationRun = spawnSync(process.execPath, ["scripts/neon/apply-migrations.mjs"], {
    env: databaseEnv,
    encoding: "utf8",
  });
  assert.equal(migrationRun.status, 0, migrationRun.stderr || migrationRun.stdout);

  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousUnpooledUrl = process.env.DATABASE_URL_UNPOOLED;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  delete process.env.DATABASE_URL_UNPOOLED;

  try {
    const { queryRows, transactionRows } = await import("../neon/db.server.ts");
    const { listAuditLogs, writeAudit } = await import("./audit.server.ts");
    for (const table of ["ops_audit_logs", "ops_jobs", "ops_job_attempts", "ops_migration_runs"]) {
      const rows = await queryRows("SELECT to_regclass($1)::text AS name", [table]);
      assert.equal(rows[0]?.name, table);
    }

    const requestId = crypto.randomUUID();
    const staffRows = await queryRows(
      `INSERT INTO staff_users (email, name_en)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET name_en = EXCLUDED.name_en
       RETURNING id::text AS id`,
      [`control-plane-${requestId}@example.test`, "Control Plane Test"],
    );
    const actor = {
      staffId: staffRows[0].id,
      authUserId: `test-${requestId}`,
      email: `control-plane-${requestId}@example.test`,
      name: "Control Plane Test",
      roles: ["admin"],
      bootstrap: false,
    };
    await writeAudit({
      actor,
      permission: "system.health.read",
      action: "test.audit",
      outcome: "success",
      context: { requestId, startedAt: new Date().toISOString() },
      metadata: { title: "visible", token: "hidden" },
    });

    const logs = await listAuditLogs({ limit: 100 });
    const auditLog = logs.find((row) => row.request_id === requestId);
    assert.ok(auditLog);
    assert.equal(auditLog.metadata.title, "visible");
    assert.equal(auditLog.metadata.token, "[REDACTED]");
    await assert.rejects(
      () => queryRows("UPDATE ops_audit_logs SET action = $1 WHERE request_id = $2::uuid", ["changed", requestId]),
      /append-only/i,
    );
    await assert.rejects(
      () => queryRows("DELETE FROM ops_audit_logs WHERE request_id = $1::uuid", [requestId]),
      /append-only/i,
    );

    const transactionResult = await transactionRows([{ statement: "SELECT 1::integer AS value" }]);
    assert.equal(transactionResult[0]?.[0]?.value, 1);
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousUnpooledUrl === undefined) delete process.env.DATABASE_URL_UNPOOLED;
    else process.env.DATABASE_URL_UNPOOLED = previousUnpooledUrl;
  }
});
