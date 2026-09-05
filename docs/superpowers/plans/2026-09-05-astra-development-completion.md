# Earnest Property completion implementation plan for Codex 6 Astra

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task by task. Use independent reviewers for authorization, database concurrency, and message delivery changes. Checkboxes track delivered and verified work, not merely edited files.

**Goal:** Finish the existing public website, CMS and CRM as a reliable operational product, with reproducible release evidence and measurable performance.

**Architecture:** Retain TanStack Start/React, Neon Postgres and Neon Auth, the existing revision-based CMS, and WozTell integration. Deepen the existing server boundaries instead of replacing the application. Public read models, CMS editing/publishing, CRM intake, and provider delivery have separate contracts and tests.

**Tech stack:** React 19, TanStack Start/Router/Query, Vite/Nitro, TypeScript, Neon serverless Postgres/Auth, Tailwind/Radix, Node tests, Bun tests, Playwright/axe, Vercel; Cloudflare Container/Workflow/R2 for the existing MLS pipeline.

## Starting state and scope

- Audit date: 2026-09-05, Asia/Hong_Kong.
- Source baseline: GitHub main `897f01ac372063113b5a42de9593fe33252d8dc0` (PR #111).
- Working copy with this plan and focused fixes: `C:/Users/laich/Documents/Earnestproperty/Earnestproperty/.worktrees/audit-20260905`, branch `codex/audit-20260905`.
- The original open checkout is `codex/fix-neon-auth-get-user` at `3cbaaf7`, 429 commits behind audited main, with unrelated local work. Do not implement this plan there or merge historical worktrees wholesale.
- Read `docs/audits/2026-09-05-current-status.md` before execution. Reverify main and the deployment commit; these are dated observations.
- Focused changes already prepared here: video predicate before database pagination; six missing CI suites; a CI coverage regression; Windows path/newline test-harness repairs. Review and integrate this slice before starting larger changes.
- This document is an execution plan, not evidence that the remaining development is complete.

## Global constraints

- Preserve Traditional Chinese public copy, canonical URLs, SEO metadata, staff role boundaries, existing customer data, and unrelated local work.
- Use the codebase graph for discovery. Index the chosen worktree under its own project name; do not trust a graph from another branch.
- Keep public schemas validated, SQL parameterized, private response fields bounded, and staff authorization on the server. Never rely on sidebar visibility for permissions.
- Never load production credentials into test commands. Database concurrency/migration tests require an explicitly identified disposable database. Control-plane/YouTube use `TEST_DATABASE_URL`; MLS uses `DATABASE_URL_TEST` plus `MLS_TEST_DATABASE_CONFIRMED=true`. Existing integration suites run their own migrations, so separate owner-driven fixture setup from least-privilege runtime tests before testing grants.
- Local fixes, tests, documents, and draft PR preparation are within the requested work. Production migrations, seeding, deployment, paid provider work, and real outbound messages require explicit authorization for the concrete action. Do all safe preparation first.
- Do not publish a broadcast to prove a test passes. Use an injected fake provider, then an approved staging channel and named test recipients.
- Do not run a provider send again when the first attempt may have succeeded. Represent unknown delivery explicitly.
- No raw customer text, phone, email, session token, or query/hash payloads in analytics or audit artifacts.
- No redesign or platform migration is needed to complete this plan. Choose any additional product behavior through one narrow decision before implementing that behavior.

## Release order and independent ownership

| Order | Slice | Depends on | Can run alongside |
|---|---|---|---|
| 0 | Audit-fix integration and repeatable validation | Current-main comparison | Read-only staging inventory |
| 1 | Staff bootstrap verification | 0 | CMS data-contract investigation |
| 2 | CMS full-record loading, draft recovery and publishing | 0, then 1 for staging roles | Message delivery work in separate files |
| 3 | Transactional CMS mutations | 2 | Public media optimization |
| 4 | Messaging cancellation/consent and durable outbound delivery | 0 | CMS slices, separate ownership |
| 5 | CRM intake and complete retrieval | 4 contract, 0 | Public performance work |
| 6 | Frontend performance and keyboard repair | 0 | CMS/CRM implementation |
| 7 | Production analytics and operational measurement | Intake identity contract | Public performance work |
| 8 | Staging acceptance and production release | All previous required gates | None for final release decision |

Keep each slice independently reviewable. Split a slice into smaller PRs where a reviewer could accept one behavior without accepting its neighbor. Do not allow two agents to edit `admin-data.server.ts` concurrently.

## Task 0: Integrate the audit fixes and establish dependable verification

**Files:** Existing audit diff; `.github/workflows/ci.yml`, `.github/workflows/migration-drift.yml`, `src/test-wiring.test.mjs`, `package.json`, `playwright.config.ts`, `e2e/`. Add `.gitattributes` only in a separate reviewed newline-normalization change if selected.

- [ ] Review the local video filter and CI/test-harness diff. Preserve the regression with 40 newer listings without video and older valid videos. Verify `hasVideo` survives the complete server-function boundary.
- [ ] Pin/record Node and Bun versions consistent with CI (Node 24, Bun 1.3.12 at the audited baseline). Use the lockfile. Do not upgrade framework packages during diagnosis.
- [ ] Recheck route generation in the execution environment. The first Windows build had an `EPERM` replacing `src/routeTree.gen.ts` and a downstream missing-manifest exception; a clean retry passed without application/dependency changes. Record this as a transient observed filesystem failure, not an unresolved build blocker. Investigate process locks/path handling only if it recurs; do not upgrade the framework speculatively.
- [ ] Run every deterministic `test:*` script. Explicitly register every database-dependent `:db` suite and `test:a11y` as environment-dependent, and run those in their own environment. There are three database suites at baseline; adding `test:cms:db` increases that count. Extend the coverage guard to validate the explicit registration list. Keep the new CI-coverage guard so new scripts cannot be silently omitted.
- [ ] Make lint/typecheck failures fail CI on process exit as well as parsed counts. Maintain or lower the existing lint ceiling until a separate cleanup reaches zero; do not increase the budget to hide a regression. Separate CRLF-only diagnostics from semantic errors.
- [ ] Give migration-drift CI a read-only database credential through the approved settings path. Record the target branch/database and check grants without printing values. Run only the SELECT-based drift check. A missing credential is not proof of unapplied migrations.
- [ ] Add a staging browser job with pinned Chromium and explicit base URL. Configure local server startup only for local runs; the current Playwright config always starts/probes localhost even when a remote base URL is supplied.
- [ ] Commit the focused slice with explicit file paths after review. Open a draft PR with Linux and Windows results and any remaining environment gate.

Commands:

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd run build
node --test src/test-wiring.test.mjs
npm.cmd run test:listing-search
npm.cmd run test:videos
npm.cmd run test:cms
npm.cmd run test:command-center
npm.cmd run test:woztell
```

**Done:** Exact-head Linux build/CI passes, the local build either passes or has a separately reproduced platform blocker with an owner, all deterministic suites are exercised, and drift monitoring has an authenticated read-only result. A green Vercel status alone is insufficient.

## Task 1: Verify owner identity before first-admin bootstrap

**Files:** `src/lib/neon/auth.server.ts`, `src/lib/neon/auth.server.test.mjs`, `src/lib/neon/staff-security-policy.test.mjs`, `.env.example`.

**Existing boundary:** `createStaffAccessResolver()` returns `requireStaffAccess(request, allowedRoles)`. Reuse the existing `isNeonAuthEmailVerified` helper; inspect its current parameter contract before editing.

- [ ] Add injected-resolver cases for allowlisted verified owner, allowlisted unverified owner, provider lookup failure, mismatched provider identity, non-allowlisted identity, existing admin, and disabled staff.
- [ ] Reproduce that an unverified allowlisted identity in a bootstrap-eligible database receives admin today. Assert zero staff/role writes for all denied cases.
- [ ] Require verified email for the same authenticated provider identity before `bootstrapFirstStaff`; fail closed on missing/unavailable verification. Preserve existing staff/role checks and protected-owner rules.
- [ ] Verify simultaneous first logins cannot create unintended multiple bootstrap owners; use a database lock/constraint and disposable-database race test if existing policy lacks that guarantee.
- [ ] Document the first-login procedure and recovery mechanism. Do not seed an owner or alter production auth settings as part of this code task.

```powershell
npm.cmd run test:team
npm.cmd run test:property-experience
npm.cmd run test:neon-auth
```

**Done:** An unverified or unverifiable identity cannot create an admin, while the intended verified first-owner path and existing staff access pass. Treat this as a release gate for any new/reset environment; current production exploitability was not established by the audit.

## Task 2: Make CMS editing recover the authoritative full draft

**Files:** `src/lib/neon/admin-cms.types.ts`, `src/lib/neon/admin-cms.ts`, `src/lib/neon/admin-cms.server.ts`, `src/lib/neon/admin-data.server.ts`, `src/routes/admin.cms.tsx`, `src/routes/admin.estates_.$id.tsx`, `src/components/admin/estates/AdminEstateEditorForm.tsx`; existing `admin-cms*.test.mjs`, `cms-revisions.test.mjs`, `admin.cms-revision-wiring.contract.test.mjs`, `admin.estates.routes.test.mjs`. Add behavioral editor tests and wire them into `test:cms` / `test:admin-estates`.

**Proposed shared edit response:** Define it once beside the CMS types and use it in both editors.

```ts
export type CmsEditState<TPayload> = {
  resourceId: string;
  draftRevisionId: string | null;
  draftVersion: number | null;
  draftEditVersion: number | null;
  currentPublishedVersion: number | null;
  basePublishedVersion: number | null;
  payload: TPayload;
  restoredFromRevisionId: string | null;
};
```

- [ ] Reproduce four workflows: create draft then close/reopen; edit a published record then reopen; restore an old revision then inspect/publish; edit an estate with no historical revision row.
- [ ] Fetch the complete authorized resource by ID. Recover the current actor's draft; manager/admin review of another author's draft must be explicit. Otherwise use the full current publication/live record. Test two staff members with separate drafts. Never use a capped summary list as the full-record fallback, or a 20-row history window to resolve the current publication.
- [ ] Include draft-only resources in CMS listing and identify their state. Draft persistence must survive navigation and browser reload.
- [ ] Hydrate payload and its original `basePublishedVersion` together after load/save. Keep `currentPublishedVersion` separate: refreshing metadata must not silently rebase stale content. Restore creates a newly reviewed draft against the explicitly resolved current publication. Do not ignore payloads or overwrite them with old live form values.
- [ ] Pass `basePublishedVersion` from both Save and Publish in the dedicated estate editor. Publish should target the reviewed revision rather than silently saving stale values again.
- [ ] Preserve estate aliases, address, district ID, block counts, area/PSF details, coordinates and verification metadata when editing one unrelated field.
- [ ] Return an explicit recoverable conflict state if another staff member publishes. Keep unsaved local text available and offer reload/compare; never silently override.

**Done:** A new article draft is discoverable after reload; both estate editors can publish a second version; a restored old body is actually displayed and published; editing only an estate title leaves all other fields unchanged; drafts remain absent from public queries.

## Task 3: Make CMS save, publish, restore and archive atomic

**Files:** `src/lib/neon/admin-cms.server.ts`, `src/lib/neon/cms-revisions.ts`, existing CMS tests, and a new disposable-database integration suite wired as `test:cms:db` with explicit CI exclusion/coverage documentation. Add a migration only if constraints/indexes are missing.

**Invariants:** Published revisions are immutable; one logical resource serializes version allocation; live projection, revision state and audit outcome commit together; historical restore source and current publication base are different fields.

- [ ] Reproduce concurrent draft-save/publish, two new version allocations, archive mid-failure, and restore from version 1 while version 3 is currently published.
- [ ] Establish a per-resource transaction lock with the same identity shared by all revision mutations, including the draft-only to published transition. Prefer locking a stable resource row; use a transaction-scoped advisory key for draft-only resources if required. Enforce version uniqueness with a database constraint.
- [ ] Add an incrementing persisted `draftEditVersion` token returned by the shared edit response (or make saves append-only). Existing saves reuse `version_number`, so that number alone cannot reject stale same-draft saves. Update only a still-draft revision with the expected edit token and increment it atomically; check the affected-row count. Do not mutate a row that another transaction has published.
- [ ] Restore the chosen historical payload with `restoredFromRevisionId` pointing to that history and `basePublishedVersion` pointing to the current publication (or null if unpublished).
- [ ] Commit archive revision, public visibility change, previous revision supersession and audit record in one transaction. Fault injection at each write must leave either the old complete state or new complete state.
- [ ] Reconcile legacy live estates without revisions on the disposable branch first; produce an idempotent migration/dry-run report for later approval.

**Acceptance matrix:** Two different drafts based on the same publication race to publish: exactly one succeeds and the other conflicts. Two stale saves of the same actor's draft cannot overwrite one another silently. Also test first publication, archive-versus-publish, immutable published snapshots and archive rollback. Enforce actual `admin`, `manager`, `agent`, `viewer` and unauthenticated permissions directly on every operation.

## Task 3B: Complete the other CMS content and upload boundaries

**Files:** `src/lib/neon/admin-cms.types.ts`, `src/lib/neon/admin-cms.server.ts`, video/FAQ/media operations in `src/lib/neon/admin-data.server.ts`, `src/routes/admin.cms.tsx`, `src/components/dashboard/ImageUploader.tsx`, `src/routes/api.admin.media.upload.ts`, YouTube synchronization repository and CMS/media tests.

- [ ] Define the editorial lifecycle for videos and FAQs explicitly. Recommend upstream YouTube facts plus a separate editorial overlay; synchronization must preserve staff titles, tags, visibility decisions and publication history. Confirm this policy before changing direct-write semantics.
- [ ] Integrate editorial video/FAQ create, edit, publish, import and delete into the approved lifecycle, with conflict tokens and audit history. Distinguish source deletion/unavailability from an editor intentionally archiving content.
- [ ] Keep uploads as asset creation and associate their use with content revisions; do not require a public content revision before uploading a draft asset. Reconcile existing direct-write records without changing their actual public visibility.
- [ ] Use the existing staff authorization header helper in both upload callers. Test an authenticated bearer-only session as well as the supported cookie session, revoked staff and non-staff access.
- [ ] Reproduce Blob success followed by metadata-write failure. Keep a recoverable upload identity, support safe retry/reconciliation and prevent duplicate uploads/abandoned assets where practical. Test size/type limits and missing credentials without printing raw provider errors.

**Done:** Video synchronization cannot silently overwrite editorial decisions; FAQ imports/deletions preserve the agreed visibility/history contract; both upload callers pass the server's real auth boundary; partial upload failures have a visible recoverable outcome. Database/storage integration uses approved staging resources.
## Task 4: Stop undispatched campaign work after cancellation or opt-out

**Files:** `src/lib/woztell/campaign-delivery.server.ts`, `src/lib/neon/admin-data.server.ts` (`cancelAdminCampaign`), `src/lib/control-plane/jobs.server.ts`, campaign/operations tests. Add deterministic delivery tests with a controllable fake provider.

- [ ] Reproduce cancellation and STOP after a batch of 20 has been claimed but before the next dispatch.
- [ ] Revalidate current campaign, recipient, consent and template eligibility immediately before each provider call, with a durable state transition shared with cancellation. Do not use only the claim-time consent snapshot.
- [ ] Cancel queued work and claimed-but-undispatched recipients; make the worker notice cancellation without waiting for the whole batch. Checkpoints must consider campaign cancellation as well as job ownership.
- [ ] Record an irreversible dispatch boundary. Define the guarantee as preventing messages that have not crossed that boundary; cancellation cannot retract a request already accepted by the provider.
- [ ] Verify revoked consent, expired template/eligibility, job-lease loss and concurrent cancellation each prevent later sends. Display already dispatched, cancelled, failed and unknown states accurately.

**Done:** The fake provider receives no further undispatched recipients after a completed cancellation/opt-out transition. Audit records explain which messages had already crossed the dispatch boundary. Staging uses only approved test contacts.

## Task 5: Add durable, idempotent replies and event reconciliation

**Files:** `src/routes/api.admin.woztell.send.ts`, `src/routes/api.admin.woztell.send-template.ts`, `src/lib/woztell/woztell.server.ts`, `src/lib/woztell/woztell-history.server.ts`, `src/lib/woztell/woztell-ingest.server.ts`, `src/routes/admin.whatsapp.tsx`, shared jobs/repository boundary; a new outbound-intent migration and tests.

**Proposed outbound contract:** Keep the UI request ID stable across retries of the same intended message, including page recovery. The server owns status transitions.

```ts
export type OutboundState =
  | 'queued' | 'dispatching' | 'accepted' | 'unknown' | 'failed' | 'cancelled';
export type OutboundIntentInput = {
  requestId: string;
  conversationId: string;
  kind: 'text' | 'template';
  payload: Record<string, unknown>;
};
```

- [ ] Use validated kind-specific payload schemas in implementation; a broad record above is only the transport envelope. Store a payload hash and reject reuse of one request ID for a different message.
- [ ] Persist one authorized outbound intent before provider work. Enforce uniqueness in the database, return the same intent on duplicate POST, and execute through the existing durable job boundary.
- [ ] Add provider deadlines and response-size limits. Deadline/body failure after dispatch enters `unknown`; it must not trigger blind automatic resend.
- [ ] Persist external provider message identity and reconcile webhook/history events to the local row, including events that arrive before the send response is stored.
- [ ] Replace contact/conversation SELECT-then-INSERT races with transactional conflict-aware upserts; retain identity conflict detection and staff scope.
- [ ] Test duplicate POST, same-ID/different-payload rejection, concurrent webhook/backfill, out-of-order callbacks, provider acceptance plus response loss, and accepted response plus database failure.
- [ ] Add resumable history-import jobs with a persisted cursor; retain the cursor after the current 20-call UI limit or replace that UI loop with job progress.

**Done:** Retries create one intent; no test proves exactly-once provider delivery without provider support. Instead, retries cannot knowingly duplicate dispatch and ambiguous attempts require reconciliation. One provider message has one transcript identity; interrupted imports resume beyond the first 20,000 messages.

## Task 6: Complete customer intake, ownership and consent lifecycle

**Files:** `src/lib/neon/website-inquiry.js`, `src/lib/neon/admin-data.ts`, `src/lib/neon/admin-data.server.ts`, `src/lib/woztell/woztell-ingest.server.ts`, `src/routes/admin.leads.tsx`, `src/routes/admin.whatsapp.tsx`, relevant schemas/migrations and intake tests.

**Decision to resolve once:** Recommend that a new actionable WhatsApp enquiry create one triage lead and attach later messages to an existing open lead, with an explicit unassigned queue until an authorized staff member owns it. Confirm whether every new chat or only staff-qualified enquiries should create leads. Do not silently choose a sales policy.

- [ ] Define contact, conversation, inquiry and lead links and transition ownership in one service. Preserve website inquiry's existing atomic persistence and server-derived listing assignment.
- [ ] Add a stable public submission ID with duplicate detection and a bounded replay policy. Network retry must not create another lead/inquiry.
- [ ] Implement the agreed WhatsApp-to-lead transition and visible ownership/triage status. Define inquiry-status versus lead-stage changes explicitly rather than allowing inconsistent independent updates.
- [ ] Separate service interaction from marketing consent. An inbound message alone must not manufacture marketing permission. Record explicit consent source, time and copy/version; protect existing identity and consent from forged phone-only public submissions.
- [ ] Provide an audited opt-in/opt-out workflow with role checks. Repeat consent submissions must produce an accurate user/staff outcome rather than reporting an update that was discarded.

**Done:** Both public and WhatsApp enquiries are traceable through accountable staff handling; duplicate intake is harmless; consent changes have evidence; ownership boundaries hold across every status/query operation.

## Task 7: Make CMS and CRM retrieval complete and bounded

**Files:** `src/lib/neon/admin-data.server.ts`, `src/lib/neon/admin-data.ts`, `src/routes/admin.leads.tsx`, `src/routes/admin.whatsapp.tsx`, `src/routes/admin.cms.tsx`, media/video repositories and admin tests.

**Proposed list envelope:** Define one shared pagination shape. Keep each resource's filters explicit and validated.

```ts
export type CursorPage<T> = {
  rows: T[];
  nextCursor: string | null;
  total: number;
};
```

- [ ] Replace capped snapshot search with authorized server-side filters and stable `(updated_at, id)` or `(created_at, id)` cursor ordering. Apply staff scope before search, count and page limits.
- [ ] Add separate older-message pagination. New-message polling must not reload the entire transcript or erase a drafted reply/scroll position.
- [ ] Paginate media and video administration, which currently load all rows. Load only the active CMS tab; invalidate the resource that changed.
- [ ] Use realistic synthetic fixtures: at least 10,000 contacts/leads, 1,000 content records and 100,000 messages. Verify last/older records remain discoverable and cursors do not duplicate or skip equal-time records.
- [ ] Capture `EXPLAIN (ANALYZE, BUFFERS)` in the disposable database; add indexes for measured filter/order predicates. Do not add speculative production indexes.

**Proposed performance budgets:** With the fixture size above, staging p95 list endpoint <=500 ms, <=50 records per response, and no unbounded transcript/media payload. Record region, cold/warm state and sample size. Adjust budgets only with documented business/hosting constraints.

## Task 8: Reduce public page transfer and query work

**Files:** `src/components/media/AppImage.tsx`, `src/routes/index.tsx`, `src/routes/contact.tsx`, `src/routes/__root.tsx`, `src/lib/neon/public-data.server.ts`, `src/lib/queries.ts`, `src/routes/listings.tsx`, `src/routes/property.$listingNo.tsx`, `public/estates/`, `public/branches/`, associated query/media tests and e2e specs.

- [ ] Generate responsive variants from the existing authorized image originals using Sharp or the existing media pipeline. Add width-based `srcset`/`sizes`, retain intrinsic dimensions and fallback alt text, and lazy-load below-fold estate/branch cards. Keep the actual hero prioritized.
- [ ] Compare mobile requests against the recorded 4,880,833-byte homepage resource baseline. Target >=50% resource transfer reduction under the same viewport/method, with no visual regression.
- [ ] Separate listing-card and listing-detail SQL projections. Remove long description, full agent biography and unnecessary media arrays from card results. Target >=30% serialized card-response reduction.
- [ ] Run independent COUNT/row reads concurrently where consistency permits, or use one consistent database read. Cache low-churn estate filter options with explicit invalidation after relevant CMS publication.
- [ ] Deduplicate canonical listings before count and pagination. A fixture with duplicates across page boundaries must have accurate unique totals and stable pages. Preserve sale/rent identity rules instead of merging legitimately distinct offerings.
- [ ] Isolate secondary property-page queries; failed similar-listing/transaction sections must not remove the primary listing or its contact actions.
- [ ] Profile shared public JavaScript. Split staff/auth UI and defer chat internals only when bundle inspection proves the imports are avoidable; retain needed account functionality.

**Done:** Public listing filters and canonical links remain correct, page 2 has stable unique results, optional-service failures degrade one section, and measured transfer/query savings meet the stated budgets.

## Task 9: Finish keyboard and browser interaction acceptance

**Files:** `src/components/live-agent/LiveAgentWidget.tsx`, existing Radix dialog primitives, `e2e/`, `playwright.config.ts`.

- [ ] Write a browser regression for chat: focus trigger, press Enter, assert focus inside dialog, press Escape, assert closed and focus returned to trigger. The live audit reproduced failure on these steps.
- [ ] Use the established accessible dialog mechanism. Preserve draft text and existing send behavior. Choose modal/nonmodal semantics according to actual interaction; do not trap focus in a widget meant to allow page interaction.
- [ ] Cover desktop and mobile navigation, listing filters, pagination/back navigation, saved listings, gallery/video actions, and contact/valuation validation without real production submissions.
- [ ] Add authenticated staging checks for CMS save/reopen/restore/publish, CRM ownership/search and WhatsApp draft/reply recovery with fake/staging delivery.

**Done:** No horizontal overflow at 390 px or 1440 px; no serious/critical automated axe findings in the tested routes; all keyboard flows above pass. A zero axe result alone does not establish accessible interaction.

## Task 10: Implement production measurement with privacy boundaries

**Files:** `src/lib/analytics/events.ts`, `src/lib/analytics/events.test.mjs`, proposed `src/lib/analytics/attribution.ts`, proposed provider component, `src/routes/__root.tsx`, inquiry schema/service, aggregate reporting migration and tests.

**Provider decision:** Confirm GA4 versus another analytics provider before credentials/configuration. GA4 is a historical candidate, not an implemented production fact. Review selected commits from the old GA4 branch for ideas; do not merge its old auth/application tree wholesale.

- [ ] Preserve the existing event taxonomy where it is useful; add a strict event/key registry, field validation and PII rejection at the single dispatch boundary.
- [ ] Implement bounded first-touch attribution. Strip query/hash from page paths; retain only approved campaign tokens and a referrer hostname.
- [ ] Mount production tracking only on permitted public routes. `/admin`, `/auth` and `/account` descendants must create no tracking runtime, listeners or attribution writes.
- [ ] Emit conversion only after successful persistence, once per stable submission ID. Analytics failure must not suppress the success UI.
- [ ] Add Web Vitals using the documented library and correct lifecycle semantics. Do not claim INP from page-load-only tests.
- [ ] Build aggregate operational/funnel views, keeping customer records separate from analytics payloads. Test invalid provider config, corrupt storage, navigation, retries and prohibited fields.

**Done:** Controlled staging conversion emits once, failed persistence emits none, private routes emit none, and sampled analytics payloads contain no customer text/identity. Production field targets: p75 LCP <=2.5 s, INP <=200 ms, CLS <=0.1, segmented by mobile/desktop. These are [Google's Core Web Vitals targets](https://web.dev/articles/vitals); a small local lab sample does not establish field compliance.

## Task 11: Complete operational readiness and staged release

**Files:** Existing operations/control-plane modules, MLS/YouTube job modules, `.github/workflows/migration-drift.yml`, runbooks under `docs/`, deployment configuration only when verified necessary.

- [ ] Inventory production/staging provider configuration by variable name, source and presence only: Neon database/Auth, WozTell Bot/Open API/channel secret, Blob, MLS Cloudflare/R2, YouTube, AI/research and analytics. Record which capabilities are enabled and tested; an enabled badge is not successful provider evidence.
- [ ] On staging, test migrations from both an empty database and a representative previous schema. Verify public projection counts, staff scope, draft isolation, lead links and constraints after migration.
- [ ] Measure the staff journeys with synthetic records and approved staff accounts. Record p50/p95 timings, query counts and response sizes; the audit could not measure authenticated CMS/CRM latency.
- [ ] Test injected provider timeouts, database failure, job lease expiry, retry exhaustion, upload failure and partial publication recovery. Surface actionable failure states and retain bounded diagnostic IDs.
- [ ] Verify MLS/YouTube freshness from read-only job evidence and content timestamps. Historical listing dates on public pages alone do not prove the sync is broken. Keep source/media-rights publication gates intact.
- [ ] Produce a release record: exact commit, CI URL, preview URL, migration list, database target, provider/test recipients, acceptance results, monitoring owner, backup/restore proof and rollback action.
- [ ] Obtain approval for that concrete production release/migration/provider action. Apply in the planned order, check the exact new deployment, verify representative public and staff flows, and roll back on a failed acceptance gate.

## Definition of finished

- [ ] CMS full records/drafts recover after reload; both editors publish repeat versions; restore and archive are correct and atomic; concurrent writers cannot corrupt history.
- [ ] Video/FAQ editorial lifecycle and media creation/recovery meet the approved synchronization/visibility contract; both upload callers pass authenticated staging tests.
- [ ] Staff bootstrap and every CMS/CRM mutation enforce verified identity/roles on the server.
- [ ] CRM and inbox search cover the complete authorized dataset with bounded requests; customer enquiries have an explicit ownership/lifecycle contract.
- [ ] Opt-out/cancellation stop undispatched campaign work; replies have durable intent/reconciliation and explicit ambiguous delivery.
- [ ] Public routes pass browser journeys and performance budgets; listing video selection and pagination remain correct.
- [ ] Production analytics/operational monitoring is configured and verified, including a functioning migration monitor.
- [ ] Exact release commit passes required Linux, browser and disposable-database checks, with a recorded production verification/rollback result after approval.

No percentage-complete estimate substitutes for these acceptance gates.
