# Earnest Property audit remediation ledger

Baseline: `098844e6a97545e1b590f45c756a8d2ca77db7bb` (fetched `origin/main` on 2026-09-27 HKT). Implementation branch: `codex/earnest-audit-remediation-20260927`. This branch began at the audit SHA, so the initial committed diff is empty. The older detached checkout and its local changes are outside this worktree.

Evidence: [text audit](../superpowers/plans/references/EarnestProperty_Audit_2026-09-27_zhHK.md); the matching HTML with three embedded screenshots remains in the supplied local handoff pack and is excluded from git because it contains an internal admin screenshot. Its SHA-256 is `17bd6f1d654b8f8cba4ba5ac60b831aa7206a2d2338c576dbc0b9eec0e7c858a`.

Statuses: `open`, `reproduced`, `fixed-local`, `verified-staging`, `verified-production`, `blocked`, `no-longer-reproducible`. A local test or code change does not imply staging or production verification.

| Finding | Audit issue | Task | Status | Commit and fresh evidence |
|---|---|---|---|---|
| F01 | Public listing number search misses current listing | T01 | open | Audit screenshot: A074714 gives zero results; current branch retest pending |
| F02 | Internal SYNC identifier reaches customer UI | T01 | open | Audit screenshot: breadcrumb shows SYNC; current branch retest pending |
| F03 | WhatsApp entry points lose property context | T02 | open | Audit report; current branch retest pending |
| F04 | Internal copy and estate location mismatch | T11 | open | Audit report; source owner review pending |
| F05 | Five-minute response promise unsupported | T11 | open | Audit report; actual human SLA unverified |
| F06 | Listing content and media claims mismatch | T11 | open | Audit report; source and override review pending |
| F07 | Detail page social URL points to homepage | T02 | open | Audit report; SSR head retest pending |
| F08 | Assignment evidence panel errors | T03 | open | Audit report; enum SQL cause is a hypothesis until reproduced |
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
