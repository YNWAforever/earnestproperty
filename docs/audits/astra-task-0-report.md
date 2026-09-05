# Astra task 0 report

Date: 2026-09-05 (Asia/Hong_Kong)

## Scope and commits

- Baseline: `897f01ac372063113b5a42de9593fe33252d8dc0`
- Worktree: `C:/Users/laich/Documents/Earnestproperty/Earnestproperty/.worktrees/audit-20260905`
- Branch: `codex/audit-20260905`
- Focused audit/verification commit: `a43e265` (`test: establish dependable audit verification`)
- This report is committed separately so it can record the implementation commit exactly.
- `bun.lockb` and all concurrent auth, CMS, campaign implementation, migration and provider files were excluded from the task 0 commit.

## Implemented

- The public listing query now accepts `hasVideo` across the complete query/server boundary and applies a nonblank video predicate before `COUNT`, ordering and `LIMIT`. The regression includes 40 newer non-video rows, older valid videos, draft exclusion and duplicate-source headroom.
- CI now runs the six deterministic suites that had been omitted. `src/test-wiring.test.mjs` checks every deterministic `test:*` script against the workflow and maintains an explicit environment-dependent list instead of relying on a suffix heuristic.
- Package registration now includes the campaign dispatch test, CMS recovery test in both CMS/estate suites, and the opt-in `test:staff-bootstrap:db` suite.
- CI records ESLint and TypeScript process exits. ESLint exit codes greater than 1 fail independently of the nonzero lint ratchet; TypeScript nonzero exits without parsed over-budget diagnostics also fail.
- CI retains Node 24 and Bun 1.3.12 pins. The local verification runtime was Node 24.18.0, Bun 1.3.14 and npm 11.16.0.
- A `browser-staging` job installs the lockfile-pinned Playwright Chromium revision and uses the staging environment's explicit `STAGING_BASE_URL`. `playwright.config.ts` starts/probes localhost only when `PLAYWRIGHT_BASE_URL` is absent.
- Existing Windows file-URL, slash and CRLF audit-harness repairs were integrated. No `.gitattributes` normalization was added.

## Commands and results

- `npm.cmd ci` — exit 0; 831 packages installed from `package-lock.json`. npm reported 30 dependency audit findings and nine install scripts awaiting npm allow-scripts review; no dependency upgrades or audit fixes were performed.
- `node --test src/test-wiring.test.mjs` — 9 passed, 0 failed.
- `npm.cmd run test:listing-search` — 66 Node tests plus 11 Bun tests passed, 0 failed. This includes the 40-newer-row video regression and the duplicate canonical-source case.
- `npm.cmd run test:videos` — 27 passed, 0 failed.
- `npm.cmd run test:woztell` — 108 Node tests plus 6 Bun tests passed, 0 failed after the concurrent task-4 owner updated its lock assertion.
- `npm.cmd run test:cms` — 29 passed, 0 failed.
- `npm.cmd run test:admin-estates` — 17 passed, 0 failed.
- `npm.cmd run test:staff-bootstrap:db` — 1 skipped by its explicit disposable-database gate; 0 failed. It requires `TEST_DATABASE_URL` and `STAFF_BOOTSTRAP_TEST_DATABASE_CONFIRMED=true`.
- `$env:PLAYWRIGHT_BASE_URL='https://staging.invalid'; npx.cmd playwright test --list` — configuration loaded without starting localhost and listed 6 Chromium tests.
- `npx.cmd eslint <task-0 paths>` — 0 errors; two expected ignored-file warnings for YAML/JSON inputs with no ESLint configuration.
- `npx.cmd prettier --check package.json playwright.config.ts src/test-wiring.test.mjs .github/workflows/ci.yml` initially identified package/wiring formatting; `npx.cmd prettier --write ...` normalized those owned files.
- `git diff --check -- <task-0 paths>` — exit 0.
- `git diff --cached --check` before commit — exit 0.

The initial red wiring run proved the new contracts: it failed for missing CI process-exit capture, absent staging browser wiring, unconditional local Playwright startup, and concurrently added unregistered test files. After implementation and authorized package registration, the guard passed 9/9.

## Deferred verification and external gates

- Full deterministic-matrix, typecheck and build were deliberately deferred to the final integrated head because auth, CMS and campaign agents were editing shared source during this slice. The earlier audit recorded typecheck and a retry build as passing, but that is not fresh proof for the current integrated head.
- The earlier Windows build first hit transient `EPERM` while replacing `src/routeTree.gen.ts`, followed by a missing-manifest exception; a clean retry passed without code/dependency changes. Reproduce and investigate locks only if it recurs.
- `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `PLAYWRIGHT_BASE_URL`, `TEST_DATABASE_URL` and `DATABASE_URL_TEST` were all absent in this execution environment. No database integration or live staging browser test ran.
- Migration drift remains an external GitHub settings gate. The workflow already performs only the SELECT-based drift check and reads `DATABASE_URL_UNPOOLED`/`DATABASE_URL`; an authorized read-only credential, documented target branch/database and grant check are still required. Missing credentials do not establish drift.
- The staging browser job is configured but will skip until the staging environment supplies `STAGING_BASE_URL`.
- Exact-head Linux CI, authenticated read-only migration drift, staging browser execution, draft PR creation and CI URL remain pending. No push, PR, deployment, production setting, migration, seed, provider call or message send occurred.
