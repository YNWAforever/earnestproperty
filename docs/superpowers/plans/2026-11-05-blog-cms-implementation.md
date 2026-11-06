# Blog CMS Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all existing articles editable through the existing CMS, with independent main-blog/category presentation and featured ordering, preserving URLs and publication state.

**Architecture:** Extend the existing articles store and staff server-function boundary with normalized categories, page settings and ordered placements. Reconcile existing database, code and public content before enabling the new database-only public renderer. Separate content conversion, repository operations and UI into focused modules while keeping the existing CMS entry point.

**Tech Stack:** Existing React 19, TanStack Start/Router, TypeScript, Zod, Neon Postgres raw SQL, Tailwind/shadcn, Bun and Node test runners. Choose a maintained rich-text editor during Task 3 after verifying current React/SSR compatibility; do not introduce another CMS or ORM.

**Spec:** [Approved design](../specs/2026-11-05-blog-cms-design.md).

## Global Constraints

- Preserve every existing article URL.
- Each article has one category for compatibility with the current model; uncategorized articles appear on the main blog only.
- Preserve current query keys exactly, including `成交分析`.
- Main and category featured selections are independent.
- Existing article slugs are read-only.
- A failed read is not evidence of an empty collection.
- Do not render arbitrary stored HTML unsafely.
- Do not widen staff permissions as part of this change.
- Deployment and production writes require separate task-specific approval.
- Public/admin copy remains zh-HK. Keep property listings, collection jobs, and unrelated CMS tabs unchanged.
- Planning occurs in the project mirror; never modify synced `sources/`. Execution starts only after review and method selection. Preserve dirty work and confirm the application checkout before editing it.
- Commits below are review checkpoints, performed only if task-specific Git authorization exists; otherwise leave the reviewed changes uncommitted. No push, merge, live migration or deployment is implied.

## Review Focus

1. Chinese category keys, literal `%` characters and malformed encodings must not be decoded twice or silently resolve to all articles (Tasks 2, 7).
2. A feature save racing with unpublish/category reassignment must not leave publicly eligible stale content (Task 4).
3. Null legacy dates, supplementary links and mixed legacy body formats must survive import without fabricated values (Tasks 3, 5).
4. A changed database or public inventory between rehearsal and activation must invalidate the old approval manifest (Tasks 5, 9).
5. A successful save followed by a refresh failure must not invite a duplicate create or discard the editor's saved identity/version (Tasks 4, 6).

---

## Execution context and file map

Candidate application root: `C:/Users/laich/Documents/Earnestproperty/Earnestproperty`. It is not yet established as the authoritative deployed checkout. The local blog differs from the retrieved public page. Task 1 resolves this before changes. All code paths below are relative to the confirmed application root; proposed new paths are intentional, not claims they already exist.

Existing owners verified in planning:

| File | Planned responsibility |
|---|---|
| `src/routes/admin.cms.tsx` | Mount focused blog management UI; preserve `?tab=articles` and other tabs |
| `src/lib/neon/admin-data.ts`, `admin-data.server.ts`, `admin-data.types.ts` | Maintain staff wrapper compatibility; route article writes through the new service |
| `src/lib/neon/public-data.ts`, `public-data.server.ts`, `public-data.types.ts` | Public settings/articles adapters |
| `src/lib/queries.ts` | Public query integration without article fallback |
| `src/routes/blog.tsx`, `src/routes/blog_.$slug.tsx` | List/category/detail rendering, error states and metadata |
| `src/lib/neon/admin-cms.server.ts` | Reconcile alternate article mutation/revision paths with the same invariants |
| `src/content/seo.ts` | Existing article registry; preserve as import/reference input, remove public runtime dependence only at activation |
| `package.json` | Named test commands and editor dependencies selected in Task 3 |

New focused files:

- `src/lib/blog/types.ts`, `validation.ts`, `presentation.ts`: shared contracts and pure rules.
- `src/lib/blog/content.ts`, `src/components/blog/ArticleBody.tsx`: versioned safe content conversion/rendering.
- `src/lib/neon/blog-repository.server.ts`: database operations with transactions, version checks and feature eligibility.
- `src/lib/blog/reconcile.ts`: deterministic inventory comparison and import plan.
- `scripts/blog-cms/reconcile.ts`, `apply-import.ts`, `verify-manifest.ts`: explicit-target offline/read-only/import/verification entry points.
- `src/components/admin/blog/BlogManager.tsx`, `ArticleEditor.tsx`, `BlogSettingsEditor.tsx`, `CategoryEditor.tsx`, `FeaturedArticlesEditor.tsx`: focused CMS controls.
- `neon/migrations/202611050001_blog_cms.sql`: proposed additive schema migration; if the authoritative migration convention or sequence differs, record the exact replacement filename in Task 1 before writing it.
- `docs/superpowers/evidence/blog-cms/`: sanitized baseline, manifest summary, test receipts and release checklist. Private snapshots/backups stay outside tracked evidence.

