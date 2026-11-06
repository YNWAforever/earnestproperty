# Live blog inventory reconciliation and release plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Reconcile every existing live and private blog record, then release the reviewed CMS extension without changing existing URLs or losing editorial work.

**Architecture:** Collect immutable read-only observations from the verified live target and deployed source. Reconcile offline using existing snapshot/conversion contracts; rehearse against an isolated copy. Production writes require a separately reviewed target adapter and exact, separately approved actions. The existing owned-container restriction must remain intact.

**Tech Stack:** TanStack Start, Neon/PostgreSQL, existing CMS revision engine, Bun operational tools, Vercel artifact deployment.

**Spec:** `docs/superpowers/specs/2026-11-05-blog-cms-design.md`; preservation and release constraints in `docs/superpowers/evidence/blog-cms/cutover.md` and its final-fix addendum.

## Status and authorization

**Current release preparation:** see [release-request.md](../evidence/blog-cms/release-request.md), the gate register and linked writer/recovery proposals. Production-target offline draft prepared; execution remains unavailable. Provider metadata refreshed read-only: production still has 0 articles / 0 article revisions / 95 migrations; Vercel automatic Git deployments are enabled. Node24 build passed; current runtime acceptance is recorded in the release packet. No production or Git remote mutations are authorized.

**Latest continuation:** isolated migration/import rehearsal is complete for all112 on local PostgreSQL18.6; see [live-rehearsal.md](../evidence/blog-cms/live-rehearsal.md). Captured schema parity,95->98 migration,exact source import,CMS editability/URLs,retries/recovery and refreshed build/HTTP evidence passed. The production-specific adapter,exact production manifest,backup/restore,fencing,hosted acceptance and separate release approvals remain; they are not cleared by local rehearsal.

**Historical collection status (2026-11-05):** user-confirmed production binding and authorized owner READ ONLY access; live database and refreshed public/source inventory collected. Database articles/revisions are 0/0; registry/public article URLs are 112/112, with one policy route excluded. See [live-reconciliation.md](../evidence/blog-cms/live-reconciliation.md). The legacy production schema remains unchanged. Isolated rehearsal has since passed; production executor, exact final manifest approval, fencing/recovery and separate release approvals remain. Preparation-time statements below are retained as history.

Prepared 2026-11-05. This document authorizes nothing beyond the user's current request to fix the label and prepare the plan. No live inventory has been collected in this follow-up. Production remains unchanged. Push, merge, deployment and production database changes each need separate explicit approval naming the exact target/revision/action. Preparing a collector or adapter is not permission to run its production write mode.

Continuation authorization, 2026-11-05: the user subsequently requested read-only binding/access verification and live inventory collection. See `../evidence/blog-cms/live-access-check.md` for current access results. The original paragraph above records preparation-time status; it is not the current read-only authorization boundary. No production changes or release actions are authorized. Database content collection still requires a resolved target binding and access path; a confirmed owner connection in an enforced read-only transaction must be distinguished from a dedicated read-only login.

Historical reference inventory: 112 code-defined articles, 113 sitemap blog URLs including the dedicated editorial-standards route, seven categories and eight settings scopes. These are earlier observations, not current live counts. Real database article/revision/draft counts and exact backend identity remain UNKNOWN. Current code has no production import adapter and no proven hosted all-writer pause.

## Global constraints

- Preserve every existing article URL and exact category query key; do not fabricate missing content or dates.
- Existing database content and publication state are authoritative; private drafts remain private and editable.
- Main and category settings/features remain independent; featured articles must be published and due.
- A failed read is not an empty source. Unknown/incomplete inventory or conflict blocks activation.
- No automatic republishing, silent fingerprint reapproval, fallback resurrection or overwriting newer edits.
- Raw draft content, snapshots, backups and credentials stay out of Git and reports. Use ignored `.private-sync-evidence/blog-import/` with restricted local access; publish sanitized counts/hashes only.
- Preserve the current uncommitted worktree and historical evidence. Git actions remain separate from this plan.

## Review focus

1. Pre-migration live schema lacks new blog tables: represent absent schema explicitly; do not pretend this is an empty reconciled inventory (Task 2).
2. Draft-only identities, orphan histories and duplicate slug claims: inventory all authors/states, not just admin-visible rows (Tasks 2–3).
3. Content or public URLs change after review: recapture and reject drift rather than silently updating approval (Tasks 3 and 6).
4. Old instances, jobs or privileged SQL bypass staff suspension: prove an all-writer fence and drain (Task 5).
5. Edits occur after import: receipt replay and repair preserve newer content/private states (Tasks 4 and 6).

## Deliverables and ownership

