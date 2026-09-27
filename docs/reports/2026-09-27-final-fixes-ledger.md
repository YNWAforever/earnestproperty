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

`fixed-local` means the code and local contracts exist. `partial-local` means a provider capability or operational step cannot be established locally. All staging and production acceptance remains unverified because the user has no disposable target or Haze test tenant.

| Finding | Tasks | Code status | Staging | Production | Evidence / next gate |
| --- | --- | --- | --- | --- | --- |
| R01 Haze readiness | T03–T05 | partial-local | blocked | unverified | Wizard and capability-specific handoff card exist; real tenant identity, Folder, conversation and recipient are absent. |
| R02 technical ID setup | T02–T03 | fixed-local | blocked | unverified | Exact account picker and advanced-only IDs pass local contracts; provider readback pending. |
| R03 verification evidence | T01,T04 | fixed-local | blocked | unverified | Versioned mapping, acceptance, receipt and recipient-confirmation states pass local tests; live receipt pending. |
| R04 Folder semantics | T02,T03,T05 | partial-local | blocked | unverified | Named scoped catalog and exact-user verification exist; no tenant Folder access evidence. |
| R05 sales performance | T12–T14 | fixed-local | blocked | unverified | Scoped source-backed reports and UI pass embedded tests; staging reconciliation pending. |
| R06 transaction attribution | T10–T11 | fixed-local | blocked | unverified | Private versioned credits and editor pass tests; migration and browser verification pending. |
| R07 public inventory count | T09 | fixed-local | blocked | unverified | Shared canonical selection passes embedded 1-property/2-offer fixture; live snapshot pending. |
| R08 website tracking | T08 | fixed-local | blocked | unverified | Coverage, explicit preview and contextual resolver pass local tests; live backfill pending. |
| R09 batch input | T06 | fixed-local | blocked | unverified | Multi-source import and URL/source validation pass local tests; authenticated staging pending. |
| R10 blocked batch rows | T07 | fixed-local | blocked | unverified | Eligible subset and durable recovery pass synthetic browser; staging pending. |
| R11 notification setup | T03–T04 | fixed-local | blocked | unverified | Server-derived Channel and reviewed destination pass local tests; tenant setup pending. |
| R12 test-send workflow | T03–T04 | fixed-local | blocked | unverified | Explicit actions, version guards and distinct evidence states pass local tests; no live send. |
| R13 mapping races | T01 | fixed-local | blocked | unverified | Expected-version CAS and stale-review tests pass; external migration pending. |
| R14 analytics definitions | T12–T13 | fixed-local | blocked | unverified | Quality, cohort, backlog and weighted-value definitions pass embedded tests; reconciliation pending. |
| R15 media and transport copy | T15 | fixed-local | blocked | unverified | Verified-tour classifier and exact estate mapping pass tests; live A074714 check pending. |
| R16 remote image variants | T16–T17 | fixed-local | blocked | unverified | Real WebP variants and original fallback pass local tests; flag off until staging media checks. |

## Task progress

T00–T04 and T06–T16 have local implementation and recorded tests. T05 is a prepared Haze acceptance card awaiting an actual tenant. T17 records structured skips for unavailable load and browser measurements. T18 documents the release sequence and rollback; no deployment or external migration was performed.

## Decisions and external gates

- Ruling: Latest main equals audit SHA, so the audit remains a current-code baseline. Live deployment and current tenant configuration still require separate verification.
- Ruling: `bun.lockb` shows a file-mode-only difference in this Windows worktree. It is excluded from staged changes.
- Haze production acceptance requires her confirmed provider identity, named Folder with actual access, configured capability and destination, a test conversation, provider readback, and recipient confirmation. No display-name-only send.
- Production migration, provider send, and deployment remain separate external operations after reviewable code and isolated verification.
- The user confirmed that no disposable staging URL/database, Haze test tenant, or consenting test recipient is available for this run. External acceptance remains blocked; local synthetic tests do not clear that gate.

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

