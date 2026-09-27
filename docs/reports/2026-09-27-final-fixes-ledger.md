# Final fixes implementation ledger — 2026-09-27

## Baseline (T00)

- Repository: `YNWAforever/earnestproperty`; isolated branch `codex/final-fixes-20260927`.
- Latest fetched `origin/main`: `3ebe4e3cb47807e8d870f2b9eac90954f73f4f11` (2026-09-27). This is identical to the audit SHA; no intervening main changes were found at T00.
- The original checkout was detached at `3cbaaf7`, 701 commits behind the refreshed main, with unrelated untracked work. It was not reset or modified.
- The supplied Markdown and HTML audit references describe the same R01–R16 findings. Their individual SHA256 hashes match `SHA256SUMS.txt`; the plan Markdown also matches its supplied hash. HTML and Markdown are alternate formats, not byte-identical files.
- Applicable repository instruction: root `CLAUDE.md`; no `AGENTS.md` found in the worktree. `CLAUDE.md` correctly distinguishes the Cloudflare cadence worker from the Vercel daily safety cron and event-driven job wake; no scheduling change is warranted.
- Runtime: Node v24.18.0, Bun 1.3.14, npm 11.16.0. `package.json` uses React 19, TanStack Start, Neon SQL, Zod 3, and named tests. `bun.lockb` is the lockfile. No `npm test` script exists.
- No `.env`, `.env.local`, or `.env.test` exists in this worktree; a local dependency junction supplies `node_modules`. `.env.example` is present. Credentials and isolated DB identity have not been supplied or inferred. DB/provider/browser acceptance is pending the proper environment.
- Latest migration at baseline: `20260927100000_whatsapp_redirect_bucket_retention.sql`. New schema work must use later migration names.
- Current baseline test: `node --test src/lib/whatsapp-enquiries/readiness.test.mjs src/lib/woztell/provider-result.test.mjs src/lib/analytics/reporting.test.mjs` — 20 passed, 0 failed, 0 skipped. This is baseline evidence only.

## Audit finding to implementation map

The audit and fetched main have the same SHA. These are audit findings on the current code commit, not new production verification. Statuses advance only with fresh implementation and acceptance evidence.

| Finding | Tasks | Code status | Staging status | Production status | Current evidence / next check |
|---|---|---|---|---|---|
| R01 Haze readiness | T03–T05 | partial-local | not-started | external-blocked | Audit: no verified mapping/destination; retain blocked preview until real identity and receipt evidence. |
| R02 technical ID setup | T02–T03 | fixed-local | not-started | not-started | Audit: wizard requires manual Inbox IDs. |
| R03 verification evidence | T01,T04 | fixed-local | not-started | external-blocked | Versioned mapping and distinct accepted, signed-delivered, manual-confirmed evidence tested locally; real provider receipt remains unverified. |
| R04 Folder semantics | T02,T03,T05 | partial-local | not-started | external-blocked | Audit: direct assignment requires matching Folder; tenant capability unverified. |
| R05 sales performance | T12–T14 | not-started | not-started | not-started | Audit: current analytics lacks attributable sales/agent metrics. |
| R06 transaction attribution | T10–T11 | not-started | not-started | not-started | Audit: form lacks CRM/property links, credits, and commission. |
| R07 public inventory count | T09 | fixed-local | not-started | not-started | Shared canonical public selection; 1 linked property / 2 active offers fixture passes. Isolated Neon snapshot comparison pending. |
| R08 website tracking | T08 | not-started | not-started | not-started | Audit: sampled 6/6 CTAs use direct wa.me. |
| R09 batch input | T06 | fixed-local | not-started | not-started | Multi-source expansion, CSV/TSV paste, strict 28hse/YouTube URL parsing and source-scoped staff lookup pass local tests; live browser acceptance pending. |
| R10 blocked batch rows | T07 | not-started | not-started | not-started | Audit: one blocked row blocks submit; keep snapshots/chunks. |
| R11 notification setup | T03–T04 | fixed-local | not-started | external-blocked | Company Channel and private Inbox destination now derive server-side from a reviewed mapping; live tenant setup unverified. |
| R12 test-send workflow | T03–T04 | fixed-local | not-started | external-blocked | Transport-specific actions, repair links, version guards, scoped request recovery and evidence-specific status pass local tests. |
| R13 mapping races | T01 | fixed-local | not-started | not-started | Audit: no expectedVersion on mapping save. |
| R14 analytics definitions | T12–T13 | not-started | not-started | not-started | Audit: test/spam and cohort/current backlog not distinguished. |
| R15 media and transport copy | T15 | not-started | not-started | not-started | Audit: VR claim and mismatched transport text. |
| R16 remote image variants | T16–T17 | not-started | not-started | not-started | Audit: thumbnail and hero share original URL, without srcset. |

