# WhatsApp enquiries — Phase 0 through Phase 3

Current review gate: Phase 3. Phase 2 and Phase 3 local implementation completed; live tenant verification remains blocked. Phase 4 is not activated.

## Repository evidence

- Repository: YNWAforever/earnestproperty.
- Branch: `codex/whatsapp-enquiries-p1`.
- Base/HEAD at start: `74d906d225d8d5ac3e20677521de870fa986843c` (same as reviewed baseline and fetched origin/main).
- Worktree: `.worktrees/whatsapp-enquiries-p1`; new isolated checkout. Existing root and daily-runner worktree edits were preserved.
- Read complete supplied plan, START and phase-task prompts, CLAUDE.md and supplied AGENTS graph guidance. No checkout AGENTS.override.md found.
- Original plan preserved byte-for-byte at `docs/implementation/CODEX_EARNESTPROPERTY_WHATSAPP_IMPLEMENTATION_PLAN.md`.
- Existing installed dependencies reused via local junction. No dependency upgrades intended.

## Delivery checklist

- P0-01 repository/current guidance and integration inspection complete.
- P0-02 existing WhatsApp baseline: 130 Node + 8 Bun tests passed before implementation. Additional results in VERIFICATION.md.
- P0-03 progress, decisions, verification and release runbook created.
- P1-01 provider result parser integrated with sender/outbox, documentation fixtures and campaign compatibility tests.
- P1-02 evidence classification and bounded signed webhook scope validation integrated. Unknown/control/note messages do not become customer intake; MANUAL alone does not establish staff authorship.
- P1-03 explicit live/history origin at production ingestion call sites; legacy injected transaction tests retained and updated.
- P1-04 live ledger and registered job insertion appended to the existing transaction; independent live identity dedupe supports history/live races.
- P1-05 observe-only job handler registered. Mode off has no new schema dependency. Observe without schema reports configuration failure. No active implementation.

## Boundaries

Existing TanStack Start, raw Neon SQL, auth, CRM identity, consent, transcript, outbound intents, receipt reconciliation, lead trigger and ops_jobs retained. No replacement framework/database/queue. Phase 2/3 additions are described below; Phase 4 service automation remains absent.

Synthetic identical same-time messages lacking a stable provider ID remain explicitly ambiguous; legacy synthetic keys remain compatible. Phase 1 does not prove exactly-once provider delivery. Unmapped Inbox users remain unverified; no staff mapping has been fabricated.

No production migration, deployment, provider mutation, messages, external link publication, push, remote PR or merge performed.

## Changed files

- `.env.example`
- `.github/workflows/ci.yml`
- `.gitignore`
- `docs/implementation/CODEX_EARNESTPROPERTY_WHATSAPP_IMPLEMENTATION_PLAN.md`
- `docs/implementation/whatsapp-enquiries/DECISIONS.md`
- `docs/implementation/whatsapp-enquiries/PROGRESS.md`
- `docs/implementation/whatsapp-enquiries/RELEASE_RUNBOOK.md`
- `docs/implementation/whatsapp-enquiries/VERIFICATION.md`
- `neon/migrations/20260912120000_whatsapp_enquiry_events.sql`
- `package.json`
- `src/lib/control-plane/job-handlers.server.ts`
- `src/lib/control-plane/jobs.server.ts`
- `src/lib/control-plane/migration-versions.js`
- `src/lib/whatsapp-enquiries/contracts.ts`
- `src/lib/whatsapp-enquiries/event-classification.test.mjs`
- `src/lib/whatsapp-enquiries/event-classification.ts`
- `src/lib/whatsapp-enquiries/webhook.server.ts`
- `src/lib/whatsapp-enquiries/webhook.test.mjs`
- `src/lib/whatsapp-enquiries/workflow.db.test.mjs`
- `src/lib/whatsapp-enquiries/workflow.server.ts`
- `src/lib/whatsapp-enquiries/workflow.test.mjs`
- `src/lib/woztell/history-import.server.ts`
- `src/lib/woztell/outbound-intent.db.test.mjs`
- `src/lib/woztell/outbound-intent.server.ts`
- `src/lib/woztell/outbound-intent.test.mjs`
- `src/lib/woztell/provider-result.test.mjs`
- `src/lib/woztell/provider-result.ts`
- `src/lib/woztell/receipt-regression.test.mjs`
- `src/lib/woztell/woztell-history.server.ts`
- `src/lib/woztell/woztell-ingest.server.ts`
- `src/lib/woztell/woztell.server.ts`
- `src/lib/woztell/woztell.test.mjs`
- `src/routes/api.woztell.webhook.ts`
- `src/test-wiring.test.mjs`

Phase 1 independent review: passed. Exact verification and limits are in VERIFICATION.md.

