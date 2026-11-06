# Blog CMS production release package

**Local implementation candidate only — production activation is BLOCKED.** The earlier push/PR authorization covered the reviewed head now on the remote PR, `08a7a6e7`. The task 4–7 follow-up commits on `codex/blog-cms-release` remain local and require a separate, exact push approval. Merge, deployment, production schema/content/permission changes, writer pause and snapshot creation remain separately unauthorized.

## Exact scope and baseline

Extend `/admin/cms?tab=articles` to edit all existing articles, the main blog and each category's heading, introduction, SEO, ordering and featured placement. Preserve all 112 exact existing article slugs and category query keys. Policy route `/blog/editorial-standards` remains separate. Settings comprise seven categories and eight independent page scopes.

| Identity | Bound value |
| --- | --- |
| Repository | `https://github.com/YNWAforever/earnestproperty.git` |
| Production project/team | `prj_hNaDYmYGeJhBY00vxsC2A0E5Fon5` / `team_qvzlsFmfCsLkgItSypqHjw3z` |
| Production deployment, re-read this continuation | `dpl_CdBSXxdBMMjY6muGmCU6wkxktdY5`, READY, Git source |
| Production source | `main` at `8b49d0a21c867c401c4d41db393e43c8db76a74d` |
| Production domains | `www.earnestproperty.com`, `earnestproperty.com`; existing Vercel aliases also require verification |
| Database | Neon `dawn-meadow-79190048` / `br-polished-sea-aom4i1ct` / `ep-divine-frost-aokzrg7f` / `neondb` |
| App-to-database binding | USER_CONFIRMED; not independently proven from immutable deployment runtime |
| Latest read-only counts | 2026-11-05 20:48 SGT: zero articles, zero article revisions, 95 migrations |
| Candidate | `codex/blog-cms-release`; remote PR remains at `08a7a6e7`, while task 4–7 follow-ups are local only. Bind the eventual pushed head and fresh suite/build receipts in the push/PR handoff. |

The three proposed migrations and exact hashes are in [live-rehearsal.md](live-rehearsal.md). They advance the captured baseline from 95 to 98. No other migration is included. Fresh under-fence capture must match the final approved manifest; the counts above are not a freshness lease.

## Evidence and gate register

The 2026-11-06 finishing baseline recorded 111/111 applicable local CI commands as PASS, a Node24 build and 101-article built HTTP/Chromium acceptance. Those receipts predate task 4–7 and are retained as historical evidence, not a final suite/build binding for the current local head. Task-specific offline verification is recorded in the task 4–7 reports in the local SDD workspace. Hosted accessibility and provider/auth/storage acceptance remain NOT_RUN.

| Gate | Current disposition | Closure evidence |
| --- | --- | --- |
| All 112 source articles, URLs and editability | PASS isolated | Exact-source PG18 SQL/service rehearsal; all slugs locked, all articles draft-save/reload tested |
| Import atomicity, retry and newer-work preservation | PASS isolated | Zero-write repeat import, rollback regression, targeted CAS recovery and private-draft/withdrawal preservation |
| Built app HTTP/browser | PASS historical local binding | Separate 101-record synthetic acceptance, not 112 live HTTP acceptance or current-head build proof |
| Node 24 compatibility | PASS historical local build and HTTP/browser | Portable official Node24.22.2 with pinned owned PostgreSQL18.6; not Vercel runtime proof or a current-head build |
| Local finishing suite | PASS historical baseline | 111/111 applicable CI commands at the prior binding; fresh final suite/build hashes belong in the eventual push/PR handoff |
| Shared migration/import executor | IMPLEMENTATION_READY locally; production BLOCKED | Owned PG18.6 atomic 95→98 migration and 112-record rehearsal, rollback, receipt retry and newer-work preservation passed. Production entry is fail-closed pending independent authority, credential/SQL role, provider target/TLS identity, fresh packet/schema proof, recovery and sustained fence evidence. See [execution contract](production-execution-design.md). |
| Recovery and media evidence validator | IMPLEMENTATION_READY locally; external evidence BLOCKED | No fresh production snapshot, isolated restore, media copy or cleanup occurred. Provider provenance, signed evidence, archive bytes and separate action approvals remain required; see [recovery package](release-recovery.md). |
| Writer register/validator | IMPLEMENTATION_READY locally; live fence BLOCKED_NOT_ACTIVATED | 36 proposed controls and separate activation, bounded acceptance-access and reopening requests exist. Complete credential-holder inventory, drain and per-writer denial/finalization proof remain external; see [writer control register](live-write-pause.md). |
| Isolated hosted/accessibility runner | IMPLEMENTATION_READY locally; hosted execution NOT_RUN | Pure guards and local loopback Chromium/axe regressions passed; no isolated provider resources, real identities/sessions, hosted cleanup, production CDN/cache behavior or hosted acceptance was exercised. See [hosted approval request](hosted-acceptance-approval-request.md). |
| Named accountable owners | USER_CONFIRMED | Willy covers release decision-maker, database/recovery owner, platform/deployment owner and editorial approver. Assignment does not approve any release action. |
| Under-fence freshness and approval | NOT_RUN | Recollected exact source/DB/schema/target; new fingerprint reviewed if any change |
| Push and PR | Prior reviewed head only | Remote PR remains at `08a7a6e7`; the new local follow-up commits need a separate push approval. Do not represent them as remote CI or PR evidence. |
| Merge, production changes and activation | NOT_APPROVED | Separate, exact action approvals; scope coupling checked before each |