## Task progress

T00 complete. T09 and T01 code fixed locally; T02 provider directory code fixed locally; T03 wizard, T04 notification and T06 batch-import code fixed locally (isolated Neon, tenant and browser gates pending). Suggested sequence: T09, T01, T02, T03, T04, T06, T07, T08, T10, T11, T12, T13, T14, T15, T16, T05, T17, T18.

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

### T01 — versioned staff mapping evidence (R03, R13)

- Reproduced with embedded PostgreSQL: before implementation, reviewed save was absent and mapping writes had no version conflict protection. The first red test failed because the service was absent; an earlier CAS test failed when expectedVersion was unrecognized.
- Migration expands existing rows with version 1, review_basis legacy_manual, review_enforced false; legacy verification references are preserved. New append-only review events bind staff, company Channel, provider integration, actor, current mapping version, result, and expiry. A trigger increments mapping versions on update.
- The reviewed save accepts only a current provider_verified and verified event in the exact scope. One SQL statement performs evidence validation, version compare-and-swap, mapping write, and audit. Retirement is a separate versioned write. Duplicate provider identity across staff is rejected. Manual compatibility saves cannot overwrite a strict reviewed mapping.
- Readiness now reports mapping version and requires review evidence only for mappings explicitly marked strict. Legacy assignment eligibility remains unchanged until per-staff rollout.
- node --test src/lib/whatsapp-enquiries/mapping-review.db.test.mjs: 3 pass, 0 fail, 0 skip (embedded PostgreSQL; legacy conservation, race, identity/scope/actor/basis/result/expiry, append-only, update, retire).
- npm run test:staff-notifications: 21 Node pass + 4 Bun pass, 0 fail, 0 skip.
- npm run typecheck: pass. Changed-file ESLint: pass.
- Disposable Neon migration and tenant-specific review evidence are not yet available; these remain staging gates. No production migration or provider call was made.

### T02 — scoped Inbox directory and named Folder catalog (R02, R04)

- Official WOZTELL Public Integration API documentation checked on 2026-09-27: https://support.woztell.com/portal/en/kb/articles/public-a documents list-users with channelId, folderId, userId, limit and after cursor. It does not document a Folder listing endpoint. WOZTELL Folder documentation describes public and private Folder access: https://doc.woztell.com/docs/integrations/inbox/inbox-manage-folder/.
- Added server-only list-users reads with pinned configured URL, bounded fetch, response validation, exact Channel/user scope, pagination, and distinct status codes for authorization, rate limiting and upstream failure. Name/email filtering stays local to each loaded page; an empty filtered page with a cursor remains incomplete.
- Added a tenant and Channel scoped named Folder catalog, maintained through an authenticated advanced server function; no Folder is seeded or inferred. Candidate browsing caches only 30-second scoped pages. Verification makes a fresh provider read filtered by Channel, Folder and exact user ID, then records a version-bound, append-only review event only if local actor, staff, Folder and mapping versions still match.
- node --test src/lib/woztell/inbox-directory.test.mjs: 4 pass, 0 fail, 0 skip (pagination, duplicate names, wrong Channel/user, malformed and repeated cursor, 401/403/429/5xx, agent rejection, tenant/Channel cache separation, Folder denial, timeout).
- npm run test:woztell: 150 Node pass + 8 Bun pass, 0 fail, 0 skip. npm run typecheck and changed-file ESLint: pass.
- No tenant credentials or Folder names were supplied. Provider readback and disposable Neon migration remain external staging gates; no production provider request was made.

### T03 — staff Inbox onboarding wizard (R01, R02, R04, R11, R12)

