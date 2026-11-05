# Blog CMS Task 1 baseline

Date: 2026-11-05. Authority: `.superpowers/sdd/2026-11-05-blog-cms-implementation/task-1-brief.md`; full plan not read.

## Verdict and provenance

**PASS — local baseline established; pure implementation can proceed to review. DB acceptance NOT_RUN; release linkage unresolved.**

- Checkout: `C:/Users/laich/.codex/worktrees/earnest-blog-cms/Earnestproperty`.
- Origin: `https://github.com/YNWAforever/earnestproperty.git`.
- HEAD: `8b49d0a21c867c401c4d41db393e43c8db76a74d`, detached HEAD. User identified this as fresh remote-main base; no fetch performed.
- Initial elevated `git status --short`: only existing untracked `docs/superpowers/plans/2026-11-05-blog-cms-implementation.md` and `docs/superpowers/specs/2026-11-05-blog-cms-design.md`. Preserved. Default-sandbox status produced a misleading work-tree error; elevated status resolved it before edits.
- Read AGENTS.md, CLAUDE.md and `C:/Users/laich/.codex/RTK.md`. No product edits, commit, installation, migration, production access, push, merge or deployment performed.
- Discovery initially used authorized rg fallback after controller-reported graph hang. After index restoration, graph project `earnest-blog-cms-20261105` confirmed current CMS mutation functions and article UI handlers. Fast index excludes scripts/migrations/docs; those were read directly.
- Deployed revision and backend linkage: **UNRESOLVED / release blocker**. No hosted inspection; local SHA and local tests do not establish production behavior.

## Actual writers and permissions

| Owner | Current behavior | Executable coverage |
| --- | --- | --- |
| `src/routes/admin.cms.tsx`: `handleSaveArticleDraft`, `handlePublishArticle`, `handleRestoreArticleRevision`, `handleArchiveArticle`, `ArticleDialog` | Article UI uses revision engine, versioned draft save, explicit publish, restore and archive. Copilot `onApply` updates editor state. | `npm run test:cms`; `npm run test:content-copilot` |
| `src/lib/neon/admin-cms.ts`: authenticated server-function wrappers and Zod write validators from `admin-write-schemas.ts` | Lazy server boundary; callers supply staff auth headers. | `npm run test:cms`; `npm run test:staff-server-fn` |
| `src/lib/neon/admin-cms.server.ts`: `saveAdminCmsDraft`, `publishAdminCmsRevision`, `restoreAdminCmsRevision`, `archiveAdminCmsResource`, private `mutateCms` | Save allows admin/manager/agent. Publish, restore and archive require admin/manager. Restore makes a private draft, not a live publication. Read/edit hides other users' drafts except explicit admin/manager review. | `npm run test:cms`; `npm run test:cms:db` (NOT_RUN) |
| `neon/migrations/20260905110000_cms_atomic_mutations.sql`: `cms_mutate` | Advisory lock per type/id; active staff role checked again in SQL; draft/base version checks; revision, live projection and audit atomic. Publish upserts articles with `published=true`, sets `published_at=now()` even on republish. Archive sets false and retires drafts. | `npm run test:cms`; `npm run test:cms:db` (NOT_RUN) |
| `src/lib/ai/content-copilot-admin.ts`, `content-copilot.server.ts`, `content-copilot-repository.server.ts`; `src/components/admin/AdminContentCopilot.tsx` | Generate/decide require `ai.draft.generate`. Service checks fingerprint, accepted-field allowlist and expiry. Repository decision updates proposal status, not article content. UI applies selected patches locally; subsequent CMS save/publish is required. | `npm run test:content-copilot` |
| `neon/migrations/20261003040000_content_proposal_source_guard.sql`: `ep_assert_content_snapshot`, `ep_assert_content_proposal` | Stricter article copilot guard: non-listing resources require admin/manager, with active staff/auth binding and source revision validation. Preserve despite agent having general `ai.draft.generate`. | `npm run test:content-copilot`; `npm run test:crm-analysis:db` (NOT_RUN) |
| `scripts/old-site-migration/import.mjs`: `importLegacyRunDir`, `liveSync`; `src/lib/mls/importer.mjs` | Inspected import entry imports properties, not articles. Bounded searches across src/scripts/neon found no dedicated article importer or alternative direct article writer beyond CMS SQL projection. Not a claim about external/manual SQL. | `npm run test:migration` (NOT_RUN) |
| `src/routes/api.admin.media.upload.ts`, `src/lib/media/media-upload-service.ts`, `media-upload-repository.server.ts` | Separate upload boundary permits admin/manager/agent; owner type includes article; image MIME/signature, size and upload ID checks. Uploading is not article publication. CMS SQL protects referenced cover media against archive. | `node --test src/routes/api.admin.media.upload.test.mjs src/lib/media/media-upload-boundary.test.mjs src/lib/media/media-upload-service.test.mjs` (NOT_RUN) |

