# Backend Control Plane Design

**Date:** 2026-07-14
**Status:** Approved for implementation planning
**Scope:** Earnest Property admin backend reliability and operations foundation

## Objective

Create a first-party backend control plane inside the existing TanStack Start and Neon application. It must make schema readiness, authorization, migrations, background jobs, auditing, and operational errors visible and recoverable without rewriting the existing CMS, AI, CRM, or WozTell features.

The first release succeeds when an authorized administrator can identify a backend dependency problem, safely plan and approve a registered migration, inspect and recover failed jobs, and trace every write operation by request ID.

## Decisions

- Keep the current `admin`, `manager`, and `agent` roles.
- Replace scattered role checks with a central permission matrix.
- Use a modular monolith inside the existing application.
- Keep Neon Postgres as the durable store for operations data and job leasing.
- Never accept arbitrary SQL from the admin UI.
- Require an explicit, short-lived approval token before applying a registered migration.
- Implement a retryable database-backed job queue now, while preserving a path to durable workflows later.
- Adopt test-driven development for every production behavior.

## Alternatives Considered

### Database-centric control plane

Postgres functions, triggers, and views would enforce strong data-local behavior. This was rejected as the primary architecture because authorization, error contracts, and test coverage would become harder to understand and maintain from the TypeScript application.

### External operations service

A separate worker and queue service would offer stronger horizontal scaling. It was rejected for this phase because it adds deployment, credentials, observability, and cost before the current workload requires them.

### Selected: modular monolith

The control plane will use focused modules with typed interfaces inside the existing app. Existing features will connect through adapters and can migrate incrementally without a risky rewrite.

## Architecture

Create `src/lib/control-plane/` with these boundaries:

- `permissions.ts`: permission definitions, role matrix, and default-deny decisions.
- `errors.ts`: stable operational error codes and safe error serialization.
- `health.server.ts`: read-only checks for database schema, environment, AI, WozTell, and cron readiness.
- `migration-registry.server.ts`: immutable registered migrations, checksums, dependencies, preconditions, and impact descriptions.
- `migrations.server.ts`: migration planning, approval token verification, execution, and run recording.
- `jobs.ts`: pure job state machine and retry policy.
- `jobs.server.ts`: enqueueing, leasing, execution bookkeeping, retry, cancel, and lease recovery.
- `audit.server.ts`: append-only audit writes and filtered audit queries.
- `service.server.ts`: typed control-plane commands and queries used by routes.
- `adapters/`: incremental adapters for CMS, AI, WozTell, and later backend features.

Admin routes must remain thin. Every protected operation follows:

1. Authenticate the staff session.
2. Authorize the required permission.
3. Validate input.
4. Execute the command, using a transaction where consistency requires one.
5. Record an audit result.
6. Return a typed response with a request ID.

## Permission Model

The permission matrix is defined in source control. Role assignments continue to come from the existing staff profile records.

### Agent

- `system.health.read`
- Existing own-lead and CRM permissions
- AI draft generation permissions

### Manager

Includes agent permissions, plus:

- `cms.publish`
- `campaign.queue`
- `system.jobs.read`
- `system.jobs.retry`
- `system.jobs.cancel`
- `audit.read`

### Admin

Includes manager permissions, plus:

- `staff.manage`
- `system.migrations.plan`
- `system.migrations.apply`
- Global integration and operational settings permissions

Unknown roles and unknown permissions are denied. Route-level checks must request permissions rather than inspect role names directly.

## Data Model

### `ops_audit_logs`

Append-only records containing actor identity, permission, action, resource type and ID, outcome, request ID, timestamps, and sanitized metadata. General application routes provide no update or delete operation.

### `ops_jobs`

Contains job type, versioned payload, state, attempt count, maximum attempts, run time, lease owner and expiry, last safe error, idempotency key, actor, and timestamps.

Allowed states are `queued`, `running`, `succeeded`, `failed`, and `cancelled`.

### `ops_job_attempts`

Contains one immutable record per execution attempt, including start and end times, worker identity, outcome, safe error code, and safe error summary.

### `ops_migration_runs`

Contains migration ID, checksum, plan summary, schema fingerprint, approval and execution identities, timestamps, result, request ID, and safe error information.

Sensitive customer content, credentials, tokens, raw SQL errors, and full AI prompts must not be stored in operations metadata.

## Schema Health And Migrations

Health checks return structured statuses for required relations, columns, indexes, environment variables, and integrations. Checks are read-only and must distinguish required failures from optional degraded capabilities.

A migration is an immutable source-controlled registry entry containing:

- Unique ID and checksum
- Dependencies
- Preconditions and expected current schema
- A human-readable impact summary
- Apply implementation
- Postconditions

A migration plan does not pretend to execute DDL. It verifies preconditions, dependencies, checksum, current schema fingerprint, and expected affected objects.

Applying a migration requires a short-lived signed approval token bound to migration ID, checksum, schema fingerprint, actor, and expiry. Apply rechecks all values immediately before execution. Any drift invalidates the approval and requires a new plan.

## Job Processing

Workers lease queued jobs with `FOR UPDATE SKIP LOCKED`. A lease prevents concurrent delivery by multiple Vercel instances. Expired leases can return eligible jobs to the queue after a worker crash.

Retry policy uses bounded exponential backoff with deterministic testable inputs. A retryable failure returns the job to `queued` with a later `run_after`. Exhausted or non-retryable jobs become `failed` and remain available for authorized manual retry or cancellation.

Every enqueue command requires an idempotency key. Repeated commands return the original job rather than enqueueing duplicate WhatsApp sends, AI generations, or knowledge rebuilds.

Phase one adapters will cover CMS/AI tasks first and WozTell campaign delivery second. Existing behavior remains in place until its adapter is verified.

## API Contract

Initial endpoints:

- `GET /api/admin/control-plane/health`
- `GET /api/admin/control-plane/migrations`
- `POST /api/admin/control-plane/migrations/:id/plan`
- `POST /api/admin/control-plane/migrations/:id/apply`
- `GET /api/admin/control-plane/jobs`
- `POST /api/admin/control-plane/jobs/:id/retry`
- `POST /api/admin/control-plane/jobs/:id/cancel`
- `GET /api/admin/control-plane/audit`

Successful response:

```ts
{ ok: true, data, requestId }
```

Failed response:

```ts
{
  ok: false,
  error: { code, message, retryable, details? },
  requestId,
}
```

`details` may contain safe validation or remediation information. It must not expose SQL, stack traces, secrets, access tokens, full phone numbers, or complete customer records.

## Error Handling

The error catalog maps known failures by structured properties such as Postgres error code, not by unstable message text. Initial mappings include:

- `42P01` to `SCHEMA_RELATION_MISSING`
- `42703` to `SCHEMA_COLUMN_MISSING`
- `23505` to `CONFLICT_DUPLICATE`
- Provider timeout to `INTEGRATION_TIMEOUT`
- Authorization failure to `PERMISSION_DENIED`
- Invalid or stale approval to `MIGRATION_APPROVAL_INVALID`

Unknown failures return `INTERNAL_ERROR` and a request ID. Detailed errors stay in server logs. Audit records capture a safe outcome, not a stack trace.

## Security

- Reauthenticate and reauthorize migration apply requests at execution time.
- Sign approval tokens with a server-only secret and enforce a short expiry.
- Use constant-time signature verification.
- Validate all route inputs and version all queued payload schemas.
- Sanitize metadata before persistence.
- Rate-limit sensitive control-plane write endpoints.
- Never expose a generic SQL execution endpoint.
- Use transactions for state transitions and audit writes that must remain consistent.

## TDD Strategy
