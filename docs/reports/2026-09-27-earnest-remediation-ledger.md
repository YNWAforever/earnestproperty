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
| F09 | Active staff is conflated with routing readiness | T04 | fixed-local | Separate readiness query includes unmapped staff; PGlite enum fixture and revoked endpoint test passed; staging pending |
| F10 | Inbox assignment, private note and staff phone conflated | T04 | fixed-local | Three capability states shown separately; provider acceptance, signed delivery and read timestamps are distinct; staging/device evidence pending |
| F11 | Staff template send and delivery unverified | T04 | blocked | Session text and readiness implemented; template guard retained pending approved name, language, parameters, WOZTELL JSON and device receipt |
| F12 | Mapping and test-send workflow unclear | T05 | fixed-local | Four-step staff wizard, source/account selector, masked test preview, durable one-shot job, PGlite revoke/idempotency/rate/unknown tests; staging and real recipient pending |
| F13 | Runtime mode and policy UI disagree | T10 | open | Audit report; current runtime review pending |
| F14 | Single link creation can become generic enquiry | T08 | fixed-local | New wizard requires a current offering, route and placement before preview; staging browser pending |
| F15 | Link list is capped and lacks management | T07 | fixed-local | Keyset page 25/50/100 and 650-link synthetic traversal; versioned export snapshot; UI migration/staging pending |
| F16 | Bulk API lacks UI and retry identity | T06 | fixed-local | Durable batch/chunk operation SQL, canonical placement locks, 60-row 50+10 PGlite fixture; admin UI and Neon concurrency/staging pending |
| F17 | Expired reference may block disable | T07 | fixed-local | PGlite expired reference: disable succeeds, stale version conflicts, re-enable remains blocked |
| F18 | Shared redirect capacity bucket | T12 | open | Static audit finding; isolated capacity test pending |
| F19 | Active member count masks account readiness | T09 | fixed-local | Team DTO separates active, invitation, verified email, identity, role/branch, Inbox and phone; local tests passed; staging pending |
| F20 | Invitation and first-login loop incomplete | T09 | fixed-local | Manual share and copy feedback, expiry, verified-before-bind and staff shell/checklist; staging browser pending |
| F21 | Health misses eligible staff and due work | T10 | open | Audit report; runtime review pending |
| F22 | Missing agent/link/mapping/content tasks lack entry points | T08 | fixed-local | Listings selection to bulk wizard, property agent checks, staff mapping deep link and result recovery; content review remains T11 |
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

## T04 evidence

- Staff readiness is evaluated from staff role and active state, Inbox mapping, both endpoint types, channel, permissions, runtime configuration and the 24-hour window. Missing mapping and missing schema are explicit. The admin panel labels Inbox assignment, private note and staff WhatsApp separately and masks the device reference.
- The production dispatcher reloads the same readiness policy and still performs its existing database boundary check immediately before send. Staff destination isolation, Inbox preflight, job lease and template guard remain in place.
- An additive migration records provider acceptance, signed delivery and signed read timestamps with separate sources. A PGlite test executes the actual update SQL and proves duplicate read receipt stability. No source code or provider response has been treated as device delivery.
- WOZTELL official Bot API guidance describes using the platform-generated JSON for an approved template. This tenant's approved template name, language, parameter mapping and response fixture have not been supplied, so template sending remains blocked.

## T05 evidence

- Staff configuration now follows one selected colleague through Inbox mapping, source/account reference and independent notification destinations, then shows each readiness state and an explicit test preview. A deep link can select a known staff ID; switching staff resets unsaved destination fields.
- Preview stores a five-minute opaque token and displays `[測試]`, name, transport, masked destination, version and exact copy. Only an explicit submit writes a purpose-specific test attempt and leased job. Test attempts do not reference customer enquiries or contribute to enquiry SLA.
- The one-minute actor/endpoint cap and request ID are enforced in a transaction with current endpoint, mapping, staff role and message-window checks. The worker checks these again before provider dispatch. A started but uncertain provider request becomes `unknown` and is never automatically resent; `accepted` is not delivered.
- Isolated PGlite executed the new migration and enqueue SQL, with one synthetic accepted transport and one post-boundary timeout. No WOZTELL network request was made. Inbox note testing requires a dedicated synthetic provider thread ID that does not belong to a customer conversation. No designated colleague or verified endpoint was supplied for the real T13 send.

