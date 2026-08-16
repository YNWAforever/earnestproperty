# Admin Operations Center Verification

Date: 2026-07-18
Branch: codex/fix-admin-login-load
Base commit before Task 8: bb01ce4

## Scope

Task 8 added the focused `test:operations` package script and a source-level
contract that locks its exact command. This report records focused tests,
backend regressions, static verification, a local-only runtime probe, and the
limits of the available browser tooling.

## TDD Evidence

RED command:

```powershell
Remove-Item Env:TEST_DATABASE_URL -ErrorAction SilentlyContinue
node --test src/routes/admin.operations.test.mjs
```

Result: exit 1; 2 pass, 1 fail. The new assertion failed exactly because
`packageJson.scripts["test:operations"]` was `undefined`.

GREEN command: the same command after adding the script.
Result: exit 0; 3 pass, 0 fail.

Implemented script:

```json
"test:operations": "node --test src/lib/admin/operations/operations.test.mjs src/routes/admin.operations.test.mjs && bun test src/components/admin/operations/operations-components.test.tsx"
```

## Test Commands

All commands removed `TEST_DATABASE_URL` first.

| Command                          | Result                           |
| -------------------------------- | -------------------------------- |
| `npm.cmd run test:operations`    | exit 0; Node 18 pass, Bun 8 pass |
| `npm.cmd run test:control-plane` | exit 0; 30 pass                  |

## Final Review Hardening

A branch-wide review found concurrency and privacy blockers after the initial
Task 8 verification. The follow-up implementation now:

- treats ambiguous WozTell outcomes as terminal `WOZTELL_DELIVERY_UNKNOWN`
  instead of automatically retrying a message that the provider may have accepted;
- renews running job leases and passes cooperative ownership checkpoints into
  campaign delivery before each recipient send, claims only one durable job per
  serial worker run, and rejects completion or failure after lease expiry;
- returns claimed but unattempted campaign recipients to `queued` when a worker
  loses ownership or delivery is interrupted;
- writes successful retry/cancel audits in the same SQL statement as the job
  state transition;
- serializes migration execution with a transaction-scoped advisory lock,
  revalidates the schema fingerprint and dependency state inside that transaction,
  and writes the success audit before commit; and
- redacts recipient/provider payload fields and caps audit object width deterministically.
- reconciles stale `sending` recipients to terminal `WOZTELL_DELIVERY_UNKNOWN`
  without resending and permits a permissioned manual retry of a cancelled campaign to
  continue only its queued recipients;

| `npm.cmd run test:control-plane:db` | exit 0; 5 pass, 3 explicit skips because no disposable database was configured |
| `npm.cmd run test:neon-auth` | exit 0; 3 pass |
| `npm.cmd run test:command-center` | exit 0; 29 pass |
| `npm.cmd run test:woztell` | exit 0; 29 pass |

## Static Verification

`npm.cmd exec -- prettier --write src/routes/admin.operations.test.mjs` completed,
then `npm.cmd exec eslint -- src/routes/admin.operations.test.mjs` exited 0.
This was targeted lint only; repository-wide lint was not run. The original
targeted lint attempt reported only CRLF Prettier errors after the Windows patch
fallback changed line endings; the formatter restored the repository LF format.

`npm.cmd run build` first exceeded the 120-second harness limit without
diagnostic output. A clean retry with a 10-minute limit exited 0. Warnings were
limited to chunk-size guidance, ignored dependency `use client` directives,
and an existing dynamic/static import chunk warning for
`src/lib/control-plane/audit.server.ts`.

## Local Runtime And Browser Verification

Vite was started as a hidden local process with `TEST_DATABASE_URL` absent on
`127.0.0.1:4175`. Its log reported ready in 12,970 ms. A read-only bounded
probe returned `HTTP=200 TIME=0.093211` for `/admin/operations`.

Browser automation could not initialize. The required in-app browser control
kernel exited with:

```text
windows sandbox failed: helper_unknown_error: apply deny-read ACLs
```

No browser tab, fixtures, intercepts, screenshots, or interactive Operations UI
checks were performed. Consequently, the desktop 1440x900 and mobile 390x844
role visibility, tab replacement, manual refresh/visibility polling, job
confirmations and 409 behavior, audit interactions, migration confirmation,
token non-disclosure, and overflow checks are not claimed as browser-verified.
The focused source and component suites do cover route state, polling helpers,
job guards, audit sanitization, migration exact-ID confirmation, and secret
omission contracts.

## Safety

No production migration, production data mutation, campaign delivery, deployment,
push, secret change, or WozTell send was executed. The local process tree
`cmd.exe` PID 4948 and Vite `node.exe` PID 29084 was stopped; subsequent
process checks found neither PID and a two-second localhost probe returned
`HTTP=000`.

## Files

- `package.json`
- `src/routes/admin.operations.test.mjs`
- `docs/superpowers/reports/2026-07-15-admin-control-plane-ui-verification.md`
- `.superpowers/sdd/admin-control-plane-ui-task-8-report.md`

## Concerns

The automated browser surface is unavailable in this sandbox, so the full
interactive responsive acceptance checklist remains an explicit verification
gap. Existing unrelated SDD and plan changes remain unstaged.