**Brief drift:** `saveAdminArticle` does not exist in this revision (source search and graph confirm current revision APIs instead). Its historical admin/manager check cannot be asserted as current. Preserve current admin/manager publication/restore/archive checks and stricter article-copilot checks; do not recreate a direct live writer from the stale name.

Auth owners: `src/auth.ts` (`withStaffAuthHeaders`), `src/lib/neon/auth.server.ts` (`requireStaffAccess`, session/staff resolution), `src/lib/control-plane/permissions.ts` (`requireStaffPermission`) and `role-permissions.ts` (`hasPermission`). Admin has all grants; manager has `cms.publish`; agent can draft but cannot publish; viewer cannot CMS-write. Commands: `npm run test:team`, `node --test src/lib/control-plane/permissions.test.mjs` (NOT_RUN in Task 1).

## Readers, canonical and indexing policy

- `src/lib/neon/public-data.server.ts`: `fetchPublishedArticles`, `fetchArticleBySlug`, `fetchSitemapTimestamps`; wrappers in `public-data.ts`; public facade in `src/lib/queries.ts` including category filtering. DB reads filter `published=true`, without a future `published_at` time gate. List query maps SEO fields it does not select; detail query does select them. Coverage: `npm run test:blog`, `npm run test:seo`, `npm run test:cms`.
- `src/routes/blog.tsx`: DB list when nonempty, otherwise scheduled static fallback; not a merged list. Category search changes metadata but canonical stays `/blog`.
- `src/routes/blog_.$slug.tsx`: DB fields overlay matching published static registry article; DB-only published article also resolves. Unknown article throws notFound, emits `noindex,follow`, no canonical. Public detail canonical is `/blog/<slug>`. Plain DB content is converted to sections. Coverage: `src/routes/blog.routes.test.mjs` in `npm run test:blog`, SEO contracts in `npm run test:seo`.
- `src/content/blog-articles.ts`: `publishedBlogArticles` gates static schedule per request; derived content in `estate-review-articles.ts` and `estate-decision-*.ts`. `src/routes/estate-reviews.tsx` uses DB category list or static fallback; empty result noindexes. `src/routes/estate.$slug.tsx` related articles use published static registry. Coverage: `npm run test:blog`; `npm run test:estate-reviews` (latter NOT_RUN).
- Additional readers: `src/lib/neon/admin-data.server.ts` (`listAdminCms`), `admin-pagination-query.ts`, revision hub/category/editor in `admin-cms.server.ts`; `src/lib/ai/content-copilot-context.server.ts`, `knowledge.server.ts`, `knowledge-freshness.server.ts`; `src/routes/llms[.]txt.ts`. Coverage: `npm run test:cms`, `npm run test:content-copilot`, `npm run test:seo`; knowledge DB commands `npm run test:ai-knowledge:db` (NOT_RUN).
- Canonical origin owner: `src/content/seo.ts` (`SITE_URL`, `canonicalLink`), build selection in `scripts/site-origin.mjs` / `vite.config.ts`. Configured production origin is used rather than incoming host; local fallback is `https://earnestproperty.vercel.app`. This is source policy, not verification of current production origin. Coverage: `npm run test:seo`.

**Integration concern:** CMS archive/unpublish does not suppress a matching static article; fallback can keep it public. A nonempty DB list also hides static-only articles on hubs while sitemap still includes them. Future tasks must reconcile authoritative publication behavior without assuming DB-only ownership today.

## Existing sitemap and cache owners