## Task 1: Establish the authoritative baseline and test target

**Files:** Create `docs/superpowers/evidence/blog-cms/baseline.md`; read existing owners above, repository instructions, migrations, auth, media, revisions, sitemap and caching owners.

**Interfaces:** Produces a baseline recording checkout/revision, local changes, deployed revision evidence or unresolved linkage, all article writers/readers, canonical policy, CMS permission policy, transaction support, sitemap/cache owner paths, and verified isolated-test target identity. This artifact supplies integration points to Tasks 2–9.

- [ ] Verify repository identity and dirty state without resets. Resolve the earlier worktree-status failure before editing. Use codebase-memory graph tools for discovery; index first if absent. Fall back only when unavailable/insufficient, recording that limitation.
- [ ] Trace all article mutations, including generic CMS, content-copilot, revision restore and imports. Record exact functions/files and current publication/role behavior. Confirm inspected `saveAdminArticle` permits admin/manager; preserve any stricter current capability checks.
- [ ] Identify the actual sitemap and response-cache code and record exact paths and relevant tests in the baseline. Verify public canonical/indexing behavior. No speculative new sitemap route.
- [ ] Run `npm run test:blog`, `npm run test:cms`, `npm run test:seo`, `npm run test:content-copilot` separately. Record PASS/FAIL/BLOCKED and distinguish baseline failures from regressions.
- [ ] Identify an authorized isolated database/test auth setup without loading production credentials by default. If unavailable, document DB cases NOT_RUN; pure implementation can proceed, but no data rehearsal or acceptance can be claimed.
- [ ] Review checkpoint: baseline has exact file owners and an executable test command for each owner. Record unresolved deployed linkage as a release blocker, not a reason to assume local equals production. Commit checkpoint if authorized: `docs: record blog CMS implementation baseline`.

## Task 2: Define category, presentation and persistence contracts

**Files:** Create shared `types.ts`, `validation.ts`, `presentation.ts`, `src/lib/blog/presentation.test.ts`, proposed migration, and `src/lib/neon/blog-schema.integration.test.ts`.

**Interfaces:** Define these shared contracts in `types.ts`:

```ts
type Scope = { kind: 'main' } | { kind: 'category'; categoryId: string };
type PageCopy = { heading: string; introduction: string; seoTitle: string | null; seoDescription: string | null };
type BlogCategory = PageCopy & { id: string; key: string; name: string; navigationOrder: number; hidden: boolean; version: number };
type ArticleSummary = { id: string; slug: string; title: string; excerpt: string | null; categoryId: string | null; published: boolean; publishedAt: string | null; createdAt: string; coverImage: string | null; coverAlt: string | null };
type BlogSettings = PageCopy & { scope: Scope; featuredIds: string[]; version: number };
type ArticlePage = { items: ArticleSummary[]; total: number; page: number; pageSize: number };
type ArticleQuery = { search: string; categoryId?: string; state: 'all' | 'draft' | 'published'; page: number; pageSize: number };
```

Produces `validateCategoryKey(value: string): string` and `selectBlogArticles(scope: Scope, featuredIds: string[], articles: ArticleSummary[]): { featured: ArticleSummary[]; regular: ArticleSummary[] }`.

