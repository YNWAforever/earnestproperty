# Admin property bulk management implementation plan

> For agentic workers: use superpowers:subagent-driven-development for independent bulk execution logic and inline integration for the closely coupled query/UI changes.

Goal: implement the approved one-property-per-row admin management design.
Architecture: extend existing raw-SQL grouped reads with whitelisted server ordering; apply small batches through the existing versioned per-property transaction. No migrations or production writes.
Tech stack: TanStack Start, React, Zod, Neon, Node/Bun tests.

## Global constraints
- A property stays one row; sale and rent remain independently managed.
- Missing offers are never created by bulk updates.
- Respect server staff authorization, version checks, ownership and source/audit safeguards.
- Maximum selection is current page, up to 100; client sends at most 5 at a time.
- Partial success is reported per property. Do not retry successful or uncertain outcomes automatically.
- SQL sorting occurs before pagination, NULLS LAST, stable group-number tie break.
- Preserve unrelated working changes; do not deploy or mutate production data.

## Tasks
- [x] Sorting: extend admin-properties.types.ts filters with sort and direction; summary updatedAt. Add read-query tests for whitelisted expressions and fixture checks across two pages, missing prices, tie break. Implement ordered matched CTE and map metadata. Run test:admin-properties and approved disposable DB suite.
- [x] Bulk: new admin-property-bulk.types.ts with strict bounded unique items, scope/status/agent action; new dependency-injected runner plus server wrapper. Preflight version, visible existing offer, editability and required positive price/title for publication. Use existing saveAdminPropertyManagement so each property commits with audit/version locks. Tests cover invalid payloads, missing offers, authorization, stale versions and partial results.
- [x] UI: new AdminPropertyBulkActions.tsx for selected-page rows, scope/action controls, before/after confirmation and per-item results. Small chunks of 5; network uncertainty stops further chunks and requires reload. Retain failed rows and clear successes. Convert list to responsive table, preserve mobile cards, add sorting and page size URL controls. Clear selection when filters/sort/page change; disable navigation while writing and guard leaving.
- [x] Verification: focused tests, lint, typecheck/build, no real admin mutations. Run independent review. Record precise test results and environment blockers. Commit only task files.
