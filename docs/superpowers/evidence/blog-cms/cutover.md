# Blog CMS — gated cutover and recovery package

2026-11-05. **PACKAGE ONLY. Live cutover BLOCKED.** Tasks1–8 reviewed complete per the controller. Task9 independent review follows; final whole-change review is separate. No production target, complete live inventory, production adapter, hosted pause, release authorization or hosted acceptance is established. No commits, subagents, push, merge, deploy, provider calls or external DB actions are part of this task.

Worktree: `C:/Users/laich/.codex/worktrees/earnest-blog-cms/Earnestproperty`.
Base HEAD: `8b49d0a21c867c401c4d41db393e43c8db76a74d`; this is an **uncommitted** Tasks1–9 candidate, not a deployable Git revision by itself.

## Evidence and identity contract

- [Task8 acceptance](acceptance.md), especially **Review fix round 1/5**, preserves the prior reviewed source/build/run receipt. That receipt was verified before Task9 edits. Task9 code/test changes invalidate its applicability to the new candidate; the refreshed binding below is required.
- Task reports, candidate maps, original dirty status and logs are under `.superpowers/sdd/2026-11-05-blog-cms-implementation/`. `task-9-source-before.json` and `task-9-original-status.txt` preserve entry state. `task-9-candidate.json` / `task-9-delta.json` identify final source and this task's delta, including untracked files. No whole plan was read.
- Source identity v2 includes tests, operations scripts, configs and public assets. Build receipt hashes bind that source to the full output and successful clean-environment build. The HTTP runner verifies it **before initialization and after assertions**. Any relevant code/test/config/asset change requires a new build and HTTP run; documentation/evidence exclusions prevent circular hashing.
- An import `sourceRevision` / `sourceDigest` identifies the registry/public/presentation data bundle, **not the application artifact**. Approval must independently bind both. Import manifest identity includes the database system identity and complete protected snapshot, every draft/history row, settings/features, source URLs and source completeness.
- Existing controller snapshots account for 112 registry article URLs plus the explicitly excluded `/blog/editorial-standards` policy URL. They do not establish live DB completeness or fresh hosted URL discovery. The 101-article rehearsal is synthetic. Neither count is a production database count.

### Final local binding

**PASS for the scoped local rehearsal, exit 0.** `test-logs/task-9-http-first.log` contains identical starting/ending bindings. Full build: `task-9-build.log`. No relevant source change followed the build. Prior receipts and failed attempts remain retained.

| SHA-256 identity | Exact value |
| --- | --- |
| Source v2 (2,010 files) | `930a21e4d1244815f24308206d18d12afa5274c0e0a19aefa1125c07b38ee8dc` |
| Full `.output` (926 files) | `6a171ca719a8c6281abd2e5a0cb17bd2e7aab157f8b0011fc81ef299d49453ed` |
| Successful build receipt bytes | `5312b9c3047d60af12bcd71e2fc4a8b370e0555cd0c91d8b0cbb511be5191f3d` |
| Tracked HEAD diff (supplementary only) | `0fa51def67aff8d67d0e42800170f655b91785884c563e5e5b44421029f3f6eb` |

Build: `2026-11-05T03:13:40.005Z`, Node `v26.13.0`, command `npm run build`, exit 0, OS-only environment/no dotenv. Preserved receipt: `task-9-build-receipt.json`. Dependency bytes are not independently attested; this is local reproducibility evidence, not signed supply-chain attestation.

Historical owned rehearsal target (removed after success; **not reusable**):
`owned:94fe1d25645c9df9e3d2a7d82115345d25af2b9c2671e27fc941bad46b63baae:postgres`, system `7704520816256835623`.
Manifest `d207265632f0dc1a548b9f94c62557a24b548b9bec113b500526788107e0797a`;
fixture-data digest `eba883b5690589a31991277086b4b39469541d97e94d4d66ae2af97151d8c03b`;
backup bytes `0ae0b9f6713f570c2abdbdf4d880f5d49606868347dc8279132c7c56bcb73c89`;
committed protected snapshot `f2d9b2e173d0ef959ec0ef3e4bb472600091195d83a5989835457a4b9143644d`.
Actual import counts: 101 articles, zero category/settings/normalization changes. Both the manifest and post-import receipt gates passed before reopen. All101 record/revision pairs and paths were verified before reopen, followed by all101 CMS edit/reload and URL checks. Recovery's stale request returned 409 without writes; the forward repair and subsequent browser/error checks passed. Sanitized phase receipts are in the HTTP log; raw fixture manifest/backup/import/recovery receipts remain in the ignored directory named in that log.

