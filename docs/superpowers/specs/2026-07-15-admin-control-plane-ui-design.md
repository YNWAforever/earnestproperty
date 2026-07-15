# Admin Control Plane UI Design

Date: 2026-07-15

Status: Approved design

## Objective

Add a first-party Operations Center to the existing Earnest Property admin panel so authorized staff can monitor backend health, inspect and recover durable jobs, review sanitized audit records, and safely plan or apply registered migrations.

This phase consumes the existing control-plane APIs. It does not change the production migration policy, introduce raw SQL execution, add realtime infrastructure, or add bulk job actions.

## Product Decisions

- Use one sidebar entry and one route: `/admin/operations`.
- Use URL-backed tabs: `overview`, `jobs`, `audit`, and `migrations`.
- Hide tabs the current role cannot access.
- Poll Overview and the visible Jobs tab every 30 seconds while the document is visible.
- Provide manual refresh.
- Support one job retry or cancellation at a time with confirmation.
- Allow Admin users to plan and apply one registered migration through a two-step confirmation flow.
- Do not expose job payloads, raw provider errors, prompts, phone numbers, secrets, SQL, or complete customer records.

## Information Architecture

The existing `AdminShell` gains one `系統營運` navigation item using a familiar operations icon. The route uses a `tab` search parameter:

- `/admin/operations` or `?tab=overview`
- `/admin/operations?tab=jobs`
- `/admin/operations?tab=audit`
- `/admin/operations?tab=migrations`

Role visibility follows the backend permission matrix:

| Role | Visible tabs |
| --- | --- |
| Agent | Overview |
| Manager | Overview, Jobs, Audit |
| Admin | Overview, Jobs, Audit, Migrations |

An unknown or unauthorized tab value resolves to the first permitted tab and replaces the URL. Hiding a tab improves clarity but never replaces backend authorization; every API request remains permission checked.

## Frontend Architecture

`AdminOperations` is a small route container responsible for identity, allowed tabs, URL state, the shared refresh scheduler, and top-level error boundaries. It does not own table rendering or mutation details.

The route composes focused modules:

- `AdminOperationsOverview`
- `AdminOperationsJobs`
- `AdminOperationsAudit`
- `AdminOperationsMigrations`
- `operations-client.ts`
- `operations-types.ts`
- `operations-permissions.ts`
- a visibility-aware polling hook

Each panel owns its loading, error, filter, cursor, and mutation state. A panel failure remains local and does not remove healthy data from another panel. Shared UI follows the existing `AdminShell`, table, badge, dialog, tooltip, skeleton, empty-state, and toast patterns.

## Overview

Overview is a compact operational dashboard, not a marketing page. It contains:

1. A status bar with overall `Healthy`, `Degraded`, or `Failed`, last refresh time, and a manual refresh command.
2. A health-check table for required database schema, tables and columns, AI readiness, WozTell readiness, and worker readiness as reported by the backend.
3. Job summary counts for queued, running, failed or retrying, and cancelled work.
4. A needs-attention list containing recent failures, expired leases, and jobs that exhausted retries.
5. An Admin-only migration summary showing pending or drift states without exposing an Apply action on Overview.

Overview loads each section only when the current role has its required permission. Agent users load health only; Manager users additionally load job summaries and needs-attention data; Admin users additionally load migration status. Hidden sections make no background request to their protected endpoint.

A failed health request does not erase a previously loaded job summary. Each section shows its own stale or error state and retry command.

## Jobs

The Jobs tab provides a dense, scan-friendly table with filters for status and job type. Columns are:

- job type
- status
- attempt count and maximum attempts
- run-after time
- lease expiry
- safe error code
- created and updated times

The table uses the existing keyset cursor. It does not render payloads or raw error summaries.

Retry is available only for failed jobs. Cancel is available only for queued, running, or failed jobs. Each command uses an icon button with a tooltip and opens a confirmation dialog. Buttons remain disabled while their command is in flight.

A successful command refreshes Jobs, Overview, and Audit. A `409` state conflict explains that the job changed elsewhere, closes the pending action, and refreshes the list. A late worker completion remains blocked by the existing guarded backend transition.

Bulk selection, bulk retry, and bulk cancellation are outside this phase.

## Audit

The Audit tab is read-only and supports filters for outcome, action, and request ID. Columns are:

- timestamp
- action
- outcome
- actor
- request ID
- sanitized metadata summary

Rows can expand to show backend-sanitized metadata. The frontend does not attempt to reconstruct removed values. Selecting a request ID applies it as the current filter. Pagination uses the API keyset cursor.

The UI provides no delete or edit action and no export of complete customer data.

## Migrations

Only Admin users can see the Migrations tab. It displays each registered migration with its ID, checksum, applied, pending, or drift status, and safe schema summary.

The apply workflow is intentionally sequential:

1. Admin selects one migration and requests Plan.
2. The UI displays checksum and schema validation results.
3. If the plan is applicable, the backend returns a short-lived approval token.
4. The token is held only in component memory. It is never placed in the URL, local storage, logs, analytics, or toast content.
5. The Apply dialog requires the Admin to type the complete migration ID.
6. Apply remains disabled until the typed value exactly matches.
7. Submission consumes the approval token and immediately clears it from local state.
8. Success refreshes migrations, health, and audit.
9. Expiry, drift, or already-applied conflicts clear the token and require a new Plan.

The UI never accepts SQL, statement, or query text and never offers an Apply All command. This interface does not automatically apply migrations during deployment.

## Data Access

`operations-client.ts` is the browser boundary for existing `/api/admin/control-plane/*` endpoints. It validates the expected response shape and normalizes:

- success and error envelopes
- HTTP status
- stable error code
- request ID
- authentication expiry
- permission rejection

UI types include only safe response fields. Unknown or malformed responses become one stable client error and do not render arbitrary provider or database content.

The client does not persist approval tokens or operational response bodies. Authentication continues through existing Neon Auth request handling.

## Refresh And Concurrency

One visibility-aware scheduler drives refreshes every 30 seconds. It runs only while the document is visible, stops on unmount, and refreshes immediately after visibility returns.

Permitted Overview sections always participate. Jobs participates only when its tab is visible. Audit and Migrations refresh on entry, manual refresh, or a relevant successful mutation rather than on a continuous timer. The scheduler never calls an endpoint for which the current role lacks permission.

Polling for a resource pauses while that resource has an active mutation and resumes after its final refresh. The UI prevents repeated clicks; backend idempotency, leases, permission guards, and state transitions remain the authoritative concurrency protection.

## Error Handling

- `401`: preserve the route shell and prompt the user to sign in again.
- `403`: remove inaccessible content and show a concise permission message if the permission changed after initial render.
- `409`: explain state drift or conflict, clear stale local action state, and refresh.
- `42P01` or `42703` through stable envelopes: show the missing-schema health state without exposing raw SQL errors.
- Network or timeout: keep the last successful data visible, mark it stale, and provide retry.
- Unknown error: show the stable request ID for support correlation.

Toast messages never include approval tokens, raw errors, stack traces, environment values, or sensitive metadata.

## Responsive And Accessible Behavior

- Tabs wrap or scroll without changing their dimensions unexpectedly.
- Tables use stable columns on desktop and a deliberate compact row layout on narrow screens; content does not overlap.
- Icon-only actions have accessible names and tooltips.
- Status is conveyed through text and icon in addition to color.
- Dialog focus is trapped and returns to the invoking action.
- Destructive or production-affecting actions use explicit confirmation copy.
- Heading sizes remain appropriate for an operational admin surface.

## Testing

### Pure and component tests

- Role-to-tab visibility defaults to deny.
- Unknown and unauthorized tab values resolve to the first permitted tab.
- Polling starts, pauses while hidden, resumes immediately, and cleans up its timer.
- Response envelopes, stable errors, and request IDs parse correctly.
- Jobs expose retry and cancel only in valid states.
- A `409` command conflict clears pending state and requests a refresh.
- Migration approval tokens remain memory-only and are cleared after apply, expiry, drift, or unmount.
- Migration ID confirmation requires an exact match.
- Audit filters and cursor navigation preserve sanitized data only.

### Route and integration contracts

- `/admin/operations` is registered, noindexed, and uses `AdminShell`.
- The sidebar has one independent active state for Operations.
- Browser clients call only the existing protected control-plane routes.
- Backend control-plane permission, audit, migration, and job tests remain unchanged and passing.

### Browser verification

- Test Agent, Manager, and Admin tab visibility.
- Verify manual refresh and 30-second polling behavior.
- Verify retry, cancel, migration Plan, typed confirmation, and safe error states with non-production fixtures.
- Capture desktop and mobile screenshots and check for tab, table, dialog, or text overflow.

### Regression commands

- `npm.cmd run test:control-plane`
- focused Operations UI tests
- `npm.cmd run test:neon-auth`
- `npm.cmd run test:command-center`
- `npm.cmd run test:woztell`
- targeted ESLint for changed files
- `npm.cmd run build`

Full repository lint remains separately tracked until the existing CRLF/Prettier baseline is resolved.

## Delivery Boundaries

- Do not apply `20260714180000_backend_control_plane.sql` to production as part of UI development.
- Do not use an unknown database for mutation tests.
- Do not add realtime infrastructure, bulk actions, raw SQL execution, payload inspection, audit deletion, or customer-data export.
- Production migration execution and authenticated role smoke checks require their own explicit deployment approval after the UI is implemented and verified.

## Success Criteria

1. Each role sees only its permitted tabs while backend permissions remain authoritative.
2. Operations data refreshes predictably without duplicate timers or page-wide failure.
3. Managers can safely inspect, retry, or cancel eligible jobs and review audit history.
4. Admins can plan and apply one registered migration only through a short-lived, typed-confirmation flow.
5. No sensitive payload, approval token, SQL, raw error, prompt, phone number, or complete customer record reaches the UI.
6. Component, route, backend regression, responsive browser, targeted lint, and production build verification pass.
