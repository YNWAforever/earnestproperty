# Task 4 Report: Visibility-Aware Pulse And Route Shell

## Status

Implemented and committed-ready on `codex/fix-admin-login-load`.

## Scope

- Added a pure visibility-aware Operations poller and `useOperationsPulse` hook.
- Added the URL-backed `/admin/operations` route shell with noindex metadata.
- Added the exact `系統營運` sidebar item with `ServerCog`.
- Added Task 4 route and poller tests.
- Generated `src/routeTree.gen.ts` using `npm.cmd run build`.

## TDD Evidence

RED:
```text
node --test src/lib/admin/operations/operations.test.mjs src/routes/admin.operations.test.mjs
```
Failed as expected because `operations-polling.ts` and `admin.operations.tsx` did not exist.

GREEN:
```text
node --test src/lib/admin/operations/operations.test.mjs src/routes/admin.operations.test.mjs src/routes/admin.routes.test.mjs
```
Passed: 27 tests, 0 failures.

## Verification

- `npm.cmd run build` passed and mechanically generated the Operations route tree entries.
- `src/routes/admin.operations.tsx` imports and calls only `fetchOperationsHealth`; it does not import or call jobs, audit, or migrations endpoints before capabilities are available.
- The route derives allowed tabs with `allowedOperationTabs` and resolves invalid or unauthorized URL tabs with `resolveOperationTab`.
- Poller tests keep timer and visibility callbacks independently injected.
- `git diff --check` passed for the Task 4 code files (with the repository's existing LF-to-CRLF warning for the generated route tree).

## Scope Note

Unrelated pre-existing worktree changes and SDD artifacts were preserved.