Separate full-registry read-only verifier target: `owned:ecb654963f3014cbe6b3f3ab446dacfa027d4fbf08c0b87d0c16ab3abfce4a0e:postgres`, system `7704519171325808680`, manifest `79bde7f53892477805c76db3c92ad0b54579a9a4b163496b929ea6f58149a5a9`. This test accounted for 112 source records/113 URLs against a fresh fixture DB, performed no import, rejected every tested drift with exit1, and removed its owned container. It is not the 101-article HTTP target or a real live database inventory.

## Actual pause availability — BLOCKED for hosted all-writer coverage

Read-only source/config inspection found **no blog-wide maintenance/write-pause setting**. No provider configuration was queried for this package. The inspected repository alone cannot establish account-level write access or deployment routing controls.

Inspected local deployment inputs: `vercel.ts` has build/headers/redirects/cron configuration and branch-specific deployment exclusions, not a CMS pause; `wrangler.jsonc` names the server entry/compatibility settings, not a writer gate; `.vercelignore` excludes evidence/env files; `.vercel/project.json` is absent. None identifies a verified live database or all-writer fence. Existing unrelated job configuration was left unchanged.

| Writer / control | Actual source and limit | Owner/action needed before live work |
| --- | --- | --- |
| Signed-in blog editor; admin/manager publication; agent drafts | `auth.server.ts` checks active staff each request; `blog-repository.server.ts` and SQL `blog_require_actor` recheck it. Deactivating staff blocks these sessions but also affects unrelated staff features. | Editorial/access owner **unassigned**: enumerate users, preserve initial states, agree operational scope and prove all current sessions fail writes. No live deactivation authorized. |
| Legacy article editor, restore/archive, copilot persistence | `admin-cms.server.ts` calls `cms_mutate`; the Task4 SQL checks active staff and takes `blog_lock`. Local SQL denial covers save/publish/archive/restore. | App owner **unassigned**: identify every deployed/old/preview writer route, jobs and service actors; drain in-flight calls and prevent account reactivation/bootstrap/new writers during pause. |
| Import / operations / direct DB users | `blog-import.ts` uses a privileged owned-Docker connection and bypasses staff checks. Import transaction takes `blog_lock` and table locks, then releases them at commit. Direct SQL need not take advisory locks. | DB/security owner **unassigned**: inventory roles, credentials, consoles, integrations and jobs; supply a reviewed connection/admission fence and drain proof covering every non-import writer. |
| Deployment / CDN / old application instances | No sustained gate or release switch is provided by these modules. Staff deactivation and one importer transaction do not fence all deployed instances or privileged writers. | Release/platform owner **unassigned**: exact project/environment/deployment/domain, routing/pause controls, invalidation commands and verification evidence. |

**Local mechanism actually rehearsed:** four generated fixture users are recorded, set inactive via `staff_users.active=false`, and the existing `blog_lock()` is acquired/released as a cooperating-writer drain barrier. Existing sessions and SQL mutation functions are denied. Only the owned harness/importer continues. After read-only verification, exactly those saved states are restored. The harness is the sole orchestrator of this freshly owned fixture; this is not proof of arbitrary concurrent writer coverage. A zero-row privileged `UPDATE articles` succeeds while staff are inactive, explicitly proving the all-writer gap. No new pause toggle, auth bypass or production pause tool was added. On local failure the owned container is discarded; no hosted automatic reopen behavior is inferred.

**Release stays BLOCKED even if every local test passes.** A partial staff pause is not an approved hosted pause. Do not use the local SQL sequence as a production runbook without the missing writer inventory, controls, scope and authorization.

## Read-only manifest gate

`scripts/blog-cms/verify-manifest.ts` is a thin wrapper over Task5 snapshots/planning and the existing verified owned-Docker target. It has no write, approval-update, generic URL or production connection mode. It checks the approved manifest against its canonical reconstruction, explicit fingerprint/target/source revision, complete sources/tables, snapshot digest/system identity and a fresh read-only DB capture. A different observed fingerprint rejects; it never replaces the reviewed fingerprint.

Tests reject changed DB versions, added public URLs, missing sources/tables/database, failed source reads, target/revision/system/digest mismatch, tampered plans and wrong approval. The actual owned CLI separately proves success, exit-1 rejection paths and protected-snapshot equality/no import receipts. Unit tests also prove inputs/approval are not mutated. Exit 0 returns `verified:true, activationAuthorized:false`; exit 1 is rejection/failure, with sanitized error output.