### T05 — Haze handoff runbook and acceptance gate (R01, R04)

- Added an isolated browser fixture preflight: synthetic target marker, same-origin URLs, existing authenticated storageState paths, distinct notification IDs and no production UUID in fixtures. The prepared-state Playwright journeys still require a separately confirmed target.
- Added `docs/runbooks/whatsapp-staff-onboarding.md` with a capability-by-capability test card, exact synthetic message, independent assignment/private-note/staff-phone/receipt/recipient evidence and audit-preserving cleanup.
- Added `docs/reports/haze-routing-acceptance.md`. Real Haze assignment and delivery are explicitly external-blocked: no staging URL or fixture was configured, and no recipient or test conversation was supplied. `npm run test:staff-notifications:e2e` failed before browser launch with missing `PLAYWRIGHT_BASE_URL`.
- `node --test scripts/staff-handoff-fixture.test.mjs`: 1 pass. `npm run test:staff-notifications`: 21 Node + 13 Bun pass. These are local contracts, not provider readback or Haze receipt evidence. No live send occurred.

### T06 — multi-source link batch import (R09)

- Reproduced missing parser/module with a red test. The existing wizard offered one source for all selected offers and required manual IDs.
- Added multi-source expansion for selected sale/rent offers and CSV/TSV paste with fixed column order. Parser handles BOM, full-width whitespace, quoted commas, duplicates and 1001-row rejection. It recognizes exact HTTPS 28hse buy/rent detail shapes from repo fixtures and YouTube watch, short and shorts URLs; unrecognized or mismatched URLs stay visible for correction without fetching or following links.
- Pasted rows resolve exact current public offers through T09 canonical selection. Optional staff_reference uses source/account|external-code and only a current, exact source-scoped mapping; names are never guessed. Preview checks source scope and a new final-write trigger rejects wrong-source references. Website rows use website:primary; the existing preview/50-row commit and CSV formula neutralization paths are preserved.
- `node --test src/lib/whatsapp-enquiries/link-batch-import.test.mjs src/lib/whatsapp-enquiries/link-batch-import.db.test.mjs`: 5 pass; `npm run test:whatsapp-enquiries`: 98 pass; `npm run test:admin-properties`: 29 Node + 20 Bun pass; migration manifest 6 pass; typecheck and changed-file ESLint pass. A first batch-suite run exposed a stale PGlite reference fixture lacking namespace; the fixture was updated and the suite reran cleanly.
- Live browser workflow and isolated Neon migration remain staging gates. No external site or provider was fetched or sent to.

### T07 — inline batch repair, eligible subset and draft recovery (R10, R13)

- Reproduced the 60-row case: one blocked row disabled the whole wizard submit. The first pure-contract test failed because subset and actor-scoped draft helpers were absent.
- Preview now shows each row's source, public number, sale/rent, placement ID, route and create/reuse/blocked decision. Placement, source, route and verification can be edited inline; any edit invalidates the signed preview. A selected eligible subset requires an explicit confirmation and a fresh batch ID/token before final submit. Excluded rows remain in a versioned actor-scoped local draft. JWTs, provider user IDs and raw recipients are not serialized.
- Draft and progress storage are isolated by the signed-in user's ID. Returning from Haze settings preserves the draft ID, staff context and all excluded rows, then requires a new preview. Browser session recovery retains durable chunk IDs. An empty status lookup cannot cause an unknown chunk to be sent again.
- Commit now snapshots staff mapping versions at preview and locks actor/staff, role, mapping, reference and source offer rows while revalidating. A changed mapping version or reference scope returns a conflict before mutation. Existing committed chunk retries still return their recorded result. Existing SQL rechecks current offer, staff eligibility and actor role in the same transaction.
- Results can copy known successful links and export source-filtered CSV using the existing formula-neutralizing cell function. Only known failed/blocked rows are offered for repair; unknown outcomes are excluded. Unfinished rows are saved separately.
- `bun test src/lib/admin/whatsapp-batch-draft.test.ts`: 2 pass. `npm run test:whatsapp-enquiries`: 98 pass. `npm run test:admin-properties`: 29 Node + 23 Bun pass. Migration manifest: 6 pass. `npm run acceptance:whatsapp-link-handoff`: 9 isolated Chromium pass, including 60-to-59 fresh preview. Typecheck and changed-file ESLint: pass.
- The browser acceptance uses synthetic API and does not prove a tenant rollout. Disposable Neon migration, authenticated staging UX, and real provider state remain external gates. No live provider send or production migration was run.