- Actual sitemap is `src/routes/sitemap[.]xml.ts`, GET `/sitemap.xml`; do not add a speculative route. It unions scheduled static articles with published DB article slugs, deduplicates paths, and uses `src/lib/sitemap-lastmod.js` / `fetchSitemapTimestamps`. Cache is `public, max-age=3600, s-maxage=3600`; degraded dependencies set `no-store`. Coverage: `src/routes/sitemap.contract.test.mjs` in `npm run test:seo`.
- Shared response helper `src/lib/http/public-cache.js`: `publicPageCacheHeaders`, `PUBLIC_CDN_CACHE`, Vercel-only `max-age=60, stale-while-revalidate=300`; successful loaded public routes only, denies private prefixes/errors/missing data. Wired into index/listings/property/estate/corridor routes, **not blog hub/detail or estate-reviews**. Test: `node --test src/lib/http/public-cache.test.mjs` (passed in focused combined run).
- `publishAdminCmsRevision` / `archiveAdminCmsResource` invalidate `public-estate-options-cache.ts` only for estates. No article-specific response purge was found in these mutation owners. Sitemap can remain stale under its explicit one-hour cache. `vercel.ts` / `scripts/vercel-headers.mjs` own redirects/security headers; legacy news URLs redirect to `/blog`. Coverage: `npm run test:seo`; `node --test src/lib/neon/public-estate-options-cache.test.mjs` (NOT_RUN).

## Schema, transactions and isolated target

- Base schema: `neon/migrations/20260622060000_public_content.sql`, articles UUID PK, unique slug, text content, category/cover, reading minutes, published default true and timestamps. `20260623090000_neon_admin_crm_whatsapp.sql` adds author and SEO fields.
- Revision schema/backfill: `20260711090000_cms_content_revisions.sql`; atomic mutation/immutability and one-publication index: `20260905110000_cms_atomic_mutations.sql`; browse order: `20260905181000_cms_browse_order.sql`. Article knowledge trigger: `20261003010000_ai_knowledge_durable_repair.sql`. Later task changes must account for these existing migrations, not assume an empty CMS.
- Migration conventions: timestamped SQL, ordered manifest `src/lib/control-plane/migration-versions.js`; runner `scripts/neon/apply-migrations.mjs` scans sorted SQL and records `app_migrations`. Runner loads application env files: **not executed**. Coverage command: `node --test src/lib/control-plane/migration-versions.test.mjs scripts/neon/check-migration-drift.test.mjs` (NOT_RUN).
- `src/lib/neon/db.server.ts`: `queryRows` and `transactionRows` use Neon HTTP query/transaction batches; isolation level option supported. No interactive awaited transaction callback abstraction. CMS uses one SQL function invocation for atomicity; do not substitute independent queryRows calls for a transaction.
- Authorized candidate: local owned Docker harness `scripts/acceptance/owned-postgres-test.mjs` (`withOwnedPostgres`, `dbTargetOrOwned`), pinned pgvector image, fresh random container, inspected identity and loopback port, migrations applied, automatic owned-container cleanup. `scripts/acceptance/migrated-schema.mjs` (`isolatedDatabase`, `applyMigrations`) creates fresh DB and random schema from real ordered migrations. Test command: `npm run test:cms:db`.
- `scripts/test-cms-db.mjs` seeds synthetic admin/manager/agent/viewer/revoked actors, tests CMS SQL; does not prove real browser authentication. Explicit external disposable mode requires `CMS_TEST_DATABASE_URL`, `CMS_TEST_DATABASE_APPROVED=disposable`, plus `assertDisposableNeonTestTarget` confirmation, matching branch/endpoint and named acceptance database. Application URL reuse is refused.
- Runtime identity: **NOT_VERIFIED**. Docker CLI exists but `docker info --format '{{.ServerVersion}}'` fails: Linux engine pipe not found, including elevated retry. Test/app DB env names checked for presence only: all unset. Only `.env.example` exists. No credentials loaded, DB created, migration applied or data rehearsal performed. DB cases **NOT_RUN**, prerequisite **BLOCKED**. Harness/mock guard tests PASS do not establish a running isolated database or authenticated session.

## Executed baseline checks

Node v26.13.0; Bun 1.3.14. Controller completed dependency installation; this task did not duplicate it.