## Phase 2 and Phase 3 delivery (2026-09-12)

Same branch and base SHA as Phase 1; the prior uncommitted work was preserved. No commit/push/merge/deploy performed.

- P2-01: additive episodes/link/open/service-policy/survey foundations reuse `inquiries`, contacts, leads, transcript and events. Website names remain mandatory; WhatsApp names may be null. Approved policy contents and link versions are immutable.
- P2-02: `/w/$code` resolves a current immutable placement version and public offer, persists a random 192-bit reference hash/context before redirect, central company destination only, no-store/rate bounds; HEAD/prefetch do not mint. No customer identity or enquiry on GET.
- P2-03: both property CTA components receive explicit deal-specific company tracking hrefs from one batch read. Existing telephone, public group/aliases, price and rent/sale behavior remain. Missing/failed resolution uses company contact fallback; public reads do not create links.
- P2-04: admin/manager link search/provision/copy/disable/new-version and placement-verification UI. 28hse ad ID and YouTube video ID stay separate from public property number. No external placement publication.
- P2-05: qualified live events associate with an existing episode or create a root; ambiguity is retained for review. Forwarded references do not merge people. Observe events/episodes cannot gain external-effect eligibility.
- P3-01: admin/manager staff-to-Inbox mapping review/retirement screen; company channel from server configuration. Empty tenant capability table means no verified Inbox evidence capability by default.
- P3-02/03: protected-owner-first proposal policy; every conversation owner mutation (including existing staff handover) enters a versioned pending assignment request. Local owner stays unchanged until authoritative confirmation. Singleflight excludes unknown/executing operations; current-version/mapping snapshot checks prevent stale confirmation. Live provider factory fails closed pending verified contract.
- P3-04: authenticated composer intent carries selected episode; atomic/deferred accepted-provider evidence credits only that episode. Verified Inbox evidence requires persisted live origin, matching provider identity/time and configured capability/mapping. BOT/MANUAL labels alone cannot qualify. Ambiguous replies require selection. Definitively rejected association releases the never-enqueued request; unknown transport outcomes retain it.
- P3-05: inbox enquiry selector/card, deal/source/requested-versus-confirmed/proposed staff, human response evidence and separate service/window labels; same-thread refresh updates evidence. Both server awaiting filter and client attention use outstanding-human evidence. Command-center queue is manager/admin scoped; staff retirement preserves historical attribution and surfaces pending handover.

Phase 3 review fixes: actual composer payload/idempotency association, error-code recovery, stale evidence refresh, rent/sale labels, retirement of stale links, protected-owner and stale-readback races. Targeted independent review has no remaining findings in its reviewed scope. Database concurrency/provider fixtures are synthetic evidence, not live tenant verification.

See VERIFICATION.md for exact tests and RELEASE_RUNBOOK.md for release gates. No Phase 4 automatic service schedule or service send was added.

## Phase 4 and Phase 5 preparation (2026-09-12)

Supersedes the preceding Phase 3-only scope statement. Same branch/base; earlier uncommitted work preserved.

- P4-01: versioned policy draft/review editor and injected-clock simulator. Unresolved policy cannot activate; timezone/real date validation, approved weekday/holiday boundaries, separate overnight 10:00 survey.
- P4-02–04: additive service actor and immutable activation generation; existing outbox and ops_jobs; service-only internal purpose construction, instance-bound survey correlation, protected manager task/assignment, default-closed provider adapter. One-minute service lane source configuration and capability-aware claims.
- P4-05: authenticated operations read model with schema, heartbeat, due work, unknown outcomes, blocked surveys and separate funnel counts. No generic unknown-send retry button.
- P5-01: RELEASE_RECORD.json and read-only readiness checker record missing evidence as blockers.
- P5-02–04: test-tenant scenario, live pilot, placement publishing and expansion remain blocked by missing verified provider contracts, operator policy/template approvals and explicit release authority. Synthetic tests are not live pilot evidence.
- Phase 6: not defined in the supplied plan (which ends at Phase 5); clarification requested, no invented scope.

See PHASE4_5_VERIFICATION.md for current checks and limitations.

## Staff handoff extension P3-N1–P3-N5 (2026-09-12)

Local branch `codex/staff-reference-handoff`, base `b6d049e9e9d59b9aececf13b5e990f9a13647f23`. Implements exact scoped reference snapshots, per-enquiry atomic ready/intent/job capture, current-recipient authenticated acknowledgement/help, private provider adapters, optional staff-context isolation and admin settings/inbox surfaces. All default flags remain off. Additive migrations are tested only in approved isolated synthetic schemas. See staff-handoff/STAFF_HANDOFF_VERIFICATION.md for exact evidence and incomplete browser/live gates. No commit, push, merge, deployment, tenant modification or provider message is part of this task.