| Deliverable | Proposed path | Accountable role |
| --- | --- | --- |
| Verified target/deployed-source receipt | `docs/superpowers/evidence/blog-cms/live-target.md` | Platform + database owners |
| Read-only capture tool and tests | `scripts/blog-cms/live-inventory.ts`, `live-inventory.test.ts` | Application + database owners |
| Sanitized reconciliation/dispositions | `docs/superpowers/evidence/blog-cms/live-reconciliation.md` | Editorial owner |
| Isolated rehearsal and adapter review | `docs/superpowers/evidence/blog-cms/live-rehearsal.md` | Application + database owners |
| All-writer pause/reopen matrix | `docs/superpowers/evidence/blog-cms/live-write-pause.md` | Database + platform owners |
| Exact release request and receipts | `docs/superpowers/evidence/blog-cms/release-request.md` | Release owner |

Roles are not yet assigned to people. Target-specific commands are deliberately not invented. The paths above are planned artifacts, not evidence that the work has run.

## Task 1: Establish target and artifact identity (read-only)

- [ ] Resolve the current public domain to its actual deployment/project/environment and deployed source revision using authorized read-only metadata.
- [ ] Independently verify database project/branch/database identity and the application's binding to it. Domain/source SHA alone does not prove the database target. Record non-secret identifiers; never print connection strings.
- [ ] Record the local candidate's full source/build receipt separately from deployed-source identity. Use the post-label-fix binding, not an older Task8/9 receipt.
- [ ] Name the editorial, database, platform and release owners. Establish an existing least-privilege read-only access path; if unavailable, stop collection at that boundary rather than requesting or searching for secrets in chat.
- [ ] Deliver a target receipt with observation time, source revision, environment identity and explicit unresolved fields. Any mismatch blocks Task 2 live execution.

## Task 2: Capture complete live inventory without mutations

**Interface:** Produce a versioned raw live snapshot plus a schema-capability report, then explicitly normalize supported data into the existing `DatabaseSnapshot`/`SourceBundle` contracts in `src/lib/blog/import-snapshots.ts`. Do not weaken `VerifiedImportTarget` or route a live URL into owned-only `blog-import.ts`.

- [ ] Implement/test the separate read-only collector against owned fixtures before live use. Require an explicit verified target, read-only credential/session, bounded statement timeout and `REPEATABLE READ READ ONLY` transaction; no DDL, migration, temporary repair or default application connection loading.
- [ ] Inspect live schema/migration versions first. If new blog tables/columns are absent, retain that fact and the legacy data. Build a proposed normalization/migration on an isolated copy; completeness stays unresolved until reviewed. Do not apply schema just to make collection work.
- [ ] Capture every article, every article revision across all authors/states, draft-only identities, category mappings, settings, ordered features, relevant receipts and migration ledger. Validate deterministic pagination, row counts, unique identities and snapshot consistency. Avoid collecting unrelated personal/account data.
- [ ] Capture the full unfiltered registry from the exact deployed source, current sitemap/public article links, main/category copy and SEO/canonical observations. Record timestamps/statuses/source association and explicit policy-route exclusion. Resolve public-only bodies/media/links from actual sources; unavailable content stays unresolved.
- [ ] Test failed pages, missing tables, count mismatch, all-author drafts, null/future dates and interrupted capture. No incomplete result may be labeled complete; verify the collector performs zero writes.
- [ ] Save immutable raw snapshots privately and a sanitized receipt containing target/source identity, counts, schema gaps, hashes and observation time. This is an inventory, not a full recoverable backup.

## Task 3: Reconcile and approve exact dispositions offline

**Consumes:** verified target receipt, complete raw snapshot, deployed-source/public observations. **Produces:** immutable manifest and editorial disposition register using `buildImportPlan`, with any unsupported legacy normalization reviewed separately.

- [ ] Match by exact slug/URL and stable identity; account for every database row/revision and every public/source URL. Report drafts and absent-source counts as actual numbers or UNKNOWN, never inferred zero.
- [ ] Classify: retain authoritative database content; insert missing approved source-only record; initialize missing category reference/copy under version checks; exclude policy route; or block on conflict/unresolved data.
- [ ] For database-vs-registry differences, private/public collisions, missing revision history, unsupported bodies, reserved category keys and duplicate claims, obtain an explicit editorial disposition. Do not invent revision history or republish to satisfy public counts. Record approver, source fingerprints, reason and permitted outcome.
- [ ] Preserve all rich/legacy body semantics, media, links, bylines, comparison references, SEO, dates and fixed URLs. Category renaming changes display name only.
- [ ] Require complete source/count coverage, zero unresolved records and reviewed conflict dispositions. Freeze the manifest fingerprint with target/source/observation identities. A changed input requires a new manifest review.

