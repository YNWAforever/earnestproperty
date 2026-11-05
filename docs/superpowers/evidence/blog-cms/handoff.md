# Blog CMS implementation handoff

## Current status — production release package prepared

**Latest finishing check:** integration is blocked. Fresh Node24 `npm run test:corridor` returned 37 passed / 5 failed with a server-only import resolution error from a data URL. The CI matrix stopped at that first suite; remaining suites were not run. Earlier focused acceptance below is not a green full-suite result. Worktree and all evidence remain preserved.

[Production release package](release-request.md) now includes a non-executable exact-target draft for 112 articles, URL checklist, writer pause/reopening proposal, recovery procedure, hosted acceptance sequence and remaining executor implementation contract. Twenty-five draft integrity tests and independent review passed. Final Node24.22.2 build and real local PG18 HTTP/Chromium acceptance passed; 44 owned-target guards also passed. Production remains unchanged. Willy is confirmed for all four ownership roles. The write executor, real fence/restore/hosted acceptance and separate approvals remain open. Read-only Vercel metadata confirms automatic Git deployments are enabled, so a future push/merge must not imply deployment permission.

Current source: `7e784a7a5f14b8d50d48d775e98e11ec2c98c97f7d0d3897157db999342870e7`. Current output: `f2a1462b3be64f7479616b9a4c8b23430ed16c8f72596d283e8becbef220b9c9`. Build receipt: `85a93b9d79aa5315047a5292702b1658aa3696949d54d58b1cdb1711a4953a2b`. The earlier [112-article isolated rehearsal](live-rehearsal.md) remains separate exact-source evidence; its historical source/build hashes are superseded by this receipt.

## Historical implementation and follow-ups

2026-11-05. Local implementation complete; final independent review approved; the remaining draft-URL wording issue was corrected and verified in the subsequent user-authorized follow-up. Production unchanged. Changes are uncommitted in the managed earnest-blog-cms worktree.

Delivered: existing CMS article editing with full pagination, safe rich content and metadata; separate main/category headings, introduction, SEO and ordered featured selections; fixed existing URLs; permissions, private drafts, reconciliation, stale-write protection and restore retries; repeatable owned-target import and publication-safe public rendering.

Validation: required CMS/blog/SEO/copilot and affected boundary suites, owned PostgreSQL integration, 101-article end-to-end acceptance, browser scenarios, full build and real local built HTTP/private headers/outage retry passed. Diagnostics are qualified in the linked evidence. Final reviewer found no critical or important residual defect.

Current verified source: 947e25836611d71caea647f0062bc5010570896045c6d39a7dfac725c71aef4f
Current verified output: 5e38e73cc2f3d18b4e2c6553435f67bcb0d0287b53da32658ec330a42e3b88af

Current follow-up evidence: .superpowers/sdd/2026-11-05-blog-cms-implementation/url-label-followup-report.md, including two targeted browser passes, refreshed full build and real local HTTP acceptance. The final-fix addenda remain prior acceptance evidence. Earlier acceptance.md and cutover.md remain historical and explain the release process. Full reports, decisions, failures and receipts are preserved in .superpowers/sdd/2026-11-05-blog-cms-implementation/.

Resolved follow-up: the locked-URL notice now uses record?.slugLocked, matching the input. Existing browser cases verify saved unlocked drafts omit the notice and locked imported/published articles retain it. No known review finding remains open.

Release remains BLOCKED: complete live inventory/reconciliation, actual target, reliable all-writer pause, production target adapter, hosted authentication/storage/CDN acceptance and real recovery verification are not established. No existing production articles have been migrated by this task. Push, merge, deployment and production database changes require separate approval. No such action was performed.

Live inventory and release plan: [2026-11-05-blog-cms-live-reconciliation-release.md](../../plans/2026-11-05-blog-cms-live-reconciliation-release.md). Planning is complete; live collection, reconciliation and release execution are not claimed. Separate approvals remain required for push, merge, deployment and production database changes.

Read-only readiness follow-up: [live-target.md](live-target.md) records the current production deployment, candidate receipt revalidation and discovered Neon project/branch. Deployed endpoint/database binding, read-only collection access and named owners remain unresolved; no live content inventory was collected.

Latest access continuation: [live-access-check.md](live-access-check.md) verifies read-only repeatable-read sessions on the candidate `neondb` database and documents the limited reader's missing article privileges. Sensitive Vercel connection values remain unavailable, so exact application binding requires confirmation. No production permissions or content changed. New operational collector source is being added separately; the full-source build receipt above remains historical for the pre-collector candidate and must be refreshed before release, even though application code is unchanged by this continuation.

[Live public/source inventory](live-public-inventory.md) is complete for the main blog, all seven category pages and sitemap: nine successful GETs, 112 registry article URLs matching 112 sitemap article URLs, plus one excluded policy URL. The authoritative source bundle and sealed raw evidence remain ignored. No public/source URL gaps were found; database articles, revisions and private drafts remain UNKNOWN and release readiness remains false.

[Current inventory readiness](live-inventory-readiness.md): separate read-only collector implemented, 23 tests/strict targeted TypeScript pass, reviewer fixes accepted, and the isolated CLI regression retry passed. Live database content collection awaits the two binding/access confirmations; no production changes were made.

Latest outcome superseding that pending state: [live reconciliation](live-reconciliation.md) completed after explicit user binding/access confirmation. The confirmed production database has 0 article rows and 0 article revisions; refreshed public/source observations match all 112 article URLs. Raw evidence is sealed privately; the legacy schema remains unchanged. All 112 articles are source-only import candidates, not approved imports. Isolated migration/import rehearsal and the remaining release gates are next; no push, merge, deployment or database writes occurred.
