# Astra task 2: authoritative CMS draft recovery

Date: 2026-09-05. Worktree: `.worktrees/audit-20260905`, branch `codex/audit-20260905`, baseline `897f01a`. Changes are local and uncommitted. No database, credentials, provider, staging or production mutations were performed.

## Implemented

- `CmsEditState<TPayload>` now carries the payload, actor draft identity, original publication base, independently resolved current publication version, restore source and nullable draft edit token. Both editors retain this state together.
- Full by-ID reads select the current actor's draft, otherwise the current publication, otherwise the complete live resource. Publication lookup is independent of the 20-row displayed history. The dedicated estate route no longer uses the capped CMS summary as a full-record fallback.
- Other authors' drafts require explicit `reviewDraftRevisionId` and manager/admin permission. Implicit reads and history expose only the current actor's drafts. Category results prioritize the actor's draft; the CMS page lists those draft resources separately from capped live summary tables, so draft-only articles remain discoverable after reload.
- Save preserves the original draft base and returns the saved payload/base state. A detected publication change rejects with `CMS_REVISION_CONFLICT` before the current implementation writes. This check is not a concurrency guarantee; task 3 must make it transactional.
- Both estate editors and the article dialog publish the reviewed saved revision. Unsaved changes require Save first. Publish no longer silently saves the current form again; both base and edit-token fields are sent.
- Restore resolves the current publication independently from the historical payload source and hydrates restored text into the actual form.
- Estate field serialization overlays only changed fields onto the full original payload, preserving aliases containing commas, address/body whitespace, district identity, block counts, area/PSF, coordinates and verification metadata on an unrelated title edit.
- `CmsPublicationCompare` offers read-only comparison with a captured, copyable local-edit snapshot and the current publication. Comparing never replaces local text or rebases the draft. Conflict messaging directs staff there instead of instructing a destructive page reload.
- Async CMS dialog loads use sequence guards; closing or switching editors invalidates in-flight hydration. Forms open only after authoritative payload loading, not from list summaries.

## Verification

- Regression replay against baseline server source using `CMS_RECOVERY_BASELINE=1 node --test src/lib/neon/admin-cms-recovery.test.mjs`: the initial eight-case server suite failed seven cases, with existing denied-role read behavior passing. Baseline read source was loaded with `git show 897f01a:src/lib/neon/admin-cms.server.ts`; the current checkout was not reset.
- Final `npm.cmd run test:cms`: 30/30 pass.
- Final `npm.cmd run test:admin-estates`: 18/18 pass.
- The shared new recovery suite has 12 behavioral cases: separate actor drafts; publication beyond history cap; explicit manager review and agent denial; full legacy estate loading; stale-save no-write; old-body restore with current base; denied viewer/unauthenticated reads; full estate field preservation; reviewed publish without re-save; unsaved publish rejection; and save/close/reopen recovery.
- `npm.cmd run typecheck`: passed after CMS implementation and formatting. The final follow-up only added already-supported publication metadata and test fixture cases.
- Focused ESLint over all seven changed/new CMS TypeScript/TSX files: passed with exit 0.
- Prettier applied to owned CMS files. Existing public-isolation and schema-compatibility CMS contracts pass.
- The test owner registered the recovery suite in both scripts. This agent did not edit package.json, CI, admin-data.server.ts or upload handlers.

## Required task 3 continuation and external acceptance

`draftEditVersion` is intentionally nullable/unpersisted in this slice; it must not be represented as enforced optimistic concurrency. Task 3 must persist/increment it and reject stale save/publish tokens under a shared per-resource transaction lock. The current save read/check/write sequence, publication audit write and archive sequence remain nontransactional. Restore still reuses an existing actor draft row; task 3 must provide the intended immutable/new revision semantics. All these are explicitly unresolved until that slice is implemented and its disposable-database race/rollback tests pass.

No disposable database was configured or used, and no authenticated staging browser session was available. The behavioral suite injects SQL/auth and extracts editor handlers; it does not establish actual database isolation, deployed staff permissions, browser reload behavior, or staging publication correctness. Task 3 and staged browser acceptance must verify those gates before release. Category pagination remains task 7; the additional draft discovery query is not a complete bounded-retrieval implementation.

Independent review is deferred to the combined task 2 + task 3 CMS slice as directed by the coordinating agent. Upload-auth work may subsequently update the separate handleMediaUpload section in admin.cms.tsx; it was left untouched here.