| Command | Result |
| --- | --- |
| `npm run test:blog` | PASS, exit 0; Node 42 + Bun 5 |
| `npm run test:cms` | PASS, exit 0; Node 60 + Bun 31 |
| `npm run test:seo` | PASS, exit 0; Node 106 + Bun 24 |
| `npm run test:content-copilot` | PASS, exit 0; Node 104 + Bun 34 |
| `node --test src/lib/http/public-cache.test.mjs scripts/acceptance/owned-neon-sql.test.mjs src/lib/neon/disposable-test-target.test.mjs` | PASS, exit 0; 20 tests |

406 required-suite tests plus 20 focused tests; zero failures or skips. No baseline test failures observed; no product changes to classify as regressions. Full logs and command receipt: `.superpowers/sdd/2026-11-05-blog-cms-implementation/task-1-report.md` and adjacent `test-logs/`. Other commands in owner tables are executable follow-up coverage, explicitly not claimed run. Hosted/authenticated acceptance, build/typecheck, live DB and release checks NOT_RUN.

## Local database prerequisite recovered
Controller started Docker locally after a memory check. Docker 29.8.1 and the pinned pgvector image were verified. Existing `npm run test:cms:db` then passed all 16 owned Postgres groups (roles, races, atomic rollback and legacy reconciliation). Log: `.superpowers/sdd/2026-11-05-blog-cms-implementation/test-logs/cms-db-baseline.log`. This supersedes the earlier local Docker prerequisite block only; hosted/deployed linkage remains unverified and production unchanged.

## Read-only deployed revision linkage
Controller queried connected Vercel get_deployment for www.earnestproperty.com on 2026-11-05 (read-only). Returned project earnestproperty, deployment dpl_CdBSXxdBMMjY6muGmCU6wkxktdY5, production READY, alias includes www.earnestproperty.com, source git, repository YNWAforever/earnestproperty, main SHA 8b49d0a21c867c401c4d41db393e43c8db76a74d. This matches the isolated worktree base and resolves source/artifact linkage at this observation time. It does not prove database identity, hosted CMS acceptance or data inventory completeness. No deployment, configuration, access link or production data was changed.

## Task 3 editor/schema decision (2026-11-05)

Local implementation uses exactly pinned Tiptap 3.32.2: @tiptap/core, @tiptap/pm, @tiptap/react, @tiptap/starter-kit and @tiptap/extension-image. npm registry peer inspection verified React 19 support; package-lock.json and installed sources verified coherent 3.32.2 Tiptap resolution with no unrelated version upgrades. Official references: https://tiptap.dev/docs/editor/getting-started/install/react and https://tiptap.dev/docs/editor/api/utilities/static-renderer. Future editor uses immediatelyRender:false.

Schema source: src/lib/blog/editor-schema.ts. editor-json-v1 supports doc, paragraph, text, heading (2/3/4), bulletList, orderedList, listItem, blockquote, hardBreak, horizontalRule and block image; marks bold/italic/strike/underline/code/link. Code blocks and trailing-node insertion disabled. Exact strict attrs, safe URL rules and bounded JSON validation live in src/lib/blog/content.ts; actual ProseMirror schema checks enforce content grammar. Public ArticleBody validates the same schema before explicit React rendering. No arbitrary HTML. Unknown editor document is input-only; validated DTO output is EditorDocument via ValidatedArticleBody.

Explicit registry conversion retains section headings/paragraphs as editor nodes and author/reviewer/sourcesNote/answerSummary/compareEstateSlugs as typed editorial metadata, with links separate and original publication dates preserved. No registry mutation, import or persistence. Task 4 owns metadata/payload encoding; Task 6 editor UI; Task 7 full metadata/live comparison/public visibility integration. All 112 registry entries pass preservation checks. Full exact interfaces, version/allowlist details, test evidence and concerns: .superpowers/sdd/2026-11-05-blog-cms-implementation/task-3-report.md. Final local checks: focused 28 PASS, blog suite 80 PASS, wiring 10 PASS, focused lint and full TypeScript PASS. No commit or production changes.

## Public sitemap inventory observation
Read-only public sitemap fetch on 2026-11-05 returned HTTP 200 and 113 /blog/ URLs; 112 match all code-defined registry articles. Remaining /blog/editorial-standards is a dedicated policy route (src/routes/blog_.editorial-standards.tsx), not an article record. Preserve this route and reserve its slug against article creation. Record as an explicit inventory exclusion rather than an import omission. This sitemap observation does not enumerate drafts or establish DB inventory completeness. Snapshot: public-sitemap-snapshot.json in this evidence folder.