## Historical local build binding (before task 4–7)

| Field | Value |
| --- | --- |
| Node runtime | `v24.22.2` portable Windows x64, matching Vercel's configured major |
| Official archive SHA-256 | `ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2` |
| Full source SHA-256 | `7e784a7a5f14b8d50d48d775e98e11ec2c98c97f7d0d3897157db999342870e7` |
| Built output SHA-256 | `f2a1462b3be64f7479616b9a4c8b23430ed16c8f72596d283e8becbef220b9c9` |
| Build receipt SHA-256 | `85a93b9d79aa5315047a5292702b1658aa3696949d54d58b1cdb1711a4953a2b` |
| Built at | 2026-11-05 21:03:29 SGT (`2026-11-05T13:03:29.231Z`) |

Official Node archive and SHA list came from [Node's release distribution](https://nodejs.org/download/release/latest-v24.x/). Archive bytes matched the SHA-256 list; no global runtime installation was changed. This is Windows local acceptance, not Vercel's Linux/Neon-fork/hosted-auth environment. Build retains existing dependency/chunk warnings and Node DEP0190; these were not represented as a pristine warning-free build.

Twenty-five packet tests, strict TypeScript and formatting passed. Forty-four owned-target/image guards passed under Node24. Independent preparation review passed after the P3 nested-binding fix, with no remaining actionable finding in that scope. Existing owned-importer guards and application behavior were not changed in this continuation. The first Node24 HTTP attempt failed on sandbox Docker pipe access; it is retained as failure evidence, not counted as a product test pass. Both the authorized local Docker retry and final post-hardening HTTP/browser run passed with exit 0.

The final built Nitro run used real local PG18.6 and the separate 101-article synthetic scenario: all CMS save/reload operations, 99 public URLs returning 200, draft/future URLs returning 404, independent main/category features, concurrency/private drafts/withdrawal, status/header boundaries and actual Chromium outage recovery passed. Build bindings matched at start and end. The expected unconfigured WhatsApp warning was recorded; no unexpected server stderr occurred. Controller separately verified the exact final container `96fdd991433cd76d9b7bbd0c27d356904f68935682a63e397fb70d8945669d47` and earlier Node24 retry container were absent after owned cleanup. No production services were exercised by these write tests.

Evidence: `.superpowers/sdd/2026-11-05-blog-cms-live-reconciliation-release/`, including `production-adapter-report.md`, `production-package-review.md`, `release-provider-metadata.json`, `node24-guards.log`, `release-node24-final-build.log`, `release-node24-final-http.log`, `release-node24-build-receipt.json`, `release-node24-candidate.json` and `production-draft-receipt.json`. Prior draft/build evidence remains preserved separately.

## Draft manifest and implementation boundary

The original offline `scripts/blog-cms/production-adapter.ts` draft bound target, source bytes, planned 112 articles, seven categories, eight scopes and migration hashes. Its historical 25-test preparation result and private manifest below remain draft evidence. Task 4 subsequently extracted the shared atomic migration/import transaction and added an authenticated, fail-closed production entry point plus owned PG18.6 rehearsal. The production path has no provisioned trusted authority, credentials, independently verified provider mapping, recovery proof or sustained live fence. It cannot be treated as ready to execute on production.

Private draft: `.private-sync-evidence/blog-import/production-draft-2026-11-05T13-02-49-838Z/manifest.json`. Manifest fingerprint `8890f2c8e7e0914e159ddca98e4e774e1c7074129fd824d215cc25bfa63186b0`; file SHA-256 `831d3462ae32a94b650796bc9f8101112c7d985a54ac4bf2cf7970aa7dda8afe`. Status is **DRAFT_NOT_AUTHORIZATION**; missing production post-migration snapshot remains explicit. It is reviewable source intent, not a release-ready import manifest. Do not approve or execute this draft as if the missing target snapshot and controls existed.

The importer retains its private owned-container capability. Task 4 added the shared transaction core without weakening that guard and rehearsed migration/import/receipt behavior on owned PG18.6. The [execution contract](production-execution-design.md) records the original design and current status. Independently trusted production authority, direct target/SQL/TLS proof, restored recovery evidence and an externally enforced fence remain unprovided. Selected semantic hashes do not substitute for a fresh full candidate/build receipt.

Read-only Vercel API metadata confirms GitHub integration, production branch `main`, `gitProviderOptions.createDeployments="enabled"`, no returned `gitDeploymentEnabled` override and no ignore-build command. The candidate therefore adds `"codex/blog-cms-release": false` to the source-controlled `git.deploymentEnabled` map, with its contract test. This suppresses automatic previews for this branch without changing the project setting or `main`. After the push, verify that no deployment was created; a deployment requires separate approval. A merge may still deploy and remains separately blocked.

## Hosted acceptance preparation

Use a separately approved preview deployment bound to an isolated Neon target and isolated media storage. Verify every connection identifier before deployment; do not inherit production credentials into preview. Authentication must use approved test identities with real admin/manager/agent/anonymous boundaries and isolated users/data. Do not copy production sessions into preview.

Run the [112-URL checklist](release-url-checklist.json), plus main/category settings, all-record CMS list/preview/save/reload, feature placement, competing editors, private drafts, publish/unpublish, future/null dates, retry after outage and redirects/canonicals. Capture per-URL status and content/manifest association rather than a single homepage screenshot. In the isolated hosted environment, upload a small test image, verify stored metadata/bytes and role denial, and perform separately scoped cleanup. Validate production storage mapping read-only before any live upload test.

Confirm `Cache-Control`, `CDN-Cache-Control`, `Vercel-CDN-Cache-Control` and actual repeated responses on custom domains and immutable URLs after activation. Old content must not survive as cached public HTML or obsolete mutation endpoints. A no-store response from the new app does not purge an old cached response. Vercel provides CDN cache purge, but the command must be bound to the exact project/team and separately approved as part of activation: [Vercel cache CLI](https://vercel.com/docs/cli/cache). No purge was run.

## Approval sequence and stop conditions

1. **Follow-up push/PR update — NOT_APPROVED:** the remote PR still points to `08a7a6e7`. Obtain separate approval for the exact local head before pushing the task 4–7 commits; bind fresh suite/build hashes in that handoff. The branch-level source control disables Vercel deployment creation for this branch; verify that no deployment appears after any approved push. A push approval does not authorize deployment. Vercel's documented branch controls are [git.deploymentEnabled](https://vercel.com/docs/project-configuration/git-configuration); no project-level setting was changed.
2. **Isolated hosted validation:** separately approve exact new isolated resources, identifiers/bindings, preview artifact, allowed test writes and cleanup. Do not select an existing branch merely by a reassuring name. This closes provider/runtime/auth/media gates without production mutation.
3. **Merge only:** exact PR/head/base, CI and independent review. A merge to the production branch may deploy; prove automatic deployment is prevented or obtain a separate explicit deployment approval before merging. CI is not evidence that this coupling is disabled.
4. **Production operational controls and DB writes:** separately approve precise writer fence, role/access/job changes, drain, new backup and recovery proof; then exact three migrations, immutable import manifest and adapter revision with bounded operations. A fresh capture that differs stops execution and requires new review. No manifest is auto-approved by a matching article count.
5. **Deployment/traffic/cache activation:** exact built artifact and candidate revision, project/team, aliases, runtime config and cache operations; preserve the sustained fence while verifying. Do not deploy the old registry renderer as an automatic recovery from a failure.
6. **Reopen:** only recorded prior access states/jobs, after acceptance and owner sign-off; preserve previously inactive users/jobs. On any unknown target, stale source, missing backup, unproven fence, incomplete result or failed verification, stop with the fence maintained and use reviewed recovery.

These are preparation steps and approval templates, not runnable approvals. No production release request should be marked ready while a gate above is BLOCKED. Exact live mutation commands depend on provisioned authority/credentials, fresh recovery proof, a reviewed and proven sustained fence and an approved production packet; the owned-container CLI supplies none of those.
