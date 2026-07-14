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
    for (const table of ["ops_audit_logs", "ops_jobs", "ops_job_attempts", "ops_migration_runs"]) {
      const rows = await queryRows("SELECT to_regclass($1)::text AS name", [table]);
      assert.equal(rows[0]?.name, table);
    }

    const requestId = crypto.randomUUID();
    await queryRows(
      `INSERT INTO ops_audit_logs (permission, action, outcome, request_id, metadata)
       VALUES ($1, $2, $3, $4::uuid, $5::jsonb)`,
      ["system.health.read", "test", "success", requestId, JSON.stringify({ ok: true })],
    );
    await assert.rejects(
      () => queryRows("UPDATE ops_audit_logs SET action = $1 WHERE request_id = $2::uuid", ["changed", requestId]),
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