Pre-import (owned target only; values must come from that running harness, not a historical receipt):

```text
bun run --no-env-file scripts/blog-cms/verify-manifest.ts --manifest <reviewed-manifest.json> --sources <fresh-source-bundle.json> --container <full-owned-id> --target owned:<full-owned-id>:postgres --revision <source-bundle-revision> --fingerprint <approved-manifest-sha256>
```

This reads caller-supplied source observations; it does **not** fetch the hosted sitemap or prove their recency. A separately authorized collector must refresh all source observations under the proven pause and bind them to the source artifact. Reusing stale source files defeats that operational prerequisite. The gate is a point-in-time check, not a sustained lock. Task5 apply independently repeats freshness under its transaction locks; the surrounding all-writer fence must span verification/reopen.

After import, pre-import equality is expected to fail. Use Task5's read-only receipt verification instead:

```text
bun run --no-env-file scripts/blog-cms/import.ts --verify --manifest <reviewed-manifest.json> --sources <source-bundle.json> --container <full-owned-id> --target owned:<full-owned-id>:postgres --fingerprint <approved-manifest-sha256>
```

Exit 0 with `verification:unchanged` is the immediate post-import DB gate. Exit 2 / `changed` blocks acceptance. After legitimate editing resumes, changed is expected and must never trigger automatic overwrite or fingerprint reapproval. The original receipt remains immutable.

## Executable local rehearsal

Run from this worktree with installed locked dependencies and the already-present pinned Docker image. No installation or image pull is required. The existing harness uses `--pull never`, inspects the full random container ID/loopback port/system identifier and cleans up only its own container.

```powershell
bun test --no-env-file scripts/blog-cms/verify-manifest.test.ts
node scripts/test-blog-cutover-db.mjs
npm run test:blog-cms
npm run typecheck
npm run acceptance:blog-cms:build
$env:PLAYWRIGHT_BROWSERS_PATH = 'C:/Users/laich/AppData/Local/ms-playwright'
npm run acceptance:blog-cms:http -- --cutover-rehearsal
```

The fixed build wrapper strips environment to OS/tool paths, rejects dotenv files, requires fresh output and writes a successful receipt. The HTTP child uses an environment allowlist, `.invalid` DB URL and an owned loopback transport bridge; external fetches are denied. Real auth and built server functions are unchanged.

Rehearsal order:

1. Start the exact bound local artifact and generated-session owned DB. Set up the fixture category; record staff states and establish the local staff pause above.
2. Capture complete owned blog inventory under that partial pause; bind fixture source/URLs, manifest and backup SHA. Run pre-import read-only freshness against a second DB capture.
3. Use actual Task5 `applyImport` with the privately registered owned target, manifest authorization and backup digest. Import 101 rich/legacy/null-date/future/unpublished fixtures atomically; retain backup, manifest and full receipt in ignored `.private-sync-evidence/blog-import/task9-rehearsal-<container-id>/`.
4. Before reopening, require `verifyImport` unchanged; compare every imported live row and revision to the input and initial state, and GET all 101 original paths: 99 visible, one unpublished and one future hidden. Verify no redirects and no-store headers. Compare whole protected snapshots before/after reads.
5. Restore exactly the four saved staff states; prove existing sessions regain CMS access. Continue Task8's real HTTP edit/reload of all101 records, copy/features/category handling, conflicts, private drafts, unpublish and read-only receipt replay.
6. Perform the targeted recovery below, then actual built browser retries after DB outage and direct public endpoint failure checks. Re-verify the unchanged source/output/receipt binding.

**Honest limits:** the renderer is already running locally; no hosted deployment/traffic switch is rehearsed. Local freshness is fresh HTTP plus existing no-store policy, not a CDN purge. No hosted sign-in, storage upload, real credential/session revocation, RLS/provider/CDN behavior or remote CI is proven. Backup is a protected blog-table snapshot; no complete database/PITR/media backup restore is claimed.

## Recovery preserving editorial state

Prefer bounded forward repair on the current renderer; never roll back to registry/fallback-resurrecting code. Retain the original manifest, immutable receipt, backup bytes/hash, current snapshot and newer revision evidence before deciding a recovery action.

