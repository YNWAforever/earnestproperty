# Earnest Property validation record

Scope: branch `codex/earnest-audit-remediation-20260927`, initial SHA `098844e6a97545e1b590f45c756a8d2ca77db7bb`, 2026-09-27 HKT. Commands below were run in the isolated worktree. Exit 0 is recorded only for the completed command, not for DB, browser or live delivery.

| Stage    | Command                                | Result                        | Scope                         |
| -------- | -------------------------------------- | ----------------------------- | ----------------------------- |
| Baseline | `npm.cmd ci --no-audit --no-fund`      | exit 0; 846 packages          | npm lockfile v3               |
| Baseline | `npm.cmd run typecheck`                | exit 0                        | TypeScript compile            |
| Baseline | `npm.cmd run test:listing-search`      | exit 0; Node 90/90, Bun 12/12 | Contract and local unit tests |
| Baseline | `npm.cmd run test:whatsapp-enquiries`  | exit 0; Node 76/76            | Local synthetic tests         |
| Baseline | `npm.cmd run test:staff-notifications` | exit 0; Node 10/10, Bun 4/4   | Local synthetic tests         |
| Baseline | `npm.cmd run test:team`                | exit 0; Node 91/91, Bun 31/31 | Local synthetic tests         |

Pending: isolated database SQL, staged browser journeys, actual staff recipient and phone endpoint, template contract, provider delivery receipt, and Hong Kong performance baseline. No skipped database suite is counted as passing.

Visual audit evidence reviewed from the supplied HTML: A074714 detail (public number plus SYNC breadcrumb), old single-link admin UI, and A074714 zero-result search. The private screenshots are excluded from the branch.

## T01 local verification

| Command                                                     | Result                                                         | Scope                                                                              |
| ----------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `bun test src/lib/property-public.test.ts`                  | red 1 failure on SYNC fallback, then exit 0; 7/7               | Pure helper                                                                        |
| `node --test src/lib/neon/public-number-search.db.test.mjs` | red 1 failure (`A074714` count 0), then exit 0; 1/1, 0 skipped | Fresh PGlite PostgreSQL with synthetic source, alias, rent/sale and withdrawn rows |
| `npm.cmd run test:listing-search`                           | exit 0; Node 90/90, Bun 12/12                                  | Contracts and local units                                                          |
| `npm.cmd run test:property-experience`                      | exit 0; Node 146/146, Bun portion passed                       | Local property and route tests                                                     |
| `npm.cmd run typecheck`                                     | exit 0                                                         | Compile after route edit                                                           |

The PGlite fixture neither connects to Neon nor supplies a false branch identity. It does not replace the guarded Neon integration suites or staged browser tests.

## T02–T04 local verification

| Task | Command                                                                   | Result                                       | Scope                                                                  |
| ---- | ------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| T02  | `node --test src/lib/whatsapp-enquiries/public-context.test.mjs`          | exit 0; 2/2, 0 skipped                       | Per-offer tracked/untracked/contact action and one batch resolver call |
| T02  | `npm run test:property-experience`                                        | exit 0; Node 146/146 and Bun 196/196         | Property CTA and head contracts; no staged browser                     |
| T02  | `npm run test:seo`                                                        | exit 0; Node 61/61 and Bun 6/6               | Static SEO and canonical contracts                                     |
| T02  | `npm run test:whatsapp-enquiries`                                         | exit 0; 76/76 before T03 script addition     | Existing WhatsApp contracts                                            |
| T03  | `node --test src/lib/whatsapp-enquiries/assignment-role-enum.db.test.mjs` | red on SQLSTATE 42883; after fix exit 0; 1/1 | Isolated PostgreSQL enum fixture including viewer                      |
| T03  | `npm run test:whatsapp-enquiries`                                         | exit 0; 77/77, 0 skipped                     | Includes the new enum fixture                                          |
| T03  | `npm run test:whatsapp-enquiries:db`                                      | exit 0; 0 passed, 4 skipped                  | Guarded Neon test branch absent; not passing evidence                  |
| T04  | `npm run test:staff-notifications`                                        | exit 0; Node 16/16, Bun 4/4, 0 skipped       | PGlite readiness and receipt tests; synthetic provider transport       |
| T04  | `npm run test:staff-notifications:db`                                     | exit 0; 0 passed, 2 skipped                  | Guarded Neon test branch absent; not passing evidence                  |
| T04  | `npm run typecheck` and targeted ESLint                                   | exit 0                                       | Compile and lint of changed T04 files                                  |