### T08 — website tracking coverage and controlled backfill (R08)

- Reproduced missing coverage modules, then added canonical sale/rent coverage from the T09 current-offer query. Embedded PostgreSQL verifies inactive and newer-withdrawn offers stay outside the denominator, sale/rent of one public number remain separate, other-source and unverified links do not count, and multiple active website candidates are conflicted rather than arbitrarily covered.
- Admin link management now shows eligible, covered, missing and conflicted counts with checked time, search, deal filter and missing-only view. Operators select missing offers and request an explicit preview. The server validates the exact selected current IDs and signs a fresh `website:primary` batch; no GET, page load or preview commits a tracking link. The wizard still requires final confirmation and durable 50-row commits.
- Public home, listing and detail loaders share contextual fallback actions. The batched resolver accepts only one current, enabled, verified, exact website:primary sales link; disabled, missing, stale or conflicting links use the public listing number and sale/rent fallback. It does not disclose staff or provider identity. The existing redirect tests continue to guard HEAD/prefetch from click attribution.
- `node --test src/lib/whatsapp-enquiries/coverage.test.mjs src/lib/whatsapp-enquiries/coverage.db.test.mjs src/lib/whatsapp-enquiries/coverage.preview.test.mjs src/lib/whatsapp-enquiries/public-context.test.mjs`: 6 pass. `npm run test:whatsapp-enquiries`: 102 pass. `npm run test:listing-search`: 90 Node + 12 Bun pass. Typecheck and changed-file ESLint: pass.
- Authenticated public browser acceptance requires a confirmed disposable Neon target; it was not run against production. The backfill preview and real CTA attribution remain staging gates. No live backfill, provider call, or database migration was run.

### T10 — transaction attribution model (R06)

- Reproduced: no private attribution table or write API existed; the first database test failed on the missing module. Existing `transactions` had author and public provenance, but no separate agent credits or commission.
- Added a private current row, append-only version history and per-agent credits keyed by transaction/version. Existing rows are not backfilled. Decimal HKD receivable/received amounts distinguish null from zero; negative/overpaid values fail. A single SQL statement serializes the transaction row, performs expected-version CAS and writes the history/credits. Branch IDs must match current staff assignment when saved, then remain historical snapshots.
- Admin writes are allowed; manager writes and reads are scoped to the current owner branch. Agents cannot access private finance. Verified attributed deals require exactly 10,000 bps; verified unattributed deals have no credits. Cancellation keeps history. Each correction requires a reason and increments the version. Existing editor updates cannot silently change confirmed price, date, deal type or provenance; both SQL trigger and server boundary guard this. The public transaction reader has no finance join.
- `node --test src/lib/neon/transaction-performance.db.test.mjs`: 9 pass (embedded PostgreSQL; 60/40, invalid shares, duplicate, null/zero, CAS, sale/rent mismatch, branch snapshot/scope, legacy rows, append-only history and public boundary). `node --test src/lib/neon/admin-transactions.contract.test.mjs`: 14 pass. Migration manifest: 6 pass. Typecheck and changed-file ESLint pass.
- Migration is registered as `20260927160000_transaction_sales_attribution.sql` but has not been applied to an external database. Isolated Neon migration, form integration, and authenticated browser acceptance remain T11/staging gates. No production data was changed.

