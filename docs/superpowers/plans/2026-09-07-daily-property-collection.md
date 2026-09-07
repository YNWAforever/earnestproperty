# Daily Property Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Daily complete 28hse collection and safe differential import with low operating cost.
**Architecture:** Python collects immutable evidence; shared Node ingestion applies under existing Neon transaction and ownership locks. GitHub Actions schedules one Linux execution, with explicit activation gate and recoverable artifacts.
**Tech Stack:** Python/BeautifulSoup, Node raw SQL, Neon, GitHub Actions.

## Global constraints

Follow approved docs/superpowers/specs/2026-09-07-daily-property-collection-design.md. Preserve unrelated worktree edits. No production migration, unapproved policy edits, real messages or inventory deletion. No browser/AI collection. No raw contact data in job summaries. Never substitute advertised counts for terminal evidence. Keep parser/source/receipt boundaries compatible and test explicitly.

### Task 1: Worker lifecycle and immutable replay
Files: scripts/property-sync/scraping/worker.py; tests/test_worker.py; add scripts/property-sync/replay_28hse_sync.py and tests/fixtures sanitized terminal/negotiable excerpts where needed; scripts/mls/apply-source-snapshot.mjs/test.
Interface: wire source_status active|delisted (default active), source_status_reason sold|rented|null; price/rent null for negotiable. parser python-v2.1. Expose deterministic replay_28hse(payload_path, root, apply=False) with bounded retries of unchanged file bytes. Keep default dry-run.
- [ ] Red tests: sold/rented amount badges, negotiable null, unsupported/contradictory labels; replay transient vs permanent errors, exact bytes, no recollection and baseline receipt semantics.
- [ ] Implement guarded live parsing and replay. CLI bridge error JSON must include safe status/retryAfter without secrets. Preserve exact payload/hash and server errors.
- [ ] Run `scripts/property-sync/.venv/Scripts/python.exe -X utf8 -m pytest scripts/property-sync/tests -q` and bridge Node tests, then commit explicit owned paths.

### Task 2: Atomic lifecycle and difference evidence
Files: src/lib/mls/ingestion-contract.mjs/.d.mts/tests; ingestion-repository.mjs/.d.mts/db tests; ingestion-service tests where required.
Interface consumes Task1 source_status/reason. Missing status remains backward-compatible active. Include lifecycle in duplicate fingerprint, persist accepted source lifecycle and immutable provenance. Do not create an active/public offer for terminal/negotiable data. Canonical terminal -> inactive only through existing owned-field guards. Persist distinct explicit-terminal vs accepted-absence reasons; no secondary revival.
- [ ] Red pure tests for valid/invalid lifecycle and differing duplicate statuses.
- [ ] Red isolated DB tests for explicit sold/rented, negotiable preservation, manual overrides, identical next-day batch no canonical UPDATE/updated_at/change event, and changed-only projection.
- [ ] Implement lifecycle projection and count summary properties_created/properties_changed/fields_changed/unchanged_properties; retain atomic receipt/state and observed timestamps.
- [ ] Run named offline suite and affected real DB tests using approved .env.astra-disposable unique-schema pattern, then commit explicit paths.

### Task 3: Daily workflow and operator recovery
Files: .github/workflows/property-sync-daily.yml; scripts/property-sync daily helper if required; workflow contract test; docs/deployment/property-sync-daily.md. Root owns package.json and src/test-wiring.test.mjs integration.
Interface invokes existing run_28hse_sync.py and new replay_28hse_sync.py; source config publishEnabled true only after explicit apply gate. Managed DATABASE_URL_UNPOOLED secret passed only to apply phase. schedule 17 18 * * *; dedicated concurrency with cancel-in-progress=false. Source collection must not rerun full app CI/build daily.
- [ ] Red workflow tests for disabled gate, scope, concurrency, pinned expected branch, deterministic replay, compressed evidence and no unrelated schedules/migrations/messages.
- [ ] Implement Linux Python3.14/Node22 dependency install, restricted artifacts, summary and full-receipt validation; archive/replay remain available on failed runs. Default activation off.
- [ ] Test helper with temporary local artifact/receipt fixtures; document exact enable/config/policy/handoff/replay/rollback steps and measured-cost limitations; commit explicit paths.

### Task 4: Integration, evidence and release readiness
Root owns named test wiring, config/docs compatibility, all-task/final review and release report.
- [ ] Reprocess the already captured authorized 247-detail payload locally with final parser; preserve original snapshot and collection timestamps as evidence (no extra bulk crawl).
- [ ] Verify all 247 distinct records accounted, two explicit sold statuses and one negotiable price; validate shared codec without database application.
- [ ] Run named Node/Python tests, focused DB proofs, workflow guard, typecheck and build only as justified by changes. Review full diff then fix important findings.
- [ ] Inspect production gate metadata read-only. Finish available implementation without inventing credentials or activation. Record exact blockers if activation unavailable; preserve current PR/worktree and unrelated edits.
