# Earnest Property audit remediation ledger

Baseline: `098844e6a97545e1b590f45c756a8d2ca77db7bb` (fetched `origin/main` on 2026-09-27 HKT). Implementation branch: `codex/earnest-audit-remediation-20260927`. This branch began at the audit SHA, so the initial committed diff is empty. The older detached checkout and its local changes are outside this worktree.

Evidence: [text audit](../superpowers/plans/references/EarnestProperty_Audit_2026-09-27_zhHK.md); the matching HTML with three embedded screenshots remains in the supplied local handoff pack and is excluded from git because it contains an internal admin screenshot. Its SHA-256 is `17bd6f1d654b8f8cba4ba5ac60b831aa7206a2d2338c576dbc0b9eec0e7c858a`.

Statuses: `open`, `reproduced`, `fixed-local`, `verified-staging`, `verified-production`, `blocked`, `no-longer-reproducible`. A local test or code change does not imply staging or production verification.

| Finding | Audit issue | Task | Status | Commit and fresh evidence |
|---|---|---|---|---|
| F01 | Public listing number search misses current listing | T01 | fixed-local | T01 commit; PGlite real COUNT SQL red 0 then green 1; alias, case, whitespace, withdrawn tested; staging pending |
| F02 | Internal SYNC identifier reaches customer UI | T01 | fixed-local | T01 commit; helper red/green and public route replacements; staged browser review pending |
| F03 | WhatsApp entry points lose property context | T02 | fixed-local | Shared per-offer action and batch resolver across homepage, list, detail desktop/mobile; pure test passed; staging browser pending |
| F04 | Internal copy and estate location mismatch | T11 | open | Audit report; source owner review pending |
| F05 | Five-minute response promise unsupported | T11 | open | Audit report; actual human SLA unverified |
| F06 | Listing content and media claims mismatch | T11 | open | Audit report; source and override review pending |
| F07 | Detail page social URL points to homepage | T02 | fixed-local | Property og:url now matches canonical public URL; SEO suite passed; SSR/browser pending |
| F08 | Assignment evidence panel errors | T03 | fixed-local | True staff_role enum PGlite failed with SQLSTATE 42883 before cast; after enum[] cast, admin/manager/assigned agent pass and viewer/inactive/cross-conversation fail; staging pending |
| F09 | Active staff is conflated with routing readiness | T04 | open | Audit report; current readiness review pending |
| F10 | Inbox assignment, private note and staff phone conflated | T04 | open | Audit report; capability and evidence review pending |
| F11 | Staff template send and delivery unverified | T04 | blocked | Needs approved provider template contract and device delivery evidence; code work remains |
| F12 | Mapping and test-send workflow unclear | T05 | open | Audit report; UI and service review pending |
| F13 | Runtime mode and policy UI disagree | T10 | open | Audit report; current runtime review pending |
| F14 | Single link creation can become generic enquiry | T08 | open | Audit screenshot and report; current UI review pending |
| F15 | Link list is capped and lacks management | T07 | open | Audit screenshot and report; paging retest pending |
| F16 | Bulk API lacks UI and retry identity | T06 | open | Audit report; service review pending |
| F17 | Expired reference may block disable | T07 | open | Static audit finding; behavior test pending |
| F18 | Shared redirect capacity bucket | T12 | open | Static audit finding; isolated capacity test pending |
| F19 | Active member count masks account readiness | T09 | open | Audit report; current team data review pending |
| F20 | Invitation and first-login loop incomplete | T09 | open | Audit report; current flow review pending |
| F21 | Health misses eligible staff and due work | T10 | open | Audit report; runtime review pending |
| F22 | Missing agent/link/mapping/content tasks lack entry points | T08 | open | Audit report; current UI review pending |
| F23 | External response latency needs measured diagnosis | T12 | open | Audit samples are not HK/user p75; new baseline pending |
| F24 | Oversized thumbnails and serial bulk reads | T12 | open | Audit DOM and static evidence; measurement pending |

## T00 baseline

- `npm.cmd ci --no-audit --no-fund`: exit 0, 846 packages installed from npm lockfile v3. Bun lockfile is also tracked; Windows checkout changes only its executable mode, which is not part of this work.
- `npm.cmd run typecheck`: exit 0.
- `test:listing-search`: Node 90 passed, Bun 12 passed; these do not execute the A074714 SQL case.
- `test:whatsapp-enquiries`: Node 76 passed; no live provider claim.
- `test:staff-notifications`: Node 10 passed, Bun 4 passed; no actual device delivery.
- `test:team`: Node 91 passed, Bun 31 passed; synthetic/unit scope.
- No `ASTRA_TEST_DATABASE_URL`, `ASTRA_TEST_BRANCH_ID`, browser fixture or local `.env.local` was present in this worktree. Database tests have not been run and must not be reported as passed. The current public deployment was not reachable through the read-only web tool.

Ruling: keep the audit HTML in the supplied pack rather than committing it — its admin screenshot contains private operational context — cost if wrong: reviewers need the separately supplied pack for visual evidence.

## T01 evidence

- A fresh in-memory PostgreSQL fixture executes the actual `searchListings` COUNT SQL with `A074714`, lower case, whitespace, an old alias, sale/rent and a newer withdrawn sale. It failed on the audit SQL (`0 !== 1`) and passes after the search change (1/1). The standard Neon branch DB suite remains unrun.
- `publicPropertyNo` refuses SYNC and raw UUID fallback; the helper regression failed before the fix and passed after. Customer-facing breadcrumb, enquiry props, form prompt, homepage text, analytics and list structured URL now use the public identity.
- Focused post-change checks: `test:listing-search` Node 90/90 plus Bun 12/12; `test:property-experience` exit 0, Node 146/146; `typecheck` exit 0. No staging or production claim.

Ruling: use PGlite's isolated in-memory PostgreSQL for new SQL regressions while the guarded Neon test branch credentials are absent — it executes PostgreSQL syntax and enum types with synthetic rows, but it cannot prove Neon network, migration or production data behavior.

## T02 evidence

- `public-context.test.mjs` failed before the shared action existed and passes with tracked `/w/`, contextual company fallback, and `/contact` for a missing phone or internal number. No fallback fabricates an EPWA token.
- Homepage and listing loaders batch resolve the visible offers once; detail resolves active offerings once and selects the current sale/rent action by property ID. Resolver failures log `WA_TRACKING_RESOLVER_FAILED` and still provide a contextual fallback. Normal missing links remain observable as `WA_TRACKING_LINK_UNPROVISIONED`.
- Property and listing `og:url` now match their canonical public URLs. Live SSR, social preview and provider receipt checks are still pending.

## T03 evidence

- The isolated PostgreSQL fixture uses the production `staff_role` enum plus its later `viewer` value. The original `r.role=ANY($2::text[])` returned SQLSTATE `42883`, `operator does not exist: staff_role = text`. The corrected query uses `staff_role[]`; the fixture adapts JavaScript arrays into PostgreSQL array literals because PGlite's parameter encoder does not mirror Neon's.
- Authorized admin, manager and assigned agent can read. Inactive staff, viewer, staff without a persisted role and an agent assigned to another conversation receive 403. A missing conversation returns 404 only to an authorized global role; agents receive 403 to avoid enumeration.
- The client wrapper returns a safe error code, status code and correlation request ID. The panel displays distinct messages and its retry only re-reads assignment evidence. The existing Neon branch database suite still needs its guarded test branch; its skipped state is not counted as passing.