### T11 — transaction attribution workflow (R06)

- Reproduced missing editor and lookup flow with a red Bun component test. A new transaction now opens its edit page after the base record is created; the edit page stays open after base saves and shows the private attribution panel only to a resolved admin or manager staff role. Agents cannot call the finance server functions: each boundary requires admin/manager, and finance list filtering rejects agent requests.
- Staff, lead and current public listing searches are server scoped, query limited to ten, and keyed by the entered term. Manager lookups and writes are restricted to their current branch. The final atomic write also checks lead and credited staff branch ownership, current exact sale/rent offering and optimistic version; a forged request cannot rely on the UI lookup restriction alone.
- The panel supports draft, verified attributed, verified unattributed and cancelled states; lead, current public number, 60/40 credits, branch snapshot, HKD receivable/received and a reason. Complete attribution requires 100%; unknown commission remains null, explicit zero remains zero. Hong Kong dates round trip over UTC midnight. Stale version errors require a deliberate reload. The list shows missing/draft/unattributed/cancelled quality states with a server-side filter, while hiding finance status outside an actor's scope.
- The base form now separates verified source evidence from public publication. An internally verified transaction may remain unpublished; public pages still filter `published` and `verification_state`, and their DTO has no private commission or lead join.
- `bun test src/components/admin/TransactionAttributionEditor.test.tsx`: 5 pass. `node --test src/lib/neon/transaction-performance.db.test.mjs`: 9 pass. Admin transaction contract: 17 pass (including embedded branch visibility). Admin route + public transaction contracts: 22 pass. Typecheck and changed-file lint pass. No external migration or authenticated staging browser run was performed; those are staging gates before rollout.

### T12 — source-backed performance events and quality (R05, R14)

- Added an idempotent event projection, captured by SQL triggers in the same transaction as explicit lead qualification, completed viewing, provider-confirmed assignment, trusted first human response and versioned deal confirmation/cancellation. The original CRM, WhatsApp and transaction rows remain authoritative. A server-only repair interface reselects those source rows; caller-supplied quality, staff and event time cannot create metrics.
- New events start with unknown quality. Admin-only reasoned corrections append quality revisions; earlier verified human response timestamps append occurrence revisions. The effective view applies the latest revision, so day-filtered reports recalculate on read. History rows and lead qualification evidence cannot be deleted or edited. Ambiguous assignment episodes keep a null inquiry link rather than guessing.
- Explicit lead qualification requires evidence, a qualifying CRM stage and admin/manager branch scope. A CRM stage alone does not generate the event. Cancellation uses the cancellation decision time; a prior confirmation remains as history for the report to exclude when the current version is cancelled.
- `node --test src/lib/analytics/performance-events.test.mjs src/lib/analytics/performance-events.db.test.mjs`: 9 pass. Combined event/assignment regression: 16 pass, 1 pre-existing synthetic fixture skip, 0 fail. Typecheck and changed-file lint pass. Migration `20260927170000_performance_event_quality.sql` is registered but has not been applied externally.
- T13 must use the effective event view with current deal versions to avoid counting corrected or cancelled deals twice, and must report unknown coverage. T14 will expose the reasoned quality correction in the admin UI. Staging and real provider acceptance remain blocked by the unavailable test environment and recipient.

### T13 — sales and agent performance API (R05, R14)

