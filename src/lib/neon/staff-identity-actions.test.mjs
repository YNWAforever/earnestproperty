import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "neon/migrations/20260816120000_staff_identity_actions.sql";
const storePath = "src/lib/neon/staff-identity-actions.server.ts";

function source(path) {
  return readFileSync(path, "utf8");
}

test("identity-action migration has the exact safe operation fields and constraints", () => {
  const migration = source(migrationPath);
  const table = migration.match(
    /CREATE TABLE IF NOT EXISTS staff_identity_actions\s*\(([^;]+)\);/is,
  )?.[1];

  assert.ok(table, "staff_identity_actions table must be declared");
  const columns = [...table.matchAll(/^\s*([a-z_]+)\s+(?:uuid|text|timestamptz)/gim)].map(
    ([, column]) => column,
  );
  assert.deepEqual(columns, [
    "id",
    "idempotency_key",
    "action",
    "actor_staff_id",
    "target_staff_id",
    "target_email",
    "state",
    "safe_error_code",
    "request_id",
    "retry_after",
    "provider_expires_at",
    "created_at",
    "updated_at",
  ]);
  assert.match(
    table,
    /CHECK\s*\(action IN \('invite', 'resend_invitation', 'password_reset', 'session_revocation'\)\)/,
  );
  assert.match(
    table,
    /CHECK\s*\(state IN \('pending', 'succeeded', 'retryable_failure', 'terminal_failure'\)\)/,
  );
  assert.match(table, /UNIQUE\s*\(idempotency_key\)/);
  assert.match(table, /actor_staff_id uuid REFERENCES staff_users\(id\) ON DELETE SET NULL/);
  assert.match(table, /target_staff_id uuid REFERENCES staff_users\(id\) ON DELETE SET NULL/);
  assert.match(table, /provider_expires_at timestamptz/);
  assert.match(migration, /ON staff_identity_actions \(target_staff_id, action, created_at DESC\)/);
  assert.match(migration, /WHERE state IN \('pending', 'retryable_failure'\)/);
  assert.match(migration, /REVOKE ALL ON TABLE staff_identity_actions FROM PUBLIC/);
});

test("identity-action SQL and store exclude provider secrets", () => {
  const implementation = `${source(migrationPath)}\n${source(storePath)}`;
  assert.doesNotMatch(implementation, /\bpassword(?!_reset\b)\b/i);
  assert.doesNotMatch(implementation, /\b(?:token|secret|cookie|raw_response|email_body)\b/i);
});