## Task 4: Rehearse migration/import and prepare the production adapter locally

- [ ] Reproduce the observed pre-migration schema and sanitized representative data in an isolated owned target. Review/apply the exact three proposed blog migrations there, checking all historical revisions and drafts remain intact.
- [ ] Implement a separately reviewed production adapter only after target capabilities are known. Require explicit target identity, least privilege, immutable approved manifest, verified backup, all-writer fence evidence, locked freshness checks and durable receipts. Keep local owned-target checks unchanged. No production execution during adapter development.
- [ ] Rehearse exact registry/database/public reconciliation, import, matching revision initialization, all-record CMS editability and every expected URL/publication state. Include future/null dates and original draft-only records.
- [ ] Test dry run, transaction rollback, lost response, identical retry, stale manifest, unauthorized target and intervening edits. Reimport must not overwrite newer work; zero duplicates and immutable receipts required.
- [ ] Rehearse targeted CAS recovery after new edits and withdrawal; require preservation of unrelated rows/private drafts. Establish real database/PITR and media backup scope and restoration evidence separately from the existing blog snapshot.
- [ ] Refresh the candidate's bound build and HTTP acceptance after relevant changes. Verify hosted auth/upload/CDN in an approved isolated environment only; any deployment still needs separate approval and must not share unverified production data.

## Task 5: Prove the release pause and activation mechanism

- [ ] Inventory all writers: CMS/server functions, old deployments, agents/managers, background integrations, scheduled jobs, importers, direct SQL and role/account reactivation paths.
- [ ] Select target-specific fencing controls with the platform/database owners, record exact commands, privileges, pre-state and reopening procedure. Staff `active=false` alone is insufficient; the local rehearsal demonstrated privileged SQL bypass.
- [ ] Prove each writer is blocked and in-flight work drained. The fence must persist through final capture, import, artifact activation and verification. Test bounded failure/recovery without accidentally reopening writes.
- [ ] Document how old cached pages/old deployments are removed or invalidated. New no-store headers do not purge previously cached old content. Verify actual CDN/runtime behavior and retain safe unavailable handling.
- [ ] If any writer, recovery control or target-specific command is unknown, keep release BLOCKED. Do not run an assumed maintenance switch.

## Task 6: Assemble separate approval requests, then execute only approved actions

Prepare a reviewable packet first: candidate revision/full-source/build hashes; exact target and deployed baseline; schema versions; complete immutable manifest/dispositions; backup location/digest/restoration proof; writer fence/drain/reopen procedure; adapter revision; deployment/cache commands; expected per-URL outcomes; acceptance and stop/recovery criteria.

Request approvals separately and only when concrete:

1. **Push/PR:** exact local changes/commit and remote branch. No merge or deployment implied.
2. **Merge:** exact reviewed PR/head/base and CI evidence. Verify whether merge triggers automatic deployment; approval must explicitly cover or prevent that consequence.
3. **Production database changes:** exact target, migrations/import manifest/backup and bounded write operations; separately describe any pause/access-state changes.
4. **Deployment/traffic activation:** exact artifact/project/environment/domains and cache operations. No new data writes implied beyond separately approved scope.

After approval, maintain the proven fence, capture fresh inventory and compare it with the approved manifest. Any changed target/source/version/fingerprint stops the operation for renewed review. Back up and verify; apply only approved schema/import; verify committed receipt and every expected URL/CMS record; activate only the approved artifact and invalidate old caches; run role/privacy/edit/unpublish/retry checks; reopen only the recorded approved access states after all gates pass. Failed checks keep activation/reopening stopped and use reviewed forward repair. Never revert to a renderer that resurrects registry articles or bulk-restore over newer edits.

## Completion and evidence

- Local label fix: evidence in the follow-up report linked from handoff.md.
- Plan preparation: complete when this document and current handoff are consistent.
- Live inventory/reconciliation: completed against the USER_CONFIRMED target in enforced READ ONLY sessions; exact-source isolated rehearsal also completed. A final under-fence production inventory and release-ready manifest are still NOT_RUN.
- Production release: BLOCKED until Tasks 4–6 and separate approvals are satisfied.
- Store per-layer PASS/FAIL/BLOCKED/NOT_RUN, observed exits, target/revision/artifact/manifest bindings and sanitized receipts; retain private raw evidence separately.

Self-review: coverage includes all-author drafts, legacy schema gaps, URL/content preservation, drift, all-writer pause, recovery and independent approval boundaries. Tasks 1–3 enable read-only readiness; Tasks 4–5 create a concrete release packet; Task 6 cannot execute from this planning request alone.