- Added an authenticated admin/manager report and paged drilldown API. The server resolves a manager's actual branch and applies parameterized branch, staff, source and sale/rent predicates. Acquisition and current backlog use current staff assignment; verified deal reporting uses saved credit branch snapshots, including after an agent moves branch. Agents have no report route access.
- Acquisition uses Hong Kong date bounds and the earliest inquiry for a lead, with 30/90 calendar-day sale conversion against the inquiry cohort. Immature cohorts are provisional and empty denominators are null. Follow-up reports elapsed median/p90, unanswered and overdue rows, and approved-policy due-time SLA only where evidence exists. Current backlog is labelled as current, not reconstructed history.
- Company deal counts deduplicate transactions; current cancelled/superseded versions are excluded. Sale price excludes rent, commission is separate and null when unknown, and saved credit basis points produce per-agent weighted values. Quality coverage shows production/test/spam/unknown inquiry rows, unknown deal events and legacy verified transactions with no attribution. Unique customer count is unavailable until verified contact identity exists.
- Explicit inquiry quality corrections require admin role and an audit reason; the append-only revision view recalculates results on the next read. Drilldown records apply the same scoped source queries, use keyset pagination and omit customer PII.
- `node --test src/lib/analytics/sales-performance.test.mjs src/lib/analytics/sales-performance.db.test.mjs`: 9 pass; embedded PostgreSQL covers Hong Kong midnight, branch snapshots, cross-branch filtering, legacy attribution and current backlog. Typecheck and changed-file lint pass. The new inquiry quality migration is registered but has not been applied externally; no authenticated staging report or live provider state was verified.

### T14 — scoped performance dashboard and record workflow (R05, R14)

- Added four report areas for acquisition/conversion, response/follow-up, sales/commission and current backlog. Date, branch, staff, source, deal type and 30/90-day cohort filters are validated in the URL; malformed or unknown values show a repair state and do not fetch a broader performance report.
- Metric cards show definition, sample, denominator, provisional/unavailable state and matching scoped records. The agent table keeps weighted sale value separate from commission and exposes column definitions. The record table has bounded server pagination, page-only CSV without customer PII, and admin-only reasoned quality correction for inquiries, events and deals with source evidence.
- Admins and managers can submit explicit lead-qualification evidence from linked inquiry records. The server enforces CRM stage, role and manager branch scope. Corrections and qualification refresh the report and active drilldown. GA4's existing unavailable state remains visible; no traffic values were invented.
- npm run test:analytics: 65 Node and 3 Bun tests pass, 0 fail. The existing aggregate-view SSR harness was updated for the route's new URL state. Typecheck and changed-file lint pass. No authenticated staging browser, external database migration, or real provider readback was run because no disposable staging target or Haze test recipient was available.

### T15 — public media claims and exact estate transport (R15)

- Reproduced unsupported VR wording in public titles and broad district matching that selected the 深井／青龍頭 corridor for 星堤. A normal video URL now does not prove VR. Only a supported HTTPS Matterport or Kuula tour enables the VR tab and preserves a VR claim; the same display cleanup is used by home/search/detail titles and listing SEO title/description. Source and authored CMS fields remain unchanged.
- Listing detail transport now uses an exact estate-to-curated-corridor mapping. 星堤 and other unmatched estates show a neutral district guide link and no guessed route text. The 2026-09-27 timestamp records mapping review against existing curated copy, not an external check of current transit schedules.
- The full SEO suite passed 61 Node + 6 Bun; property experience passed 199 Bun + 146 Node; estate content passed 9 Node; typecheck and changed-file lint passed. No authenticated staging browser or actual A074714 media record was available to inspect, so live visible/OG/current media acceptance remains external.
- The broad property suite exposed six staff foreign keys from earlier slices that were absent from the staff deactivation ownership registry. Review subjects, deal-credit snapshots and actor fields are now classified as historical evidence rather than reassigned ownership. The schema-derived staff ownership contract passed 6/6 after the correction.

### T16 — responsive owned property media (R16)