- Reproduced: the old second step required manual Inbox User ID, Folder ID, Routing Node ID and a verification reference, then allowed a manual eligible save. The new UI tests initially failed because account picker and wizard state helpers did not exist.
- The primary four-step flow now shows local staff name, work email and branch; selects named Folder and exact Inbox account from T02; requires an explicit provider access check; then consumes its evidence ID in T01's versioned save. Provider IDs appear only in advanced details. Routing Node is no longer edited by this direct-assignment wizard.
- Changing staff, Folder or account clears review evidence. A stale async lookup cannot populate a new staff selection. A 409 keeps the account and Folder inputs, clears stale evidence, refreshes current versions, and explains the difference. A separate reasoned action retires a mapping without requiring new provider evidence. Unsaved inputs are guarded on navigation and staff switch.
- The first step distinguishes local branch from provider Folder. External 28hse/YouTube staff references moved into an advanced section. Empty Folder state has an explicit setup action. Existing notification/test components remain until T04.
- bun test src/components/admin/whatsapp/StaffMappingWizard.test.tsx: 6 pass, 0 fail. npm run test:staff-notifications: 21 Node + 10 Bun pass, 0 fail. Admin route contracts: 41 pass. Typecheck and changed-file ESLint: pass.
- Route search accepts only UUID staffId/draftId and steps 0–3. Actor-scoped draft restoration belongs to T07; this route does not load a draft yet. Narrow-screen/keyboard live browser acceptance and real Haze connection remain staging/external gates because this worktree has no authenticated test session or tenant credentials. No provider send was made.

### Migration manifest correction

- The explicit migration manifest contract was run after T02 and failed: the T01 and T02 SQL files were absent from MIGRATION_VERSIONS. Added both in chronological order. node --test src/lib/control-plane/migration-versions.test.mjs now passes 6/6. This is source health registration only; no database migration has been applied.

### T04 — notification setup, test status and evidence (R03, R11, R12)

- Reproduced three red UI assertions: transport test actions shared a generic label; readiness repair links were omitted; the endpoint form requested a company Channel ID.
- Channel comes from server runtime. Inbox private-note destination and verification reference come from a provider-reviewed staff mapping; save guards its version and records it on the endpoint. Staff WhatsApp still requires an independent verified recipient and permission reference. No save operation calls either provider send API.
- Preview, enqueue, and dispatch compare current endpoint/mapping versions. A scoped request ID finds a prior attempt after refresh; unknown state does not trigger a resend. Signed provider delivery receipts are isolated from customer messages, deduplicated, and stored separately from provider acceptance. Manual recipient confirmation requires an evidence reference and writes an audit entry; acknowledgement remains null without its own evidence.
- PGlite test covers stale mapping and endpoint versions, disabled endpoint, idempotent request, one provider send, unknown timeout without resend, signed receipt deduplication, manual confirmation deduplication, and server-derived Channel/Inbox destination. Opening or saving the UI does not enqueue work.
- `npm run test:staff-notifications`: 21 Node + 13 Bun pass; `npm run test:woztell`: 150 Node + 8 Bun pass; migration manifest 6 pass; typecheck and changed-file ESLint pass. No tenant provider call or production migration was run.

### T06 — multi-source link batch import (R09)

- Reproduced missing parser/module with a red test. The existing wizard offered one source for all selected offers and required manual IDs.
- Added multi-source expansion for selected sale/rent offers and CSV/TSV paste with fixed column order. Parser handles BOM, full-width whitespace, quoted commas, duplicates and 1001-row rejection. It recognizes exact HTTPS 28hse buy/rent detail shapes from repo fixtures and YouTube watch, short and shorts URLs; unrecognized or mismatched URLs stay visible for correction without fetching or following links.
- Pasted rows resolve exact current public offers through T09 canonical selection. Optional staff_reference uses source/account|external-code and only a current, exact source-scoped mapping; names are never guessed. Preview checks source scope and a new final-write trigger rejects wrong-source references. Website rows use website:primary; the existing preview/50-row commit and CSV formula neutralization paths are preserved.
- `node --test src/lib/whatsapp-enquiries/link-batch-import.test.mjs src/lib/whatsapp-enquiries/link-batch-import.db.test.mjs`: 5 pass; `npm run test:whatsapp-enquiries`: 98 pass; `npm run test:admin-properties`: 29 Node + 20 Bun pass; migration manifest 6 pass; typecheck and changed-file ESLint pass. A first batch-suite run exposed a stale PGlite reference fixture lacking namespace; the fixture was updated and the suite reran cleanly.
- Live browser workflow and isolated Neon migration remain staging gates. No external site or provider was fetched or sent to.