The receipt test executes the additive migration and the actual acceptance and signed-receipt UPDATE SQL in isolated PGlite. It cannot establish that any phone received a message. The assignment fixture mirrors the `staff_role` enum and its later `viewer` value; its adapter converts JavaScript arrays to PostgreSQL array literals for PGlite, while the production Neon branch remains untested.

Official WOZTELL Bot API guidance: https://doc.woztell.com/docs/reference/bot-api-reference . The repository has no approved tenant template JSON, name, language or parameter fixture; the template path remains blocked. No external provider request was made during these tests.

## T05 local verification

| Command                                                                      | Result                                    | Scope                                                                                                     |
| ---------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `node --test src/lib/whatsapp-enquiries/staff-test-notification.db.test.mjs` | exit 0; 1/1, 0 skipped                    | Fresh PGlite schema, migration, revoke, retry, rate cap, leased synthetic provider acceptance and timeout |
| `npm run test:staff-notifications`                                           | exit 0; Node 17/17 and Bun 4/4, 0 skipped | Includes new test job fixture and existing notification contracts                                         |
| `npm run typecheck`                                                          | exit 0                                    | Staff wizard, server functions and worker job contract                                                    |
| targeted `npx eslint`                                                        | exit 0                                    | Changed T05 TypeScript and TSX files                                                                      |

No live test notification was queued or sent. The fixture's synthetic recipient is not a designated colleague, and provider acceptance is not device delivery. Browser/staging validation remains pending.

## T06 local verification

| Command                                                           | Result                 | Scope                                                                                     |
| ----------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------- |
| `node --test src/lib/whatsapp-enquiries/link-batches.test.mjs`    | exit 0; 2/2, 0 skipped | Canonical source/placement identity, stable row hashes and limits                         |
| `node --test src/lib/whatsapp-enquiries/link-batches.db.test.mjs` | exit 0; 1/1, 0 skipped | PGlite migration/function with 50+10 rows, replay, conflict, withdrawn and mapping revoke |
| `npm run typecheck`                                               | exit 0                 | Batch service and server function contract                                                |

Independent Neon connections, live migration chain and staging UI remain unverified. The synthetic PGlite fixture does not use production data or provider network.

## T07 local verification

| Command                                                              | Result                 | Scope                                                                                                              |
| -------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `node --test src/lib/whatsapp-enquiries/link-management.db.test.mjs` | exit 0; 1/1, 0 skipped | PGlite 650 rows, filters/cursor, open/enquiry counts, expired-reference disable/reenable, versioned 500+150 export |
| `bun test src/lib/admin/whatsapp-link-export.test.ts`                | exit 0; 1/1, 0 skipped | CSV formula, comma/quote/newline and BOM                                                                           |
| `npm run typecheck`                                                  | exit 0                 | Paged API and export server functions                                                                              |

Neon staging migration and browser export remain unverified.

## Final local verification after T12

This is the current branch's fresh check, not the earlier audit's count. The command exit code is reported separately from test skips. The build emitted Vite/Rollup dependency warnings but completed; no deployment was made by this local command.