- [ ] Write `presentation.test.ts` cases asserting key `成交分析` remains exact, duplicate feature IDs are rejected, main/category selections differ independently, drafts/wrong-category articles are excluded, and featured IDs never appear in regular results. Assert date-desc/null-last ordering then createdAt-desc/id-asc tie-breakers.
- [ ] Run `bun test src/lib/blog/presentation.test.ts`; expect missing implementation failures, not unrelated runner failures.
- [ ] Implement contracts/rules. Treat query input as already decoded by the router. New keys reject empty/control characters and URL delimiters; legacy keys are preserved by explicit inventory mapping, never normalized destructively.
- [ ] Add additive schema: categories, main/category settings scopes and ordered feature relationships; unique keys/slugs, unique membership and position per scope, foreign keys, positive integer versions. Extend articles with category identity, format marker, cover alt, supplemental links, slug lock and version. All imported existing rows have locked slugs; new drafts lock on first publish. Keep legacy fields for compatibility during rollout, with only one authoritative writer.
- [ ] Write isolated schema tests asserting duplicate keys/membership fail, references cannot dangle and additive migration preserves preexisting article rows. Require explicit test target and refuse unknown/shared targets.
- [ ] Run pure tests; run `bun test --no-env-file src/lib/neon/blog-schema.integration.test.ts` only against the approved isolated target. Record actual execution versus NOT_RUN. Review checkpoint: `feat(blog): add category and presentation contracts`.

## Task 3: Preserve and safely edit article bodies

**Files:** Create `content.ts`, `content.test.ts`, `ArticleBody.tsx`, `src/components/blog/ArticleBody.test.tsx`; modify `package.json` only for selected compatible dependencies.

**Interfaces:** Extend shared types with `ArticleBody = { format: 'legacy-text'; text: string } | { format: 'editor-json-v1'; document: unknown }`, `SupplementalLink = { href: string; label: string }`, and `ArticleRecord = ArticleSummary & { body: ArticleBody; links: SupplementalLink[]; readingMinutes: number; seoTitle: string | null; seoDescription: string | null; version: number; slugLocked: boolean }`. Produce `convertLegacyBody(input: string | readonly string[]): ArticleBody`, `validateArticleBody(body: ArticleBody): ArticleBody`, and React `ArticleBody({ body, links }: { body: ArticleBody; links: SupplementalLink[] })`.

- [ ] Write content tests: array/string paragraphs preserve order/text; headings/lists/links/images survive editor round-trip; supplementary links remain; script nodes, event attributes and unsafe URL protocols cannot execute. Assert null dates are unaffected by body conversion.
- [ ] Run `bun test src/lib/blog/content.test.ts`; expect failures for missing converter/validator.
- [ ] Verify maintained editor compatibility using current official documentation and the authoritative lockfile. Choose one schema-based editor, record its exact version/JSON schema in the baseline and use that same validated schema for server validation and public rendering. Do not infer that arbitrary JSON/HTML is safe.
- [ ] Implement converter, strict node/attribute allowlists and safe renderer. Preserve legacy text literally; introduce rich formatting only through explicit conversion. If the inventory contains a different format, add a lossless tested converter before importing it or mark that record unresolved.
- [ ] Run converter and component tests with `bun test src/lib/blog/content.test.ts src/components/blog/ArticleBody.test.tsx`; pass requires semantic text/link/media preservation and absence of executable content. Review checkpoint: `feat(blog): add safe article content editing format`.

## Task 4: Add authorized repository operations and publication invariants

**Files:** Create `blog-repository.server.ts`, `src/lib/neon/blog-repository.integration.test.ts`; modify existing admin-data wrappers/types/server and generic CMS article writer identified in Task 1.

**Interfaces:** `ArticleInput` is the editable fields of `ArticleRecord` excluding id/version/slugLocked/createdAt. Add `SaveArticleCommand = { id?: string; expectedVersion?: number; input: ArticleInput; action: 'save' | 'publish' | 'unpublish'; requestId: string }`. Produce server functions `listBlogArticles(query: ArticleQuery, actor: StaffAccess): Promise<ArticlePage>`, `saveBlogArticle(command: SaveArticleCommand, actor: StaffAccess): Promise<ArticleRecord>`, `saveBlogSettings(input: BlogSettings, actor: StaffAccess): Promise<BlogSettings>`, `saveBlogCategory(input: Omit<BlogCategory,'id'> & { id?: string }, actor: StaffAccess): Promise<BlogCategory>`, `getBlogAdminState(actor: StaffAccess): Promise<{categories: BlogCategory[]; settings: BlogSettings[]}>`, `getArticlePreview(id: string, actor: StaffAccess): Promise<ArticleRecord>`. Import the existing `StaffAccess` type; do not redefine it. New categories use version 0, new articles omit expectedVersion; updates require the returned version.

