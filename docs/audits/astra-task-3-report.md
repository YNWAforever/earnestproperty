# Astra task 3: atomic CMS revision mutations

Date: 2026-09-05. Worktree `.worktrees/audit-20260905`, branch `codex/audit-20260905`. Local changes only; no migration, disposable database, staging, provider or production operation was run.

## Implemented

- `cms_mutate` is a single VOLATILE PL/pgSQL invocation. Every save/publish/restore/archive takes the same transaction-scoped `cms:<type>:<uuid>` advisory lock, including draft-only resources. Publication and version-allocation SELECTs execute after that lock; PostgreSQL Read Committed supplies fresh snapshots after waits. This does not use an interactive JavaScript callback with the Neon HTTP driver.
- Existing `(resource_type, resource_id, version_number)` uniqueness is retained. The migration adds a partial unique current-publication index, a positive persisted `draft_edit_version`, and an immutable historical revision trigger. Published/superseded/archived payloads and metadata cannot be overwritten; publication may transition to superseded without rewriting its snapshot.
- Saves require both the exact draft revision identity and its edit token when an actor draft exists, check still-draft state and original/current base, increment the token and check affected row count. An older save cannot overwrite either a published revision or a newer restore draft that happens to have the same numeric edit token. Both editors send the identity/token pair and return database-persisted edit state.
- Restore re-reads the selected historical revision inside the lock, inserts a fresh draft, preserves the historical source ID, and captures the current publication version as its base. Prior actor drafts are now retired as private immutable database snapshots; active editor/history selection excludes them, and the restored draft is the default edit selection.
- Publish and archive commit revision state, live visibility/projection and audit together. Database errors propagate; there is no out-of-transaction success audit. All operations recheck active staff and allowed roles inside SQL as well as using the real server `requireStaffAccess` boundary.
- Legacy estate reconciliation is a separate opt-in function. It has a read-only-by-default dry run, uses the same resource lock, skips any resource already having revisions, preserves the live `published` flag, and audits applied backfills. The migration only installs this function; it does not run it.

## Verification

Initial regression run: 2/2 failing (restore wrongly used historical version as current base; atomic migration absent). After implementation:

- Existing `npm.cmd run test:cms`: 30/30 passed before registering the new 8-case suite.
- `node --test src/lib/neon/admin-cms-atomic.test.mjs`: 8/8 passed. This executes transpiled production server functions with injected SQL/auth, testing every operation across admin/manager/agent/viewer/unauthenticated roles, persisted token/identity forwarding, restore identity-only lookup, single atomic command dispatch, and propagated database failures. SQL source contracts additionally pin lock-before-read, row-count checks, unique publication and immutability. These tests do not emulate or establish actual PostgreSQL isolation.
- Focused ESLint over server/types/revision helper and both changed editor files: passed.
- Typecheck during concurrent root work reported only `admin-data.server.ts:3463` / `WebsiteInquiryPersistenceInput.submissionId`; no CMS errors. Coordinating agent owns final combined typecheck.
- `scripts/test-cms-db.mjs` syntax check passed. Without explicitly configured approval it refuses to run, printing the missing gate. It was not run against a database.
- Existing estate projection source contract now reads the migration where the actual projector lives, retaining all field-preservation assertions. Recovery fixtures now stub the new SQL command boundary while retaining their behavioral assertions; the old restore unit test now explicitly supplies a different current publication version.

## Disposable database suite and CI exclusion

`test:cms:db` must run `node scripts/test-cms-db.mjs` separately from default CI and `test:cms`. The coordinating agent owns package/CI registration. Default CI covers the 8 deterministic cases plus current CMS/recovery/public-isolation contracts. PostgreSQL race/rollback acceptance is an explicit external gate, not a skipped test represented as passing.

Required environment: `CMS_TEST_DATABASE_URL` for an approved disposable Neon database and `CMS_TEST_DATABASE_APPROVED=disposable`. There is no fallback to application credentials; matching `DATABASE_URL`/`DATABASE_URL_UNPOOLED` is rejected. The suite creates a random isolated fixture schema, applies this migration there using real Neon transaction batches, tests actual SQL, and drops only that exact schema in `finally`. It does not mutate public application tables. The fixture intentionally supplies only the schema needed by CMS; deployed schema/auth-browser acceptance remains separate.

