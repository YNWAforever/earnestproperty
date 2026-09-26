# Earnest Property validation record

Scope: branch `codex/earnest-audit-remediation-20260927`, initial SHA `098844e6a97545e1b590f45c756a8d2ca77db7bb`, 2026-09-27 HKT. Commands below were run in the isolated worktree. Exit 0 is recorded only for the completed command, not for DB, browser or live delivery.

| Stage | Command | Result | Scope |
|---|---|---|---|
| Baseline | `npm.cmd ci --no-audit --no-fund` | exit 0; 846 packages | npm lockfile v3 |
| Baseline | `npm.cmd run typecheck` | exit 0 | TypeScript compile |
| Baseline | `npm.cmd run test:listing-search` | exit 0; Node 90/90, Bun 12/12 | Contract and local unit tests |
| Baseline | `npm.cmd run test:whatsapp-enquiries` | exit 0; Node 76/76 | Local synthetic tests |
| Baseline | `npm.cmd run test:staff-notifications` | exit 0; Node 10/10, Bun 4/4 | Local synthetic tests |
| Baseline | `npm.cmd run test:team` | exit 0; Node 91/91, Bun 31/31 | Local synthetic tests |

Pending: isolated database SQL, staged browser journeys, actual staff recipient and phone endpoint, template contract, provider delivery receipt, and Hong Kong performance baseline. No skipped database suite is counted as passing.

Visual audit evidence reviewed from the supplied HTML: A074714 detail (public number plus SYNC breadcrumb), old single-link admin UI, and A074714 zero-result search. The private screenshots are excluded from the branch.