- Reproduced the remote-image gap: local generated assets had srcset, but an owned MLS URL had no real 160px thumbnail candidate. Added deterministic 160/320/640/960/1280 WebP files from validated owned source bytes, bounded by source width, 16 MB and 20 million pixels. Source SHA-256, exact HTTPS host and actual Blob upload metadata are checked; changed source hashes cannot read old variants.
- The MLS publish path writes variant metadata against the owned asset while retaining the original URL. Public read models attach ready variants in bounded server-side batches only when MLS_MEDIA_VARIANTS_ENABLED=true. AppImage uses the real variant URLs for srcset, with explicit sizes and the original as fallback. Optional variant metadata errors no longer block validated original-image publication; a red regression test proved that failure before the fix.
- Registered additive migration 20260927172000_media_asset_variants.sql. Added a staging-only, allowlisted, limited and checkpointed backfill with dry-run default. No external migration or backfill was run.
- npm run test:media: 13 Bun + 5 Node pass. npm run test:mls: 641 Node pass. npm run test:property-experience: 199 Bun + 146 Node pass. npm run test:listing-search: 90 Node + 12 Bun pass. Typecheck, changed-file ESLint and migration manifest pass. The MLS repository surface test was updated for the two new methods after it exposed the mismatch.
- Browser currentSrc, actual remote bytes/dimensions and layout shift, cache behavior, and backfill idempotence require the unavailable disposable staging target and owned Blob fixtures. The feature flag remains off; no production media was changed.

### T17 — final regression and performance acceptance (R09, R10, R16, cross-domain)

- Added `scripts/acceptance/final-remediation.mjs` and its CI-wired control-plane test. The evaluator checks a 13-case matrix, target/fixture identity, paired cold and at least 20 warm baseline/revised samples, row counts, errors, SQL plans, p50/p95 and stated product targets. Without evidence it writes explicit skips. Its result JSON records 0 passed, 0 failed and 13 skipped, not a performance pass.
- The user confirmed there is no disposable staging URL/database, Haze test tenant or consenting recipient. No 1/50/300/1,000-row load, 20×3-source load, 10k/100k-event report load, SQL EXPLAIN, mobile currentSrc/Core Web Vitals, authenticated staging journey or provider send was run. No authenticated staging screenshots or measured performance samples exist; the acceptance result must remain skipped. `docs/reports/final-remediation-performance.md` lists exact unverified targets and the evidence contract.
- Final local suites: control-plane 104 Node; transactions 69 Node + 5 Bun; WhatsApp enquiries 102 Node; analytics 65 Node + 3 Bun; SEO 61 Node + 6 Bun; listing search 90 Node + 12 Bun; admin properties 29 Node + 26 Bun; staff notifications 21 Node + 13 Bun; media 13 Bun + 5 Node; MLS 641 Node; property experience 199 Bun + 146 Node. Each completed with zero failures. Typecheck, repository-wide lint and production build passed. The first full lint attempt included the Git-ignored generated .audit bundle and found eight branch-owned files needing formatting; after aligning the ESLint ignore and formatting those files, the full lint rerun passed. The build emitted dependency-version and large-chunk warnings, with no build error.
- The control-plane wiring guard exposed two transaction tests missing from all named scripts. They were added to `test:transactions`, whose full run passed. The acceptance evaluator test was added to the CI-run `test:control-plane` script.

### T18 — release handoff (R01–R16)

- Added `docs/runbooks/final-remediation-rollout.md` with the nine pending additive migrations in order, identity/backup preflight, old/new reader checks, per-capability pilot evidence, media backfill gate, production smoke and audit-preserving rollback. No external migration, backfill, provider send, production seed or deployment was performed.
- Added four build-time admin UI switches for directory setup, reviewed save, batch import and sales reporting. Production defaults are off until explicitly enabled after isolated evidence; server authorization remains in force. The existing single-link wizard and operational analytics remain available. Added a Traditional Chinese operating guide. Wider rollout remains gated on the missing isolated environment and evidence. The rollout resolver has 2 focused passing tests; the paused batch import still renders the ordinary link wizard. The analytics SSR regression was reproduced when its fixed module mock omitted the new flag import, then passed after the disabled-flag mock was added. The named admin-properties, staff-notifications and analytics suites pass (29 Node + 26 Bun; 21 Node + 13 Bun; 65 Node + 3 Bun respectively), as does the CI test-wiring guard (9 Node).