The suite covers active role matrices including revoked staff and null actors; concurrent first-version allocation; first publication; two same-base publishers with one winner; stale same-draft saves; save versus publish; v1 restore against current v3; stale pre-restore identity; immutable historical payloads; archive versus publish; injected revision/live/audit failures including each distinct publication transition; and dry-run/apply/repeat legacy reconciliation preserving visibility.

## Legacy reconciliation dry-run/report procedure (not executed)

On an approved disposable branch first, record counts from:

```sql
SELECT e.published, count(*)
FROM estates e
WHERE NOT EXISTS (
 SELECT 1 FROM cms_content_revisions r
 WHERE r.resource_type = 'estate' AND r.resource_id = e.id
)
GROUP BY e.published;

SELECT resource_type, resource_id, count(*)
FROM cms_content_revisions WHERE state = 'published'
GROUP BY resource_type, resource_id HAVING count(*) > 1;
```

After applying the migration on that disposable branch, use `SELECT * FROM cms_reconcile_legacy_estates(<authorized_admin_uuid>, false)` to collect candidate IDs and proposed states. Apply with `true` only after approval, then repeat and expect zero rows. Compare estate visibility before/after and inspect `cms_legacy_reconciled` audit rows. Production counts and reconciliation status remain unknown; no report invents them. A duplicate-publication preflight result blocks migration for explicit reconciliation rather than silently discarding history. Reconcile legacy resources before enabling new revision edits so their original live snapshots are preserved.

## Remaining external gates and scope boundaries

Migration `20260905110000_cms_atomic_mutations.sql` must be reviewed/applied with application release, disposable tests must pass, legacy reconciliation must be approved, and authenticated staging editor/race acceptance must be recorded. This work does not authorize production migration. Video/FAQ/media direct-write lifecycle policy remains task 3B; these legacy paths do not acquire the CMS revision lock. Upload authorization/recovery is a separate owned slice. No claim is made that unmigrated databases already enforce the new token or that provider/staging flows passed.


## Independent review follow-up

Confirmed and fixed the review findings in one follow-up wave:

- Restore retires older drafts of its actor. Publish also retires obsolete drafts of the published revision author, covering older duplicate-draft states. Archive retires all drafts under the resource lock, including resources with no prior publication. Old save/publish tokens cannot revive archived drafts or return obsolete draft text after restored publication.
- Retirement uses nullable `draft_retired_at` while preserving `state='draft'`. This retains the private draft boundary instead of exposing formerly private payloads through shared superseded-history reads. Retired snapshots become immutable and are excluded from active hub, editor and displayed history queries.
- Estate projection explicitly preserves null aliases/facilities arrays. PostgreSQL JSON null is handled before array extraction, so a title-only edit of a nullable legacy estate does not fail or silently turn null arrays into empty arrays.
- Both CMS loaders check their request sequence after successful responses as well as failed responses. Delayed responses after a dialog switch or close cannot rehydrate older content.
- Both CMS save handlers preserve text typed while saving through functional state updates. The reviewed edit state remains the payload actually saved, so subsequent publishing detects the newer unsaved text and remains blocked. Save hydration also checks the dialog sequence before applying a result.

Red evidence: the new recovery cases initially failed 7/19 (retired draft fallback, four delayed success switch/close cases, two delayed-save overwrite cases); the retirement and nullable-array SQL contracts also failed before fixes. After fixes, combined recovery + atomic tests pass 29/29 (19 behavioral recovery/editor cases, 10 atomic/server/SQL contracts). Disposable suite additions cover restore-publish retirement, archive of multiple draft-only authors, first-publication/archive races, immutable retired payloads, rollback at restore/publication retirement writes, and a nullable legacy estate title-only roundtrip preserving every other projected field. The database additions remain unexecuted behind the same explicit disposable gate.

Final follow-up verification: registered `npm.cmd run test:cms` passed 47/47; `npm.cmd run test:admin-estates` passed 25/25; focused ESLint for `admin-cms.server.ts` and `admin.cms.tsx` passed before the final typecheck began. `git diff --check` for the changed tracked CMS source files passed. No migration/database/provider execution occurred.
Final combined `npm.cmd run typecheck`: passed with exit 0 after the review fixes and concurrent coordinating-agent work.