- [ ] Write integration tests for admin/manager versus denied agent/anonymous access using actual server wrappers, spoofed client roles, locked slugs, stale versions, page 3 of 101 articles, search/category/state counts, and duplicate requestId replay returning the original save result.
- [ ] Add transactional race tests: unpublish/reassignment concurrent with feature save; two reorder saves with the same version; first publish competing with slug update. Assert exactly one consistent outcome, no stale publication eligibility, and rejected stale writes.
- [ ] Run `bun test --no-env-file src/lib/neon/blog-repository.integration.test.ts` against the isolated target; first run must fail on missing behavior.
- [ ] Implement parameterized queries, strict Zod wrappers, current server-side permission policy, atomic version increments and stable pagination (default 25, maximum 100). Persist publication action explicitly; save on draft never publishes, save on published stays published. Preserve dates unless explicitly edited; assign first publication time only for a newly published article with no date, never during import.
- [ ] Lock scope/article rows in a consistent order when validating and replacing placements; prune affected memberships transactionally on unpublish/reassignment, bump affected settings versions, and write existing audit/revision records. Retryable request IDs prevent duplicate creates after network uncertainty. Migrate all alternative article writers/restores to these invariants or reject unsupported mutation paths explicitly; do not leave a bypass.
- [ ] Use existing authenticated wrapper/header conventions; private preview uses no-store/noindex and never public caching. Return typed conflict/validation/unavailable errors. Run new DB tests plus `npm run test:cms` and `npm run test:content-copilot`. Review checkpoint: `feat(cms): enforce blog editing and publishing invariants`.

## Task 5: Build repeatable content reconciliation and import

**Files:** Create `reconcile.ts`, `reconcile.test.ts`, three `scripts/blog-cms/` entry points, `src/lib/neon/blog-import.integration.test.ts` and sanitized fixture inputs.

**Interfaces:** Define `InventoryArticle = { source: 'database' | 'registry' | 'public'; article: ArticleRecord; url: string; fingerprint: string }`, `Inventory = { articles: InventoryArticle[]; completeSources: string[]; unresolvedSources: string[]; settings: BlogSettings[]; categories: BlogCategory[]; sourceRevision: string; targetIdentity: string }`, `ImportPlan = { fingerprint: string; inventory: Inventory; insert: ArticleRecord[]; conflicts: { slug: string; reason: string }[]; unresolved: string[] }`. Imported registry/public records use deterministic temporary IDs until insertion; manifest maps them to returned database IDs. Produce `buildImportPlan(inventory: Inventory): ImportPlan` and `applyImport(plan: ImportPlan, target: VerifiedImportTarget): Promise<ImportReceipt>`; define `VerifiedImportTarget` from explicitly checked identity and authorization context, and `ImportReceipt` with plan fingerprint, target identity, inserted IDs/fingerprints and counts.

- [ ] Write fixture tests asserting a database draft wins over a published registry copy but creates a blocking conflict, missing sources block completeness, missing text/date is never fabricated, and identical source inputs produce identical fingerprints. Preserve exact slugs, category keys, links and media.
- [ ] Run `bun test src/lib/blog/reconcile.test.ts`; expect missing implementation failures.
- [ ] Implement read-only reconciliation as the default. CLI takes explicit snapshot files/target identity; it must not load a default production connection. Snapshot extraction includes all database rows with pagination/count checks, registry entries, known public URLs/sitemap and approved copy. Public content with unresolvable body/metadata remains unresolved. Save a sanitized summary; private bodies/backups remain untracked.
- [ ] Implement approved insert-only import with explicit apply flag, matching target/manifest fingerprint, backup receipt, and transaction/checkpoint tracking. Populate normalized category/settings references for existing DB records only after version checks; preserve editorial content/state. A second run verifies receipts and never overwrites an intervening editor change.
- [ ] Write/run `bun test --no-env-file src/lib/neon/blog-import.integration.test.ts`: repeat import makes zero duplicate writes; changed source/version invalidates manifest; interrupted checkpoint resumes; existing drafts remain drafts; all inserted articles have locked original slugs. Run pure reconciliation tests again.
- [ ] Review checkpoint: complete dry-run accounting with unresolved records explicitly blocking activation. `feat(blog): add reconciled article import tooling`.

## Task 6: Extend the existing CMS UI

**Files:** Create five admin/blog components from the map plus `src/components/admin/blog/BlogManager.test.tsx`; modify `admin.cms.tsx` and admin wrappers to expose Task 4 operations.