| Command                                                             | Result                                   | Evidence boundary                                                                        |
| ------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                                             | exit 0                                   | TypeScript compile                                                                       |
| `npm.cmd run lint`                                                  | exit 0                                   | Repository ESLint after removing private scratch files and formatting one T07 module     |
| `npm.cmd run build`                                                 | exit 0                                   | Local Windows production bundle, not a Vercel deployment                                 |
| `npm.cmd run test:listing-search`                                   | exit 0, Node 90/90 and Bun 12/12         | List-row contract updated for per-property enquiry action                                |
| `npm.cmd run test:property-experience`                              | exit 0, Node 146/146; Bun portion passed | Local route contracts, no browser                                                        |
| `npm.cmd run test:whatsapp-enquiries`                               | exit 0, Node 92/92                       | PGlite enum, batch, link management and redirect retention among synthetic cases         |
| `npm.cmd run test:staff-notifications`                              | exit 0, Node and Bun portions passed     | Synthetic endpoint/provider fixtures; no device receipt                                  |
| `npm.cmd run test:team`                                             | exit 0, Node and Bun portions passed     | Local identity/onboarding contracts                                                      |
| `npm.cmd run test:admin-properties`                                 | exit 0, Node portion and Bun 16/16       | Batch UI and CSV contracts                                                               |
| `npm.cmd run test:operations`                                       | exit 0, Node portion and Bun 8/8         | Local operations UI and health contracts                                                 |
| `npm.cmd run test:control-plane`                                    | exit 0, Node 97/97                       | Migration registry and CI wiring                                                         |
| `npm.cmd run test:job-wake`                                         | exit 0, Node 17/17                       | Job scheduling                                                                           |
| `npm.cmd run test:seo`                                              | exit 0, Node portion and Bun 6/6         | Local canonical and structured-data checks                                               |
| `npm.cmd run test:media`                                            | exit 0, Bun 12/12                        | Existing generated local variant files and dimensions                                    |
| `npm.cmd run test:homepage`                                         | exit 0, Node 25/25                       | Content contract                                                                         |
| `npm.cmd run test:estate-conversion`                                | exit 0, Node 102/102                     | Estate scope/content contract                                                            |
| `npm.cmd run test:public-performance:db`                            | exit 0; 0 pass, 3 skipped                | Guarded isolated Neon branch unavailable                                                 |
| `npm.cmd run test:whatsapp-enquiries:db`                            | exit 0; 0 pass, 4 skipped                | Guarded isolated Neon branch unavailable                                                 |
| `npm.cmd run test:staff-notifications:db`                           | exit 0; 0 pass, 2 skipped                | Guarded isolated Neon branch unavailable                                                 |
| `playwright test --list` on four public/staff/bulk/onboarding specs | exit 0; 18 tests collected               | Collection only; no staging URL or authenticated fixture, zero browser journeys executed |

No `ASTRA_TEST_DATABASE_URL`/verified `ASTRA_TEST_BRANCH_ID`, `PLAYWRIGHT_BASE_URL`, or `STAFF_HANDOFF_BROWSER_FIXTURE` exists in this isolated worktree. No branch identity was forged and skipped tests are not green DB evidence. PGlite uses fresh synthetic in-memory PostgreSQL data; it verifies SQL semantics but cannot establish Neon network, migration order under real staging data, multi-connection concurrency or provider behavior.

## Message test and performance evidence

The designated-colleague test was **not sent**. Willy's staff account and Inbox private-note endpoint were confirmed during T13, but its staff WhatsApp endpoint and outside-window approved template have not been created. The remaining fields are listed in `2026-09-27-recipient-test-manifest.md`. Provider `accepted`, signed delivery/read receipt and handset confirmation remain unknown for this assignment. Synthetic accepted/timeout cases are local tests only. The T12 performance report records file-size measurements and synthetic redirect decisions; there is no comparable Hong Kong TTFB or Neon DB p95 baseline.

## PR checks after publication

- The first PR run was rejected before a runner started by an account billing/spending-limit gate. A later run reached the tests and exposed two failures. Neither was a production runtime failure.
- At audit baseline, `media-upload-boundary.test.mjs` still evaluated `src/auth.ts` in a CommonJS VM, replaced only the first `import.meta.env` occurrence, and expected a cookie-only upload identity. Commit `cf69017` updated that fixture to exercise the current credentialed raw-session request, require an opaque token, and reject incomplete/401 sessions without weakening `src/auth.ts`. Local `test:mls` then passed 639/639, the focused auth tests passed, and remote `test:mls` passed.
- The Team route contract prohibited every `window.location` reference, including the read-only `origin` needed for the manually shared registration link. Commit `461b328` narrowed that negative assertion to client storage, token use, and navigation/mutation. Local `test:command-center` and `test:team` passed; remote `test:command-center` passed.
- GitHub Actions run `36273289277` for code commit `461b328` completed `ci` successfully through the final analytics test. The `browser-staging` job remained skipped by its environment gate. Vercel reported its automatic PR preview check successful. The preview was not used as a verified isolated staging environment, and no production deployment was initiated.
- GitHub Actions run `36273584492` for documentation commit `07d3888` completed `ci` successfully. `browser-staging` remained skipped; PR readiness is checked at the current head separately. The public read-only spot check is recorded in `2026-09-27-performance-baseline.md` and does not close F23/F24.

