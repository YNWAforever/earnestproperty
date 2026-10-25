# Owner capture publication implementation plan

> For agentic workers: execute each task with its own verification; checks run sequentially.

**Goal:** Publish the frozen saved capture onto the correct existing ref+deal rows with owned media, without following reused ad IDs, and prepare a separate audited review cleanup.

**Architecture:** A sibling owner-publication CLI reuses frozen-input/production guards, the saved-capture mapping/photo validation and existing media pipeline. A read-only planner matches agency ref+deal against properties/public groups; apply uploads before an atomic per-listing transaction, rechecks candidate/review/override fingerprints under ingestion locks, publishes to the agency public group and writes the daily publisher's audit/provenance structures. Owner observations use a stable ref+deal namespace, preserving all historical raw-ad-ID source state and links. Queue cleanup is separate and remains unexecuted.

**Spec:** Latest user request and /workspace/28hse_capture/{existing_drafts_report.md,existing_drafts_map.csv,review_queue_summary.json}.

**Constraints:** No production access, real Blob writes, Vercel CLI, env pull, push or deploy. Frozen JSON confirmation and dedicated IMPORT credentials remain mandatory for production. Sold 4028435 and stale ad-ID targets remain unchanged. All validated captured photos; unmatched estate NULL; two approved unresolved districts empty string, never fabricated. No admin overrides. Per-listing reviews must be demonstrably about the ref+deal selected, never broad ad-ID/group resolution. Ambiguous rows require explicit UUID choice.

- [x] Add pure target/ref+deal planner, per-listing before/after report, choice validation and completed-publication idempotence.
- [x] Implement owner publication with existing identity/media helpers, local bytes-only photo transport, before/after snapshots, field ownership, change events and audit logs. Hold manual overrides and non-owned conflicts. Preserve stale journal rows; use isolated owner provenance.
- [x] Add guarded dry-run/apply CLI with pg/Neon WS and report persistence, default READ ONLY rollback; offline saved-map preview for this local task.
- [x] Prepare separate review cleanup planner/CLI, keep-value ownership plus exact redundant duplicates only; preserve real decisions.
- [x] Disposable Postgres tests: 22 draft +8 inactive reuse,23 creates,2 holds,sold skip, all photos >6, blank districts, missing estates, reused IDs, choice validation, retry, concurrent edits and atomic rollback, audit/review scope and cleanup ownership.
- [x] Run lint, typecheck, env registry, format, importer/property-sync/owner tests ONE AT A TIME; update report/runbook and prepare local commit.
- [ ] Complete build verification: initial npm run build terminated (143); retry approval rejected. Do not retry without new authorization.
