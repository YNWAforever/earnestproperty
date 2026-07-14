# Backend Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-party backend control plane that centralizes staff permissions, schema health, migration approval, audit records, retryable jobs, and stable operational errors for the Earnest Property admin system.

**Architecture:** Add a focused `src/lib/control-plane/` modular-monolith boundary inside the existing TanStack Start application. Neon remains the durable store; thin file routes authenticate and authorize before calling typed services. The initial `ops_*` schema is bootstrapped through the existing CLI migration runner, after which registered application migrations and jobs are managed through the control plane.

**Tech Stack:** TypeScript 5.8, TanStack Start/Router 1.167+, Neon Postgres via `@neondatabase/serverless` 1.1, Node 22 test runner, Web Crypto, Zod 3.24.

## Global Constraints

- Keep the existing `admin`, `manager`, and `agent` roles; authorization decisions use permissions and default deny.
- Never accept SQL text from an HTTP request or admin form.
- Never run production migrations automatically during deployment.
- Every protected write returns and audits a request ID.
- Never persist secrets, tokens, raw SQL errors, stack traces, full phone numbers, complete customer records, or full AI prompts in operations metadata.
- Every enqueue operation requires an idempotency key.
- Production smoke verification is read-only; applying a production migration requires separate explicit user approval.
- Use test-driven development: observe the expected failing test before writing production code.
- Do not refactor unrelated CMS, CRM, AI, or WozTell code.

---

## File Map

**Create**

- `src/lib/control-plane/permissions.ts`: permission names, role matrix, and permission guard adapter.
- `src/lib/control-plane/errors.ts`: stable error catalog and response envelopes.
- `src/lib/control-plane/request-context.ts`: request ID creation and typed operation context.
- `src/lib/control-plane/audit.server.ts`: metadata sanitization, append-only audit writes, and audit queries.
- `src/lib/control-plane/health.server.ts`: schema, environment, and integration readiness checks.
- `src/lib/control-plane/migration-approval.ts`: signed short-lived approval token issue and verification.
- `src/lib/control-plane/migration-registry.server.ts`: immutable migration registry and checksums.
- `src/lib/control-plane/migrations.server.ts`: migration plan/apply orchestration.
- `src/lib/control-plane/jobs.ts`: pure job state machine and retry policy.
- `src/lib/control-plane/jobs.server.ts`: enqueue, lease, complete, fail, retry, cancel, and recover operations.
- `src/lib/control-plane/job-handlers.server.ts`: versioned handler registry.
- `src/lib/control-plane/control-plane.test.mjs`: pure permission, error, approval, and job tests.
- `src/lib/control-plane/control-plane.integration.test.mjs`: Neon integration tests gated by `TEST_DATABASE_URL`.
- `src/routes/control-plane.routes.test.mjs`: API route contract regression tests.
- `src/routes/api.admin.control-plane.health.ts`: health endpoint.
- `src/routes/api.admin.control-plane.migrations.ts`: migration listing endpoint.
- `src/routes/api.admin.control-plane.migrations.$id.plan.ts`: migration plan endpoint.
- `src/routes/api.admin.control-plane.migrations.$id.apply.ts`: migration apply endpoint.
- `src/routes/api.admin.control-plane.jobs.ts`: job listing endpoint.
- `src/routes/api.admin.control-plane.jobs.$id.retry.ts`: manual retry endpoint.
- `src/routes/api.admin.control-plane.jobs.$id.cancel.ts`: cancellation endpoint.
- `src/routes/api.admin.control-plane.audit.ts`: audit listing endpoint.
- `src/routes/api.admin.control-plane.worker.ts`: cron-protected generic worker endpoint.
- `neon/migrations/20260714180000_backend_control_plane.sql`: bootstrap operations schema.

**Modify**

- `src/lib/neon/db.server.ts`: add typed Neon transaction support.
- `src/lib/neon/auth.server.ts`: retain role authentication and expose it through the new permission guard without changing login behavior.
- `src/routes/api.admin.ai.rebuild-knowledge.ts`: enqueue the knowledge rebuild job.
- `src/routes/api.admin.jobs.send-queue.ts`: delegate campaign delivery to the control-plane job adapter while keeping the existing cron contract during rollout.
- `src/lib/ai/knowledge.server.ts`: export the existing rebuild operation behind a job handler-compatible function.
- `src/lib/woztell/woztell.server.ts`: expose the existing send operation behind a job handler-compatible function.
- `src/routes/admin.routes.test.mjs`: register the new API route source contracts if this remains the repository-wide route inventory.
- `package.json`: add focused control-plane test scripts.

---

### Task 1: Central Permission Matrix And Error Envelope

**Files:**
- Create: `src/lib/control-plane/permissions.ts`
- Create: `src/lib/control-plane/errors.ts`
- Create: `src/lib/control-plane/request-context.ts`
- Create: `src/lib/control-plane/control-plane.test.mjs`