## T13 staging schema evidence

The user supplied staging Neon branch br-young-breeze-ao85rtx1. Its five additive audit migrations were applied sequentially in branch-explicit transactions, with the registry insert inside each transaction. Staging moved from 55 to 60/60 migrations; new operation tables are empty, and the checked legacy link/version/open digests were unchanged. Production remained at 55 versions in a separate read-only check. The full per-file evidence and rollback boundary are in 2026-09-27-staging-migration-evidence.md. The user confirmed Willy Lai is staging staff account 72285986-c82c-46bd-98d9-c6b021d91b0d; its staff WhatsApp endpoint and approved template remain missing. No synthetic Neon DB suite or browser journey was executed against the parent-data snapshot, and no provider send occurred.

The supplied Vercel Preview alias resolves to the PR head, but its Preview variables have `NEON_BRANCH=production` and production Neon Auth hosts. The database connection-string hosts were redacted by Vercel; their branch could not be verified. No staging browser journey was run on that deployment. The user confirmed that Willy's staff WhatsApp endpoint and tenant-approved template do not yet exist.

Read-only staging `EXPLAIN ANALYZE` on the source-matched unfiltered canonical listing count and first 24-row page gave five subsequent server-time medians of 4.087 ms and 7.737 ms respectively. These are DB-only observations on the inherited snapshot, not TTFB, DB p95 or browser acceptance; sample details are in `2026-09-27-performance-baseline.md`.

## T13 isolated staging acceptance continuation

The named Neon branch was confirmed by the database server itself as br-young-breeze-ao85rtx1. The separate database earnest_audit_acceptance_20260927 began empty and was used only for synthetic fixtures. The migration runner first failed on LOCK TABLE with SQLSTATE 25P01 after 42 versions. Its transactional fix applied the remaining 18 versions; the read-only drift check then reported all 60/60 applied. Production was read separately: 55 versions, no audit batch preview table.

| Check | Actual result | Boundary |
| --- | --- | --- |
| Migration runner red/green | SQLSTATE 25P01 before fix; 18 remaining files applied after fix | Empty acceptance database only; multi-statement files and registry row now share a transaction |
| Disposable target guard | 3/3 pass, 0 skipped | Rejects absent confirmation, default database, false branch or endpoint identity |
| Combined real Neon synthetic DB suite | 79 pass, 0 fail, 0 skip; 95.41 s | 13 files; random synthetic schemas; public/admin/CRM/WhatsApp SQL; no provider delivery |
| Real Neon batch-concurrency fixture | 1 pass, 0 fail, 0 skip; 5.44 s; 50-row chunk 256 ms | Separate 2-client 50+10, lost-response replay and one created/one reused placement; schema and rows removed |
| Residual fixture schemas | 0 | Server query after the test run |
| TypeScript typecheck | exit 0 | Source branch after the migration runner/test changes |
| Targeted ESLint | exit 0 | All 15 changed runner and DB test files |
| Preview public HTTP smoke | Home, listing redirect, A074714 keyword and detail reached app HTML | Vercel-protected Preview via authenticated CLI curl; no logged-in browser E2E |

The initial DB suite run had 68 pass, 4 fail due to two stale synthetic fixtures and their parent tests. The assignment fixture had text instead of the real staff_role enum; the service fixture omitted a later notification table and branch field; the separate public test fixture lacked SEO columns and a data-URL dynamic-import resolution. These were corrected without changing production authorization or service health requirements. Only the final 79/79 result is passing evidence. Earlier skipped gated suites are still recorded as skipped at the earlier point in time.

The Preview branch configuration and real DB evidence are detailed in 2026-09-27-staging-acceptance-evidence.md. The deployed runtime DB host remains redacted on Vercel readback; authenticated desktop/mobile journeys, staging load and full performance measures, approved template, Willy staff WhatsApp endpoint, designated handset, live message and device delivery are not verified. F11, F23 and F24 remain open.