The executable rehearsal introduces one wrong SEO title **after** post-import editing, then adds a newer title edit. Repair using old tokens fails HTTP409 with an unchanged protected snapshot. It reloads current `editState`/version and submits only the intended SEO correction through the existing CMS save command, preserving current fields. It verifies the newer title/body/publication state, every unaffected protected row, all unrelated revisions/settings/features, another author's active private draft, the withdrawn article, the originally unpublished article and the future-hidden article. Recovery snapshots are retained privately; sanitized fingerprints go to the log. This proves this bounded CAS repair, not general automatic reversal of arbitrary imports.

| Failure point | Required response |
| --- | --- |
| Before import / freshness mismatch | Keep pause, stop activation, retain observations. Reconcile and obtain review/authorization for a new exact manifest. Never silently accept a new fingerprint. |
| Transaction failure before commit | Import is atomic; preserve failure evidence. Reinspect target and current snapshot before retrying the same authorized manifest. Do not infer partial row repair is required. |
| Lost response after commit | Read immutable import receipt / `import.ts --verify`; same-manifest replay is zero-write and detects later drift. Do not re-seed history or republish. |
| Runtime/read failure | Keep temporary unavailability / no-store error behavior. Restore service or forward-fix the exact artifact under the release gate; no registry fallback, empty-success substitution or data rollback. |
| Post-import edits or unpublished states exist | Do not restore the old full snapshot over current data. Identify affected IDs/fields, retain before/current revisions, reload fresh tokens and apply reviewed minimal CAS repair. A stale conflict means stop/reload/reconcile. Never resurrect an unpublished article to satisfy a URL count. |
| Cannot prove preservation or safely scope repair | Maintain temporary unavailability and escalate to the named DB/editorial/release owners for forward repair. Do not reopen by guessing, bulk-deleting imports, reverting schema or reverting to fallback code. |

## Live release worksheet — not executable, no approval requested

The exact target/inventory is unknown, so **there are no honest target-specific hosted commands to supply yet**. The only executable target-specific sequence is the owned rehearsal above. `UNKNOWN` values are blockers, not runnable placeholders. No production adapter is implemented or credential requested.

Before a release request can be concrete/reviewable, fill and review all of these:

| Required binding | Current state / accountable role |
| --- | --- |
| Exact candidate source map, Git revision if later authorized, artifact/build/run receipt | Local hashes below; release owner must choose the exact reviewed artifact after independent task + whole-change review. No commit/push authorization exists. |
| Hosted project/environment, deployment ID, domains/URLs, DB project/branch/database/system identity | **UNKNOWN**; platform and DB owners unassigned. No inferred production URL/DB mapping. |
| Complete live/draft/all-author histories/categories/settings/features/migrations plus source/public inventory | **UNKNOWN**; DB/editorial owners must supply authorized read-only capture/count/pagination/source-recency evidence and disposition of every conflict. |
| Reviewed production target adapter with least privilege and identity/backup/fingerprint checks | **ABSENT**; separately scoped implementation/review required. Do not weaken owned-only guard or paste a URL into this CLI. |
| All-writer pause, drain, verification, owner and exact reopen/restore states | **BLOCKED**; owners/actions in pause table. Include direct SQL, integrations, old instances, in-flight requests and new-user/reactivation paths. |
| Approved schema versions, complete manifest fingerprint, backup/PITR/media coverage and restore rehearsal | Local migration tests/blog snapshot only; real backup locations/digests/restorability **UNKNOWN**. DB owner must establish scoped/full recovery choices. |
| Exact deployment/traffic activation and cache purge/bypass commands; URL/CMS/role test inventory | **ABSENT** for hosted target; platform/app/editorial owners must bind commands and expectations to verified target. |
| Hosted sign-in/Auth/RLS/upload/CDN tests and operational monitoring | **NOT_RUN**. Owners must provide target-specific acceptance evidence without substituting local mocks/owned SQL. |

After those items and separate explicit release authorization only, the operator would: establish and prove the agreed all-writer pause; repeat fresh authorized inventory; reject any changed target/revision/source/manifest; create/verify the approved backup; apply exactly approved schema/import via the separately reviewed target adapter; verify the committed receipt; activate the exact bound artifact; execute the target's actual invalidation mechanism; verify every approved URL/status/body/metadata/sitemap/alternate reader and all CMS records/permissions/private drafts/unpublish/cache results; then restore only approved editorial access states. Any failed gate keeps activation/reopen stopped and invokes the preservation-first recovery decision above. A new fingerprint, code change, target change or repair beyond authorization requires a new reviewable package.

Keep sanitized release/recovery receipts and private raw inventory separately. **Local rehearsal never marks production accepted.**