**Interfaces:** `BlogManager` owns list/query/editor state and consumes the Task 4 wrapper contracts; editor props use `ArticleRecord`, `BlogCategory`, `BlogSettings` and async `onSave` callbacks returning the saved record/version. `FeaturedArticlesEditor` returns ordered IDs only, validated again server-side. Article preview renders Task 3's component through authenticated access.

- [ ] Write behavior tests: find/edit the 101st article; filter and return to page 1; save draft; explicit publish/unpublish; stale save preserves typed text; failed refresh after successful save retains saved id/version; dirty close warns; existing slug cannot be edited; feature picker rejects wrong-category/draft articles.
- [ ] Run `bun test src/components/admin/blog/BlogManager.test.tsx`; expect missing component/behavior failures.
- [ ] Add internal Articles/Blog Settings/Categories navigation under the existing Articles entry; preserve other tabs. Add category and article search, counts and pagination. Wire the selected rich editor, media picker/alt text, metadata, authenticated preview and unsaved-change guard.
- [ ] Implement independent main/category forms and keyboard-operable feature ordering. Category rename does not edit key; hiding explains the URL remains accessible. Show affected featured placements before unpublish/reassignment. Use clear zh-HK actions for save-draft, publish, update-published and confirmed unpublish.
- [ ] Reuse existing media permissions and upload pipeline; verify article-owned uploads do not accidentally grant public access to draft body previews. Render upload errors without discarding edits.
- [ ] Run component tests and `npm run test:cms`; manually exercise keyboard focus/errors, a narrow viewport, and reload persistence in the authorized local/preview environment. Review checkpoint: `feat(cms): add blog settings and complete article management`.

## Task 7: Connect public routes without content resurrection

**Files:** Modify public-data wrappers/types/server, queries, both blog routes, existing sitemap/cache owners recorded in Task 1; create `src/lib/blog/public.integration.test.ts`, update `src/routes/blog.routes.test.mjs`.

**Interfaces:** Produce `getPublicBlogPage(input: { categoryKey?: string; page: number }): Promise<{ settings: BlogSettings; categories: BlogCategory[]; featured: ArticleSummary[]; articles: ArticlePage } | null>` and `getPublicBlogArticle(slug: string): Promise<ArticleRecord | null>`. Missing category/article returns null; DB failure throws a typed unavailable error. Public SQL itself filters published state. Main and category regular lists use stable pagination, excluding all eligible featured IDs before count/pagination; features display on page 1 only.

- [ ] Write tests for exact `成交分析` selection, encoded versus decoded router inputs, malformed queries, known-empty/unknown categories, hidden-but-addressable category, independent headings/intro, ordered features without duplicate cards, and pagination without missing/duplicated articles.
- [ ] Add tests for unpublished registry-backed article returning not-found, DB outage returning unavailable rather than empty/registry data, no preview cache leakage, saved SEO overrides, and sitemap removal after unpublish.
- [ ] Run `bun test --no-env-file src/lib/blog/public.integration.test.ts` in isolation plus `npm run test:blog`; verify failures target missing new behavior.
- [ ] Implement route search validation, data wrappers, safe body renderer and settings-driven copy. Remove runtime blog registry fallbacks from list and detail, including upstream query catches that hide DB errors. Leave registry data as import/recovery reference only. Preserve exact `/blog/<slug>` route structure, existing canonical policy, stable category URLs and unknown category not-found handling.
- [ ] Implement publication-aware cache invalidation in the actual owners from Task 1, covering article/main/old-and-new-category/sitemap outputs. If fresh reads replace caching, document response policy and verify it. Do not acknowledge a stale public view as complete publication; surface invalidation failures with a retryable recovery path.
- [ ] Run public integration, blog and SEO suites. Verify no public draft fields leak and metadata is escaped. Keep this renderer undeployed until Task 9's reconciliation gate passes. Review checkpoint: `feat(blog): render CMS settings and publication-safe content`.

## Task 8: Integrated acceptance and regression review

**Files:** Create `src/lib/blog/cms-acceptance.integration.test.ts`, `docs/superpowers/evidence/blog-cms/acceptance.md`; modify `package.json` to add `test:blog-cms` (explicit pure/component files from Tasks 2/3/5/6) and `test:blog-cms:db` (explicit isolated DB files from Tasks 2/4/5/7/8, using `bun test --no-env-file`).

