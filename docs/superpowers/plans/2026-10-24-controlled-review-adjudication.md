# Controlled Review Adjudication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Work locally in the existing isolated worktree; no commit, remote, database connection or provider call is authorized.

**Goal:** Allow an explicitly approved controlled patch to record exact historical reject-reassignment and DOM conflict decisions without erasing evidence or changing formal review status.

**Architecture:** A server-only operator review plan is bound by canonical SHA-256 to the payload and an explicit CLI hash. Validate before client creation. Under existing native table locks, compare each historical review row hash and its held source binding. Exclude only those historical proposals for the named target, never direct/peer reviews, conflicts, held relationships, manual ownership or publication gates. Persist the plan with the new native observation; do not UPDATE reviews or relink historical sources.

**Tech Stack:** Existing Node ESM native ingestion, node:test, mock SQL only; no schema or dependency changes.

**Spec:** Latest user approval plus the private `a035060-identity-review-20261024T0036Z/REPORT.md`. The production preview is still blocked on fresh full atomic before-images and mutation authorization.

## Global Constraints
- Preserve raw DOM/JSON-LD conflict markers and capture timestamps.
- A review plan is server-only, explicit and hash-bound, not authority supplied by scraped JSON.
- Only existing draft targets; no new canonical or publication through this mechanism.
- Historical outcome is reject_reassignment, not accept identity / merge / resolve review.
- 4027644 remains blocked; 4058953 is not bound; all other specified holds remain.
- full_snapshot=false, absence=false. No production SQL, provider fetch, push or deploy.

## Review Focus
- Tampered/reused plan, wrong target, changed evidence/hash or duplicate entries must fail before writes.
- Only the exact bedrooms DOM conflict is acknowledged; other fields/occurrences still block.
- Direct/peer reviews and unrelated historical reviews remain pending.
- Review-row/source-binding drift is checked inside native locks; no blanket exceptions.
- Receipt replay binds plan hash; unknown outcomes are reconciled, not blindly retried.

## Tasks
- [x] Add failing synthetic tests for validation, conflict acknowledgement, exact historical adjudication and unchanged raw evidence.
- [x] Add `controlled-review-plan.mjs`; integrate service, native guard and writer with server-only plan options and observation audit metadata.
- [x] Add explicit CLI sidecar/hash switches, deny request-body self-approval, and test dry-run without DB or credentials.
- [x] Run focused RED/GREEN and existing native regressions/typecheck/lint offline; update the named private preview/rollback, manifest and limitations. No live execution.

## Decisions
- Formal review rows stay open. This plan is a one-payload audited disposition of a rejected historical proposal for a different already-bound draft; it does not certify that historical source's current identity.
- A historical review row hash not collected in the last read-only snapshot remains UNKNOWN in the real preview. Never invent it or contact/promotion/queue before-images.
- Native mode retained from the user's existing workflow; implement locally, then use a fresh read-only review.
- Independent review caught missing target-link recreation. Added a RED regression, then required an existing active exact source/offer/canonical link. No remaining actionable P1/P2 after follow-up; PostgreSQL/trigger behavior is not live-verified.