## T06 evidence

- A ten-minute actor-bound preview stores the exact normalized rows and payload hash, with a 1,000-row limit. It reads current offers, staff mappings, references and matching links in one database call without creating links, opens or messages.
- Commit accepts 1–50 rows. PostgreSQL locks the batch and sorted placement keys, checks the preview snapshot and current offer/staff/reference facts, and records either an atomic committed result with link IDs/codes/versions or a rejected result with reason codes. Same chunk/hash returns its stored result after a lost response; different payload conflicts. A new chunk ID is required after a rejected chunk.
- New placement metadata is additive. One fully matching enabled legacy candidate may be reused; ambiguous legacy candidates are blocked. Historical versions and codes are not rewritten. A new placement uses the existing 192-bit reference code format.
- PGlite ran the actual migration/function over synthetic 60-row, withdrawn, revoked-mapping, two-actor and retry cases. It serializes the two-actor fixture and does not prove independent Neon connection concurrency; that remains a staging DB gate. The UI path has not yet migrated to this service at this task boundary.

## T07 evidence

- New server pagination uses created-at plus link ID keyset cursor and identical search/source/staff/enabled filter predicates for count and page. A 650-link PGlite fixture traversed all pages without duplicates or omissions. Open events and attributed enquiries are separate counts; a failed count read returns unknown rather than zero.
- Disabling an existing link copies its prior immutable identity and verification timestamp into a new disabled version, checking link and expected version while allowing expired references and withdrawn offers. Re-enabling still validates live dependencies. A stale expected version is reported as a conflict.
- The export takes an actor-scoped, fifteen-minute snapshot of exact link IDs and versions, then pages 500 rows at a time. Selected IDs and all matching filters are distinct scopes. CSV quotes fields, neutralizes spreadsheet formula prefixes, includes a UTF-8 BOM and excludes customer numbers, raw staff destinations, Inbox IDs and credentials. Tracking URLs are public `/w/` paths.
- The browser management UI still uses its old list at this task boundary; T08 will consume these endpoints. No production migration or export was run.

## T08 evidence

- The listings selection distinguishes current-page IDs from all matching server-selected offering IDs, then opens a five-step wizard. It requires the current sale/rent offering, actual property agent or explicit reception routing, source placement, staff readiness and an exact dry-run before commit.
- The client persists batch/chunk IDs before each maximum-50-row call; a lost response first reads the durable result. The 60-row client test passed 50+10 and recovered after a failed second request. The management table consumes server pagination, optimistic versions and snapshot export. Browser specs are collected but the staging fixture is absent.
- Focused checks after T08: typecheck and targeted lint exit 0; `test:admin-properties` Node 26 and Bun 10 passed; WhatsApp Node 81 passed; batch client Bun 4 passed. No production links were created.

## T09 evidence

- Team member DTO now derives distinct active, invitation, email verification, identity binding, role/branch, Inbox assignment, private note and optional phone states. The detail checklist and initial staff shell expose the correct owner for each step; a generic invitation link is explicitly manual-share and suspension only revokes staff access.
- Manual staff identity binding now checks Neon Auth email verification on the server. The lifecycle fixture proves an unverified account is rejected without a write and a verified account can bind. Existing bound owner access and session refresh remain intact.
- `test:team` Node 91 and Bun 31 passed; `test:neon-auth` 5 passed; onboarding policy 4 passed; typecheck and targeted lint passed. The new browser spec is fixture-gated and has not run against staging. Team aggregate attention counts do not include all provider readiness reasons; per-member readiness does, and staging data verification remains open.