**Interfaces:** Consumes the complete importer, admin and public contracts; produces a receipt keyed by source revision, target identity and manifest fingerprint with PASS/FAIL/BLOCKED/NOT_RUN per evidence layer.

- [ ] Write end-to-end integration fixtures: import existing text/rich articles plus supplemental links, edit in CMS, save/reload, feature independently, rename category, unpublish, repeat import and verify unchanged URLs/content/private state. Include 101 articles, two concurrent editors and failed read/save/refresh boundaries.
- [ ] Run `npm run test:blog-cms` and the authorized isolated `npm run test:blog-cms:db`. Assert every imported slug resolves to the same URL and approved publication outcome; all are editable, including drafts.
- [ ] Run `npm run test:blog`, `npm run test:cms`, `npm run test:seo`, `npm run test:content-copilot`, `npx tsc --noEmit`, `npm run lint`, and `npm run build`. Record baseline versus new failures; do not supply production secrets to make a build pass.
- [ ] Complete signed-in CMS/public-browser acceptance on an authorized preview: upload/edit body/alt/SEO, feature reorder, category rename/hide, unpublish, stale editor conflict, keyboard and narrow-screen usage. Verify rendered text, not only source patterns.
- [ ] Perform whole-change review, including all alternate mutation paths, inventory completeness, cache behavior and proposed recovery. Fix new issues with focused regression tests. Review checkpoint: `test(blog): verify complete CMS editing and URL preservation`.

## Task 9: Prepare gated cutover and recovery package

**Files:** Create `docs/superpowers/evidence/blog-cms/cutover.md`; use `verify-manifest.ts` from Task 5. No live action is part of plan preparation or automatic implementation completion.

**Interfaces:** Produces a reviewable release package binding candidate revision/artifact, verified target, complete manifest fingerprint, backup/import receipts, rehearsal results, editorial pause method, invalidation behavior and recovery procedure.

- [ ] Test `verify-manifest.ts` against changed database versions, added public URLs, missing inventory sources and mismatched target/revision; each must reject activation, not silently recalculate an approved fingerprint.
- [ ] Rehearse in isolation: pause writes via the actual deployment access mechanism, capture final inventory, import, activate renderer, invalidate caches, verify every URL and CMS record, then reopen editing. Simulate post-import edits and show targeted recovery preserves them and unpublished state.
- [ ] Document exact live steps and target-specific commands from the successful rehearsal. Specify who controls the editorial pause, how every article writer is blocked, and checks proving it. If reliable write pausing is unavailable, leave cutover BLOCKED until it is provided; no assumed maintenance toggle.
- [ ] Prepare final source/diff and evidence summary. Request separate approval only when an exact revision, target, migration/import manifest and deployment action are reviewable. Until then: no hosted writes, push, merge or deployment.
- [ ] After explicit release authorization only: repeat fresh inventory under write pause; reject changed fingerprints pending reconciliation; back up, apply approved schema/import, activate exact artifact and verify all URLs, CMS editing and publication/cache results before reopening edits. Never roll back to fallback-resurrecting code. If recovery cannot preserve newer edits, use temporary unavailability and forward repair.
- [ ] Store sanitized release/recovery receipts; do not mark production accepted from rehearsal alone. Review checkpoint: `docs(blog): record cutover and acceptance evidence` if authorized.

## Self-review and handoff

Coverage: Tasks 2/4/6 cover editable settings/categories/placements and authorization; Task 3 covers safe rich content and media/links; Task 5 covers all existing content, conflict accounting and repeatability; Task 7 covers stable URLs, visibility, metadata/sitemap and failures; Tasks 8/9 cover full regression, hosted boundaries and recovery. All five Review Focus cases are assigned explicit tests. Shared types and signatures are defined before consuming tasks.

Task dependencies: 1 → 2 → 3 → 4 → 5/6 → 7 → 8 → 9. Tasks 5 and 6 may proceed separately after Task 4; keep shared contract changes coordinated. This is one integrated CMS feature, not independently deployable subsystems.

Recommended execution: subagent-driven with per-task review, because data preservation and alternate publishing paths benefit from independent checks before public rendering changes. Native execution is also possible with final independent review. User review and execution-method selection precede implementation; production authorization is separate.

Plan-only status: no application edits, dependencies, database operations or tests have been executed for this feature. Commands above are future verification steps, not reported passes. Design approval is recorded in the companion spec.