**Interfaces:**
- Consumes: `StaffAccess`, `StaffRole`, and `requireStaffAccess(request, allowedRoles)` from `src/lib/neon/auth.server.ts`.
- Produces: `ControlPlanePermission`, `hasPermission`, `requireStaffPermission`, `mapControlPlaneError`, `successResponse`, `errorResponse`, and `createOperationContext`.

- [ ] **Step 1: Write failing permission and error tests**

```js
import assert from "node:assert/strict";
import test from "node:test";

import { hasPermission } from "./permissions.ts";
import { mapControlPlaneError } from "./errors.ts";

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
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test src/lib/control-plane/control-plane.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `permissions.ts` or `errors.ts`.

- [ ] **Step 3: Implement the permission matrix**

```ts
import type { StaffAccess, StaffRole } from "@/lib/neon/auth.server";
import { requireStaffAccess } from "@/lib/neon/auth.server";

export const controlPlanePermissions = [
  "ai.draft.generate",
  "ai.knowledge.rebuild",
  "campaign.queue",
  "cms.publish",
  "system.health.read",
  "system.jobs.read",
  "system.jobs.retry",
  "system.jobs.cancel",
  "system.migrations.plan",
  "system.migrations.apply",
  "staff.manage",
  "audit.read",
] as const;

export type ControlPlanePermission = (typeof controlPlanePermissions)[number];

const rolePermissions: Record<StaffRole, ReadonlySet<ControlPlanePermission>> = {
  agent: new Set(["ai.draft.generate", "system.health.read"]),
  manager: new Set([
    "ai.draft.generate",
    "ai.knowledge.rebuild",
    "campaign.queue",
    "cms.publish",
    "system.health.read",
    "system.jobs.read",
    "system.jobs.retry",
    "system.jobs.cancel",
    "audit.read",
  ]),
  admin: new Set(controlPlanePermissions),
};

export function hasPermission(roles: readonly string[], permission: ControlPlanePermission) {
  return roles.some((role) =>
    role === "admin" || role === "manager" || role === "agent"
      ? rolePermissions[role].has(permission)
      : false,
  );
}

