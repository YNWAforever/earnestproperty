import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.match(sql, /UNIQUE \(idempotency_key\)/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_ops_jobs_queue/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_ops_jobs_lease/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_ops_audit_logs_request_id/);
  assert.match(sql, /FOR EACH ROW EXECUTE FUNCTION prevent_ops_audit_mutation/);
  assert.match(sql, /END IF;\s*END\s*\$\$;/);
});

test("database helper uses Neon transaction batching", () => {
  const source = readFileSync("src/lib/neon/db.server.ts", "utf8");
  assert.match(source, /sql\.transaction\(/);
  assert.match(source, /tx\.query\(statement, params\)/);
});

test("control plane database integration requires TEST_DATABASE_URL", { skip: !process.env.TEST_DATABASE_URL }, () => {
  assert.ok(process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL must target a disposable test database");
});
