# Final fixes implementation ledger — 2026-09-27

## Baseline (T00)

- Repository: `YNWAforever/earnestproperty`; isolated branch `codex/final-fixes-20260927`.
- Latest fetched `origin/main`: `3ebe4e3cb47807e8d870f2b9eac90954f73f4f11` (2026-09-27). This is identical to the audit SHA; no intervening main changes were found at T00.
- The original checkout was detached at `3cbaaf7`, 701 commits behind the refreshed main, with unrelated untracked work. It was not reset or modified.
- The supplied Markdown and HTML audit references describe the same R01–R16 findings. Their individual SHA256 hashes match `SHA256SUMS.txt`; the plan Markdown also matches its supplied hash. HTML and Markdown are alternate formats, not byte-identical files.
- Applicable repository instruction: root `CLAUDE.md`; no `AGENTS.md` found in the worktree. `CLAUDE.md` correctly distinguishes the Cloudflare cadence worker from the Vercel daily safety cron and event-driven job wake; no scheduling change is warranted.
- Runtime: Node v24.18.0, Bun 1.3.14, npm 11.16.0. `package.json` uses React 19, TanStack Start, Neon SQL, Zod 3, and named tests. `bun.lockb` is the lockfile. No `npm test` script exists.
- No `.env`, `.env.local`, `.env.test`, or `node_modules` exists in this worktree. `.env.example` is present. Credentials and isolated DB identity have not been supplied or inferred. DB/provider/browser acceptance is pending the proper environment.
- Latest migration at baseline: `20260927100000_whatsapp_redirect_bucket_retention.sql`. New schema work must use later migration names.
- Current baseline test: `node --test src/lib/whatsapp-enquiries/readiness.test.mjs src/lib/woztell/provider-result.test.mjs src/lib/analytics/reporting.test.mjs` — 20 passed, 0 failed, 0 skipped. This is baseline evidence only.

## Audit finding to implementation map

The audit and fetched main have the same SHA. These are audit findings on the current code commit, not new production verification. Statuses advance only with fresh implementation and acceptance evidence.

| Finding | Tasks | Code status | Staging status | Production status | Current evidence / next check |
|---|---|---|---|---|---|
| R01 Haze readiness | T03–T05 | not-started | not-started | external-blocked | Audit: no verified mapping/destination; retain blocked preview until real identity and receipt evidence. |
| R02 technical ID setup | T02–T03 | not-started | not-started | not-started | Audit: wizard requires manual Inbox IDs. |
| R03 verification evidence | T01,T04 | not-started | not-started | not-started | Audit: manual evidence cannot imply provider verification or delivery. |
| R04 Folder semantics | T02,T03,T05 | not-started | not-started | external-blocked | Audit: direct assignment requires matching Folder; tenant capability unverified. |
| R05 sales performance | T12–T14 | not-started | not-started | not-started | Audit: current analytics lacks attributable sales/agent metrics. |
| R06 transaction attribution | T10–T11 | not-started | not-started | not-started | Audit: form lacks CRM/property links, credits, and commission. |
| R07 public inventory count | T09 | fixed-local | not-started | not-started | Shared canonical public selection; 1 linked property / 2 active offers fixture passes. Isolated Neon snapshot comparison pending. |
| R08 website tracking | T08 | not-started | not-started | not-started | Audit: sampled 6/6 CTAs use direct wa.me. |
| R09 batch input | T06 | not-started | not-started | not-started | Audit: wizard has one source per batch and manual placement IDs. |
| R10 blocked batch rows | T07 | not-started | not-started | not-started | Audit: one blocked row blocks submit; keep snapshots/chunks. |
| R11 notification setup | T03–T04 | not-started | not-started | not-started | Audit: technical fields and external mapping mixed into primary flow. |
| R12 test-send workflow | T03–T04 | not-started | not-started | not-started | Audit: same-name buttons and unclear repair actions. |
| R13 mapping races | T01 | not-started | not-started | not-started | Audit: no expectedVersion on mapping save. |
| R14 analytics definitions | T12–T13 | not-started | not-started | not-started | Audit: test/spam and cohort/current backlog not distinguished. |
| R15 media and transport copy | T15 | not-started | not-started | not-started | Audit: VR claim and mismatched transport text. |
| R16 remote image variants | T16–T17 | not-started | not-started | not-started | Audit: thumbnail and hero share original URL, without srcset. |

## Task progress

T00 complete. T09 code fixed locally (isolated Neon gate pending). Suggested sequence: T09, T01, T02, T03, T04, T06, T07, T08, T10, T11, T12, T13, T14, T15, T16, T05, T17, T18.

## Decisions and external gates

- Ruling: Latest main equals audit SHA, so the audit remains a current-code baseline. Live deployment and current tenant configuration still require separate verification.
- Ruling: `bun.lockb` shows a file-mode-only difference in this Windows worktree. It is excluded from staged changes.
- Haze production acceptance requires her confirmed provider identity, named Folder with actual access, configured capability and destination, a test conversation, provider readback, and recipient confirmation. No display-name-only send.
- Production migration, provider send, and deployment remain separate external operations after reviewable code and isolated verification.


### T09 — public inventory count (R07)

- Reproduced: `getAdminOverview` counted raw `properties` rows. The new PGlite fixture initially failed because the public count query did not exist.
- Changed: public search and overview now share the current-offering selection SQL. The overview returns distinct `publicProperties` and `publicOffers` with a checked time. The management list has an explicit linked-public filter; overview cards open that matching active scope. Unlinked records remain available in the default diagnostic view.
- `node --test src/lib/neon/public-inventory-counts.db.test.mjs`: 2 pass, 0 fail, 0 skip (embedded Postgres; linked sale/rent, duplicate source, newer withdrawal, draft, unlinked, empty set).
- `npm run test:admin-properties`: 29 Node pass + 18 Bun pass; 0 fail, 0 skip.
- `npm run test:listing-search`: 90 pass, 0 fail, 0 skip. The first run exposed a contract harness import error for a `.mjs` helper; changing it to the repository's `.js`/`.d.ts` pattern resolved that without altering the harness.
- `npm run typecheck`: pass. Changed-file ESLint: pass.
- `npm run test:admin-properties:db`: 0 pass, 0 fail, 2 skipped because no confirmed disposable Neon target. Same-snapshot comparison against the real management list remains staging-unverified.
- Ruling: `publication=public` is an explicit management filter while the default view retains unlinked diagnostics. This preserves existing admin access to unlinked imports; if product expects the default active list itself to equal the overview, its default may need to change.