export async function requireStaffPermission(
  request: Request,
  permission: ControlPlanePermission,
): Promise<StaffAccess> {
  const staff = await requireStaffAccess(request, ["admin", "manager", "agent"]);
  if (!hasPermission(staff.roles, permission)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return staff;
}
```

- [ ] **Step 4: Implement stable errors, envelopes, and request context**

```ts
export type ControlPlaneErrorCode =
  | "SCHEMA_RELATION_MISSING"
  | "SCHEMA_COLUMN_MISSING"
  | "CONFLICT_DUPLICATE"
  | "INTEGRATION_TIMEOUT"
  | "PERMISSION_DENIED"
  | "MIGRATION_APPROVAL_INVALID"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR";

export type PublicControlPlaneError = {
  code: ControlPlaneErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export function mapControlPlaneError(error: unknown): PublicControlPlaneError {
  if (error instanceof Response && error.status === 403) {
    return { code: "PERMISSION_DENIED", message: "You do not have permission for this operation.", retryable: false };
  }
  const code =
    error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "42P01") return { code: "SCHEMA_RELATION_MISSING", message: "A required database relation is missing.", retryable: false };
  if (code === "42703") return { code: "SCHEMA_COLUMN_MISSING", message: "A required database column is missing.", retryable: false };
  if (code === "23505") return { code: "CONFLICT_DUPLICATE", message: "The operation conflicts with existing data.", retryable: false };
  return { code: "INTERNAL_ERROR", message: "The operation could not be completed.", retryable: false };
}

export function successResponse<T>(data: T, requestId: string, status = 200) {
  return Response.json({ ok: true as const, data, requestId }, { status });
}

export function errorResponse(error: unknown, requestId: string, status = 500) {
  return Response.json({ ok: false as const, error: mapControlPlaneError(error), requestId }, { status });
}
```

```ts
export type OperationContext = { requestId: string; startedAt: string };

export function createOperationContext(): OperationContext {
  return { requestId: crypto.randomUUID(), startedAt: new Date().toISOString() };
}
```

- [ ] **Step 5: Run tests and verify GREEN**

Run: `node --test src/lib/control-plane/control-plane.test.mjs`

Expected: all Task 1 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/control-plane
git commit -m "feat: add control plane permission and error foundation"
```

---

### Task 2: Operations Schema And Transaction Helper

**Files:**
- Create: `neon/migrations/20260714180000_backend_control_plane.sql`
- Modify: `src/lib/neon/db.server.ts`
- Create: `src/lib/control-plane/control-plane.integration.test.mjs`

**Interfaces:**
- Consumes: `getSql()` from `src/lib/neon/db.server.ts`.
- Produces: `transactionRows(statements, options?)` and the four `ops_*` tables.

- [ ] **Step 1: Write a failing schema contract test**

Add a test that reads the migration and asserts all tables, checks, unique idempotency, indexes, and append-only audit trigger exist.

```js
import { readFileSync } from "node:fs";

test("control plane migration creates durable operations tables", () => {
  const sql = readFileSync("neon/migrations/20260714180000_backend_control_plane.sql", "utf8");
  for (const table of ["ops_audit_logs", "ops_jobs", "ops_job_attempts", "ops_migration_runs"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /UNIQUE \(idempotency_key\)/);
  assert.match(sql, /FOR EACH ROW EXECUTE FUNCTION prevent_ops_audit_mutation/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test src/lib/control-plane/control-plane.integration.test.mjs`

Expected: FAIL with `ENOENT` for the migration file.

- [ ] **Step 3: Create the bootstrap migration**

The migration must define:

```sql
CREATE TABLE IF NOT EXISTS ops_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_staff_id uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  permission text NOT NULL,
  action text NOT NULL,
  resource_type text,
  resource_id text,
  outcome text NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
  request_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  payload_version integer NOT NULL CHECK (payload_version > 0),
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  run_after timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_summary text,
  idempotency_key text NOT NULL,
  actor_staff_id uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);
```

Also add `ops_job_attempts`, `ops_migration_runs`, queue/run indexes, request ID indexes, and a `BEFORE UPDATE OR DELETE` trigger that raises an exception for `ops_audit_logs`.

- [ ] **Step 4: Add a transaction helper supported by the installed Neon driver**

```ts
export type TransactionStatement = { statement: string; params?: unknown[] };

export async function transactionRows(
  statements: readonly TransactionStatement[],
  options: { isolationLevel?: "ReadUncommitted" | "ReadCommitted" | "RepeatableRead" | "Serializable" } = {},
) {
  const sql = getSql();
  return sql.transaction(
    (tx) => statements.map(({ statement, params = [] }) => tx.query(statement, params)),
    options,
  );
}
```

- [ ] **Step 5: Verify the migration contract and optional test database**

Run: `node --test src/lib/control-plane/control-plane.integration.test.mjs`

Expected without `TEST_DATABASE_URL`: schema contract PASS and database test SKIP with an explicit reason.

Run with test Neon: `$env:TEST_DATABASE_URL='<test-only-url>'; node --test src/lib/control-plane/control-plane.integration.test.mjs`

Expected: migration applies, all four tables exist, and updating an audit row fails.

- [ ] **Step 6: Commit**

```bash
git add neon/migrations/20260714180000_backend_control_plane.sql src/lib/neon/db.server.ts src/lib/control-plane/control-plane.integration.test.mjs
git commit -m "feat: add control plane operations schema"
```

---

### Task 3: Sanitized Append-Only Audit Service

**Files:**
- Create: `src/lib/control-plane/audit.server.ts`
- Modify: `src/lib/control-plane/control-plane.test.mjs`
- Modify: `src/lib/control-plane/control-plane.integration.test.mjs`

**Interfaces:**
- Consumes: `queryRows`, `StaffAccess`, `ControlPlanePermission`, and `OperationContext`.
- Produces: `sanitizeAuditMetadata`, `writeAudit`, and `listAuditLogs`.

- [ ] **Step 1: Write failing metadata-redaction tests**

```js
test("audit metadata recursively removes sensitive values", () => {
  assert.deepEqual(
    sanitizeAuditMetadata({ token: "secret", phone: "91234567", nested: { title: "ok", password: "x" } }),
    { token: "[REDACTED]", phone: "[REDACTED]", nested: { title: "ok", password: "[REDACTED]" } },
  );
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test src/lib/control-plane/control-plane.test.mjs`

Expected: FAIL because `sanitizeAuditMetadata` is missing.

- [ ] **Step 3: Implement sanitizer and audit persistence**

Use a case-insensitive denylist containing `token`, `secret`, `password`, `authorization`, `cookie`, `phone`, `prompt`, `sql`, and `stack`. Limit arrays to 50 items, object depth to 5, and string length to 500 characters.

```ts
export async function writeAudit(input: {
  actor: StaffAccess;
  permission: ControlPlanePermission;
  action: string;
  resourceType?: string;
  resourceId?: string;
  outcome: "success" | "failure" | "denied";
  context: OperationContext;
  metadata?: Record<string, unknown>;
}) {
  await queryRows(
    `INSERT INTO ops_audit_logs
      (actor_staff_id, permission, action, resource_type, resource_id, outcome, request_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, $8::jsonb)`,
    [input.actor.staffId, input.permission, input.action, input.resourceType ?? null,
     input.resourceId ?? null, input.outcome, input.context.requestId,
     JSON.stringify(sanitizeAuditMetadata(input.metadata ?? {}))],
  );
}
```

- [ ] **Step 4: Add audit database tests**

Insert one audit record, read it through `listAuditLogs({ limit: 20 })`, verify request ID and redaction, then assert update/delete fail.

- [ ] **Step 5: Run pure and integration tests**

Run: `node --test src/lib/control-plane/control-plane.test.mjs`

Run with test Neon: `node --test src/lib/control-plane/control-plane.integration.test.mjs`

Expected: all audit tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/control-plane/audit.server.ts src/lib/control-plane/*.test.mjs
git commit -m "feat: add sanitized control plane audit log"
```

---

### Task 4: Read-Only Backend Health Service And Route

**Files:**
- Create: `src/lib/control-plane/health.server.ts`
- Create: `src/routes/api.admin.control-plane.health.ts`
- Create: `src/routes/control-plane.routes.test.mjs`
- Modify: `src/lib/control-plane/control-plane.test.mjs`

**Interfaces:**
- Consumes: `requireStaffPermission`, `createOperationContext`, `successResponse`, `errorResponse`, `queryRows`.
- Produces: `runControlPlaneHealthChecks()` and `GET /api/admin/control-plane/health`.

- [ ] **Step 1: Write failing pure health aggregation tests**

```js
test("required failed checks make health failed while optional failures degrade", () => {
  assert.equal(aggregateHealth([
    { key: "database", required: true, status: "healthy" },
    { key: "woztell", required: false, status: "failed" },
  ]).status, "degraded");
  assert.equal(aggregateHealth([
    { key: "database", required: true, status: "failed" },
  ]).status, "failed");
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test src/lib/control-plane/control-plane.test.mjs`

Expected: FAIL because `aggregateHealth` is missing.

- [ ] **Step 3: Implement health checks**

Query `information_schema.tables` and `information_schema.columns` once each. Check required tables `app_migrations`, `staff_users`, `staff_roles`, `ops_audit_logs`, `ops_jobs`, `ops_job_attempts`, and `ops_migration_runs`. Check required job and audit columns. Return environment checks as booleans only; never return values. Treat `CONTROL_PLANE_APPROVAL_SECRET` as required for migration planning and applying, but return only its presence state.

Integration readiness:

- AI is `healthy` when its configured provider and required provider key are present, otherwise `degraded`.
- WozTell is `healthy` only when enabled and required server variables are present, `degraded` when disabled, and `failed` when enabled but incomplete.
- Cron is `healthy` when `CRON_SECRET` exists, otherwise `degraded`.

- [ ] **Step 4: Add the authenticated route**

```ts
export const Route = createFileRoute("/api/admin/control-plane/health")({
  server: { handlers: { GET: async ({ request }) => {
    const context = createOperationContext();
    try {
      await requireStaffPermission(request, "system.health.read");
      return successResponse(await runControlPlaneHealthChecks(), context.requestId);
    } catch (error) {
      const status = error instanceof Response ? error.status : 500;
      return errorResponse(error, context.requestId, status);
    }
  } } },
});
```

- [ ] **Step 5: Add route source-contract tests**

Assert the route requests `system.health.read`, uses `runControlPlaneHealthChecks`, returns typed envelopes, and never serializes `process.env`.

- [ ] **Step 6: Run tests and build**

Run: `node --test src/lib/control-plane/control-plane.test.mjs src/routes/control-plane.routes.test.mjs`

Run: `npm.cmd run build`

Expected: tests PASS and build exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/control-plane/health.server.ts src/routes/api.admin.control-plane.health.ts src/routes/control-plane.routes.test.mjs src/lib/control-plane/control-plane.test.mjs src/routeTree.gen.ts
git commit -m "feat: expose backend health diagnostics"
```

---

### Task 5: Migration Registry And Short-Lived Approval Tokens

**Files:**
- Create: `src/lib/control-plane/migration-approval.ts`
- Create: `src/lib/control-plane/migration-registry.server.ts`
- Create: `src/lib/control-plane/migrations.server.ts`
- Modify: `src/lib/control-plane/control-plane.test.mjs`
- Modify: `src/lib/control-plane/control-plane.integration.test.mjs`

**Interfaces:**
- Produces: `RegisteredMigration`, `listRegisteredMigrations`, `planMigration`, `issueMigrationApproval`, `verifyMigrationApproval`, and `applyMigration`.
- Consumes: `transactionRows`, `writeAudit`, `StaffAccess`, and `OperationContext`.

- [ ] **Step 1: Write failing approval binding tests**

Use a fixed clock and secret. Assert a token verifies only for the same migration ID, checksum, schema fingerprint, actor, and unexpired timestamp. Assert tampering and expiry return `MIGRATION_APPROVAL_INVALID`.

```js
test("migration approval is bound to actor, checksum, schema and expiry", async () => {
  const input = {
    migrationId: "20260715090000_test",
    checksum: "sha256:test",
    schemaFingerprint: "schema:test",
    actorStaffId: "staff-1",
  };
  const issueDeps = { secret: "test-secret", now: () => 1_000 };
  const validVerifyDeps = { secret: "test-secret", now: () => 1_030 };
  const token = await issueMigrationApproval(input, issueDeps);
  assert.equal((await verifyMigrationApproval(token, input, validVerifyDeps)).ok, true);
  assert.equal(
    (await verifyMigrationApproval(token, { ...input, actorStaffId: "other" }, validVerifyDeps)).ok,
    false,
  );
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test src/lib/control-plane/control-plane.test.mjs`

Expected: FAIL because approval functions are missing.

- [ ] **Step 3: Implement HMAC approval tokens**

Serialize a versioned payload with stable key order, sign it using Web Crypto `HMAC` + `SHA-256`, and encode payload/signature as base64url. Verify using `crypto.subtle.verify`, not string equality. Read the server-only signing secret from `CONTROL_PLANE_APPROVAL_SECRET`; fail closed when it is absent. Default TTL is 300 seconds.

- [ ] **Step 4: Implement immutable registry and schema fingerprint**

```ts
export type RegisteredMigration = {
  id: string;
  checksum: string;
  dependencies: readonly string[];
  summary: string;
  statements: readonly { statement: string; params?: readonly unknown[] }[];
  postconditions: readonly { relation: string; column?: string }[];
};
```

Registry IDs and declared checksums are constants in source control. `computeMigrationChecksum(statements)` hashes a stable serialization of each statement and parameter list; registry loading fails when the computed value differs from the declaration. `planMigration` compares `app_migrations`, `ops_migration_runs`, registry dependencies, and a SHA-256 schema fingerprint derived from sorted required relation/column names. It returns a token only when all preconditions pass.

- [ ] **Step 5: Implement apply with immediate revalidation**

`applyMigration` must:

1. Recompute the schema fingerprint.
2. Verify the signed approval against actor, migration, checksum, and fingerprint.
3. Recheck dependencies and applied state.
4. Execute registered statements, insert the migration ID into `app_migrations`, and insert the `ops_migration_runs` success record in one Neon HTTP transaction.
5. Write a sanitized audit result.
6. On failure, insert a failure run outside the rolled-back transaction and write a failure audit.

- [ ] **Step 6: Add migration integration tests**

Use a test-only registered migration that creates an isolated temporary relation. Verify plan, stale-token rejection, single apply, duplicate apply rejection, and success/failure run recording.

- [ ] **Step 7: Run tests**

Run: `node --test src/lib/control-plane/control-plane.test.mjs`

Run with test Neon: `node --test src/lib/control-plane/control-plane.integration.test.mjs`

Expected: all migration tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/control-plane/migration-approval.ts src/lib/control-plane/migration-registry.server.ts src/lib/control-plane/migrations.server.ts src/lib/control-plane/*.test.mjs
git commit -m "feat: add approved migration execution service"
```

---

### Task 6: Migration And Audit API Routes

**Files:**
- Create: `src/routes/api.admin.control-plane.migrations.ts`
- Create: `src/routes/api.admin.control-plane.migrations.$id.plan.ts`
- Create: `src/routes/api.admin.control-plane.migrations.$id.apply.ts`
- Create: `src/routes/api.admin.control-plane.audit.ts`
- Modify: `src/routes/control-plane.routes.test.mjs`

**Interfaces:**
- Consumes: `listRegisteredMigrations`, `planMigration`, `applyMigration`, `listAuditLogs`, permission guard, envelopes, and operation context.
- Produces: the migration and audit endpoints approved in the design.

- [ ] **Step 1: Write failing route contracts**

Assert exact permissions:

- list migrations and plan: `system.migrations.plan`
- apply: `system.migrations.apply`
- audit: `audit.read`

Assert plan/apply use Zod bodies and no route accepts `sql`, `statement`, or `query` input keys.

- [ ] **Step 2: Run and verify RED**

Run: `node --test src/routes/control-plane.routes.test.mjs`

Expected: FAIL because route files do not exist.

- [ ] **Step 3: Implement list and plan routes**

Plan body schema:

```ts
const planSchema = z.object({}).strict();
```

The migration ID comes only from the registered route parameter. Return 404 for unknown IDs, 409 for drift or already-applied conflicts, and 200 for a successful plan.

- [ ] **Step 4: Implement apply route**

```ts
const applySchema = z.object({ approvalToken: z.string().min(20) }).strict();
```

Reauthenticate with `system.migrations.apply`, call `applyMigration`, and return 409 for invalid/stale approval or schema drift. Never log the token.

- [ ] **Step 5: Implement paginated audit route**

Accept only `cursor`, `limit` (1-100), `outcome`, `action`, and `requestId`. Use keyset pagination by `(created_at, id)` and return sanitized rows.

- [ ] **Step 6: Run route tests and build**

Run: `node --test src/routes/control-plane.routes.test.mjs`

Run: `npm.cmd run build`

Expected: route tests PASS and build exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/routes/api.admin.control-plane.* src/routes/control-plane.routes.test.mjs src/routeTree.gen.ts
git commit -m "feat: expose migration and audit control APIs"
```

---

### Task 7: Pure Retryable Job State Machine

**Files:**
- Create: `src/lib/control-plane/jobs.ts`
- Modify: `src/lib/control-plane/control-plane.test.mjs`

**Interfaces:**
- Produces: `JobStatus`, `retryDelayMs`, `jobFailureTransition`, `manualRetryTransition`, and `canCancelJob`.

- [ ] **Step 1: Write failing state-transition tests**

```js
test("retryable failures back off and exhausted failures stop", () => {
  assert.deepEqual(jobFailureTransition({ attemptCount: 1, maxAttempts: 3, retryable: true, nowMs: 1_000 }), {
    status: "queued", runAfterMs: 3_000,
  });
  assert.deepEqual(jobFailureTransition({ attemptCount: 3, maxAttempts: 3, retryable: true, nowMs: 1_000 }), {
    status: "failed", runAfterMs: null,
  });
});

test("manual retry grants exactly one additional attempt", () => {
  assert.deepEqual(manualRetryTransition({ status: "failed", attemptCount: 5, maxAttempts: 5 }), {
    status: "queued", maxAttempts: 6,
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test src/lib/control-plane/control-plane.test.mjs`

Expected: FAIL because `jobs.ts` is missing.

- [ ] **Step 3: Implement deterministic transitions**

Use bounded exponential backoff `min(2 ** attemptCount * 1000, 15 * 60 * 1000)`. Do not use random jitter in the pure state function; a worker may add injected jitter later. Allow cancel for `queued`, `running`, and `failed`; never transition `succeeded` back to work.

- [ ] **Step 4: Run and verify GREEN**

Run: `node --test src/lib/control-plane/control-plane.test.mjs`

Expected: all job state tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/control-plane/jobs.ts src/lib/control-plane/control-plane.test.mjs
git commit -m "feat: define retryable job state machine"
```

---

### Task 8: Durable Job Repository And Worker

**Files:**
- Create: `src/lib/control-plane/jobs.server.ts`
- Create: `src/lib/control-plane/job-handlers.server.ts`
- Create: `src/routes/api.admin.control-plane.worker.ts`
- Modify: `src/lib/control-plane/control-plane.integration.test.mjs`

**Interfaces:**
- Produces: `enqueueJob`, `claimJobs`, `completeJob`, `failJob`, `retryJob`, `cancelJob`, `recoverExpiredLeases`, `runClaimedJobs`, and `registerJobHandler`.
- Handler contract: `JobHandler<T> = { jobType: string; payloadVersion: number; parsePayload(input: unknown): T; run(payload: T, context: { jobId: string; attempt: number }): Promise<{ summary: Record<string, number> }> }`.

- [ ] **Step 1: Write failing idempotency and leasing integration tests**

Verify two concurrent `enqueueJob` calls with one idempotency key return the same ID. Verify two workers claiming concurrently receive disjoint job IDs. Verify an expired lease becomes claimable and a live lease does not.

- [ ] **Step 2: Run and verify RED**

Run with test Neon: `node --test src/lib/control-plane/control-plane.integration.test.mjs`

Expected: FAIL because the job repository is missing.

- [ ] **Step 3: Implement idempotent enqueue**

Use `INSERT ... ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key RETURNING *`. Validate job type and payload version against the handler registry before inserting.

- [ ] **Step 4: Implement atomic lease claim**

Use one CTE statement:

```sql
WITH candidates AS (
  SELECT id
  FROM ops_jobs
  WHERE status = 'queued' AND run_after <= now()
  ORDER BY run_after, created_at
  FOR UPDATE SKIP LOCKED
  LIMIT $1
)
UPDATE ops_jobs AS job
SET status = 'running',
    attempt_count = attempt_count + 1,
    lease_owner = $2,
    lease_expires_at = now() + ($3::integer * interval '1 second'),
    updated_at = now()
FROM candidates
WHERE job.id = candidates.id
RETURNING job.*;
```

- [ ] **Step 5: Implement guarded completion, failure, retry, cancel, and recovery**

Worker completion/failure updates must include `WHERE status = 'running' AND lease_owner = $worker`. Cancellation clears lease fields; a cancelled running job cannot later be marked succeeded by its former worker. Every attempt inserts one immutable `ops_job_attempts` row.

- [ ] **Step 6: Implement cron-protected worker route**

Require `Authorization: Bearer ${CRON_SECRET}` exactly as the existing send-queue route does. Return counts only: `claimed`, `succeeded`, `retried`, `failed`, and `cancelled`. Do not expose payloads or errors.

- [ ] **Step 7: Run integration and route tests**

Run with test Neon: `node --test src/lib/control-plane/control-plane.integration.test.mjs`

Run: `node --test src/routes/control-plane.routes.test.mjs`

Expected: concurrency, leasing, cancellation, and worker contract tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/control-plane/jobs.server.ts src/lib/control-plane/job-handlers.server.ts src/routes/api.admin.control-plane.worker.ts src/lib/control-plane/control-plane.integration.test.mjs src/routes/control-plane.routes.test.mjs src/routeTree.gen.ts
git commit -m "feat: add durable control plane job worker"
```

---

### Task 9: Job Management API Routes

**Files:**
- Create: `src/routes/api.admin.control-plane.jobs.ts`
- Create: `src/routes/api.admin.control-plane.jobs.$id.retry.ts`
- Create: `src/routes/api.admin.control-plane.jobs.$id.cancel.ts`
- Modify: `src/routes/control-plane.routes.test.mjs`

**Interfaces:**
- Consumes: job repository, audit service, permission guard, operation context, and envelopes.
- Produces: paginated list, manual retry, and cancel APIs.

- [ ] **Step 1: Write failing route permission and validation tests**

Assert list uses `system.jobs.read`, retry uses `system.jobs.retry`, cancel uses `system.jobs.cancel`, IDs are UUIDs, bodies are strict empty objects, and payloads are not returned by default.

- [ ] **Step 2: Run and verify RED**

Run: `node --test src/routes/control-plane.routes.test.mjs`

Expected: FAIL because the job management routes are missing.

- [ ] **Step 3: Implement list route**

Allow filters `status`, `jobType`, `cursor`, and `limit` (1-100). Return safe summaries with no payload, phone, prompt, provider token, or raw error.

- [ ] **Step 4: Implement retry and cancel routes**

Both commands create an operation context, require permission, execute the guarded state transition, write success/failure audit records, and return 409 when the current state rejects the transition.

- [ ] **Step 5: Run tests and build**

Run: `node --test src/routes/control-plane.routes.test.mjs`

Run: `npm.cmd run build`

Expected: tests PASS and build exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/routes/api.admin.control-plane.jobs* src/routes/control-plane.routes.test.mjs src/routeTree.gen.ts
git commit -m "feat: add job recovery control APIs"
```

---

### Task 10: AI Knowledge Rebuild Adapter

**Files:**
- Modify: `src/lib/ai/knowledge.server.ts`
- Modify: `src/routes/api.admin.ai.rebuild-knowledge.ts`
- Modify: `src/lib/control-plane/job-handlers.server.ts`
- Modify: `src/lib/control-plane/control-plane.test.mjs`
- Modify: `src/routes/control-plane.routes.test.mjs`

**Interfaces:**
- Produces handler `ai.knowledge.rebuild@1` with payload `{ requestedByStaffId: string }`.
- Consumes existing knowledge rebuild implementation and `enqueueJob`.

- [ ] **Step 1: Write failing adapter tests**

Assert the route enqueues job type `ai.knowledge.rebuild`, payload version `1`, and an idempotency key scoped to the active rebuild window. Assert the handler delegates to the existing rebuild function and maps provider timeouts as retryable.

- [ ] **Step 2: Run and verify RED**

Run: `node --test src/lib/control-plane/control-plane.test.mjs src/routes/control-plane.routes.test.mjs`

Expected: FAIL because the handler is not registered and the route still executes synchronously.

- [ ] **Step 3: Export a handler-compatible knowledge operation**

The exported function accepts validated payload and dependencies, returns a safe result count, and does not expose prompts or raw provider responses.

- [ ] **Step 4: Register handler and enqueue from the route**

Return HTTP 202 with `{ jobId, status: "queued" }`. Keep authentication and current admin/manager behavior through `ai.knowledge.rebuild`. Do not delete the underlying synchronous service until the job adapter tests pass.

- [ ] **Step 5: Run AI and control-plane regressions**

Run: `npm.cmd run test:content-copilot`

Run: `node --test src/lib/control-plane/control-plane.test.mjs src/routes/control-plane.routes.test.mjs`

Expected: existing AI tests and new adapter tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/knowledge.server.ts src/routes/api.admin.ai.rebuild-knowledge.ts src/lib/control-plane/job-handlers.server.ts src/lib/control-plane/control-plane.test.mjs src/routes/control-plane.routes.test.mjs
git commit -m "feat: queue AI knowledge rebuild jobs"
```

---

### Task 11: WozTell Campaign Delivery Adapter

**Files:**
- Modify: `src/lib/woztell/woztell.server.ts`
- Modify: `src/routes/api.admin.jobs.send-queue.ts`
- Modify: `src/lib/control-plane/job-handlers.server.ts`
- Modify: `src/lib/control-plane/control-plane.integration.test.mjs`
- Modify: `src/routes/control-plane.routes.test.mjs`

**Interfaces:**
- Produces handler `woztell.campaign.deliver@1` with payload `{ campaignId: string }`.
- Consumes existing opt-in checks and WozTell send operation.

- [ ] **Step 1: Write failing delivery safety tests**

Assert duplicate campaign enqueue requests return one job, opted-out recipients remain blocked, provider timeout retries the job, permanent provider rejection fails it, and cancelling a running job prevents a late success update.

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd run test:woztell`

Run with test Neon: `node --test src/lib/control-plane/control-plane.integration.test.mjs`

Expected: at least the new adapter tests FAIL before implementation.

- [ ] **Step 3: Extract reusable campaign delivery service**

Move route-private recipient claiming, sending, and campaign status refresh into a server-only function. Preserve the existing opt-in/opt-out policy and safe error summaries.

- [ ] **Step 4: Register campaign handler**

The queue command requires `campaign.queue`. The handler rechecks WozTell enabled state and recipient consent at execution time. Its idempotency key is `woztell.campaign.deliver:${campaignId}`. Return only aggregate counts.

- [ ] **Step 5: Keep the legacy cron route as a compatibility adapter**

The existing `/api/admin/jobs/send-queue` route retains its `CRON_SECRET` contract but enqueues eligible campaign jobs and delegates processing to the generic worker. Remove duplicated delivery logic only after route and WozTell regressions pass.

- [ ] **Step 6: Run WozTell, route, and integration tests**

Run: `npm.cmd run test:woztell`

Run: `node --test src/routes/control-plane.routes.test.mjs`

Run with test Neon: `node --test src/lib/control-plane/control-plane.integration.test.mjs`

Expected: all WozTell and control-plane tests PASS with no duplicate sends.

- [ ] **Step 7: Commit**

```bash
git add src/lib/woztell/woztell.server.ts src/routes/api.admin.jobs.send-queue.ts src/lib/control-plane/job-handlers.server.ts src/lib/control-plane/control-plane.integration.test.mjs src/routes/control-plane.routes.test.mjs
git commit -m "feat: run WozTell delivery through durable jobs"
```

---

### Task 12: Scripts, Full Verification, And Read-Only Smoke Check

**Files:**
- Modify: `package.json`
- Modify: `src/routes/admin.routes.test.mjs` only if the central route inventory requires the new routes.
- Create: `docs/superpowers/reports/2026-07-14-backend-control-plane-verification.md`

**Interfaces:**
- Produces repeatable local commands and a verification report; no new runtime behavior.

- [ ] **Step 1: Add focused scripts**

```json
"test:control-plane": "node --test src/lib/control-plane/control-plane.test.mjs src/routes/control-plane.routes.test.mjs",
"test:control-plane:db": "node --test src/lib/control-plane/control-plane.integration.test.mjs"
```

- [ ] **Step 2: Run focused tests**

Run: `npm.cmd run test:control-plane`

Expected: all pure and route tests PASS, 0 failures.

- [ ] **Step 3: Run test-database integration tests**

Run: `npm.cmd run test:control-plane:db`

Expected with `TEST_DATABASE_URL`: schema, audit, migration, leasing, idempotency, and concurrency tests PASS.

- [ ] **Step 4: Run existing backend regressions**

Run:

```powershell
npm.cmd run test:neon-auth
npm.cmd run test:command-center
npm.cmd run test:content-copilot
npm.cmd run test:woztell
```

Expected: every suite exits 0.

- [ ] **Step 5: Run lint and production build**

Run: `npm.cmd run lint`

Run: `npm.cmd run build`

Expected: both exit 0. If full lint reports pre-existing CRLF-only Prettier failures, run targeted ESLint on changed files with `--rule "prettier/prettier: off"`, record the baseline separately, and do not claim full lint passed.

- [ ] **Step 6: Apply bootstrap migration to a non-production test database**

Run with test-only environment: `npm.cmd run neon:migrate`

Expected: `20260714180000_backend_control_plane.sql` is recorded in `app_migrations` and all `ops_*` tables exist.

- [ ] **Step 7: Perform read-only deployed smoke checks**

After deployment, authenticate as each role and verify:

- agent can read health but receives 403 for jobs, audit, and migrations;
- manager can read/retry/cancel jobs and read audit but receives 403 for migration apply;
- admin can plan a registered migration;
- no production migration is applied during this smoke check;
- each response includes a request ID and no environment values or sensitive payloads.

- [ ] **Step 8: Write the verification report**

Record commands, exit codes, test counts, deployment ID, read-only endpoint results, known baseline warnings, and the explicit fact that no production migration was applied.

- [ ] **Step 9: Commit**

```bash
git add package.json src/routes/admin.routes.test.mjs docs/superpowers/reports/2026-07-14-backend-control-plane-verification.md
git commit -m "test: verify backend control plane"
```

---

## Execution Notes

- Run each task in order. Later tasks consume interfaces defined by earlier tasks.
- Stop after a RED test if it fails for an unrelated syntax, import, or fixture error; correct the test until it fails for the missing behavior.
- Review the diff and run the task's focused tests before every commit.
- Do not apply `20260714180000_backend_control_plane.sql` to production without a separate explicit approval from the user.
- Do not add the admin UI in this plan. The backend APIs must stabilize first; the approved UI rollout is a separate follow-on plan.
