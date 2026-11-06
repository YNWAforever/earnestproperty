# EarnestProperty blog CMS extension

Date: 2026-11-05
Status: Approved by the user, including the proposed defaults, on 2026-11-05. Local subagent-driven implementation authorized by the user on 2026-11-05. Push, merge, deployment and production database changes require separate approval.

Provenance update (Task9, 2026-11-05): the preceding authorization sentence records the planning-time decision. The later controller instructions govern this managed worktree: native execution, **no subagents or commits**, and no push/merge/deploy/production DB or provider actions. Tasks1–8 are reviewed complete per the controller. Task9 prepares a package only; independent task review and final whole-change review are separate.

## Intent and agreed scope

Use the existing `/admin/cms?tab=articles` CMS to manage all blog articles and presentation. Staff must be able to edit existing articles as well as create new ones. The main `/blog` page and each category, including `/blog?category=成交分析`, have separate editable headings, introductions, and featured selections. Preserve every existing article URL.

The user selected a focused extension of the existing CMS. This is a moderate project spanning editorial controls, content reconciliation, public rendering, and publishing behavior.

## Approaches considered

1. **Extend the existing CMS — selected.** Reuse the article editor and staff authentication; add blog settings, category management, and ordered featured selections. Preserves the current public design and avoids duplicate content systems.
2. **Flexible page builder — not selected.** Allows arbitrary layouts and sections but adds editor and rendering complexity beyond the requested scope.

## Planning-time evidence and its limits (historical)

The following observations were recorded during initial design in `C:/Users/laich/Documents/Earnestproperty/Earnestproperty`. They are retained as provenance, **not descriptions of the current implementation**:

- `src/routes/admin.cms.tsx`: existing Articles editor, fields for title, slug, excerpt, content, cover image, category, reading time, publication state/date and SEO; current list cap of 40 articles.
- `src/lib/neon/admin-data.server.ts`: `saveAdminArticle` writes the `articles` table.
- `src/lib/neon/public-data.server.ts`: public list/detail reads published articles from that table.
- `src/routes/blog.tsx` and `src/routes/blog_.$slug.tsx`: code-defined fallback articles are used when database content is absent or reads fail. Detail metadata currently uses title/excerpt in the inspected copy.
- The public blog retrieved during this conversation displays categories, including 成交分析. Its presentation differs from the inspected local source. The signed-in production CMS was not inspected.

Those observations established a feasible extension path, not proof of the deployed revision or database contents. The subsequent [baseline](../evidence/blog-cms/baseline.md) identifies the managed `earnest-blog-cms/Earnestproperty` checkout at base `8b49d0a21c867c401c4d41db393e43c8db76a74d`: the revision-aware owner is `admin-cms.ts` / `admin-cms.server.ts` / `cms_mutate`, rather than the historical `saveAdminArticle` claim. Tasks1–8 add paginated blog administration and database-only public rendering. Current local evidence and its source/build binding are in [acceptance](../evidence/blog-cms/acceptance.md), including the latest fix1 supplement; [Task9 cutover](../evidence/blog-cms/cutover.md) records the refreshed package binding and remaining gates. Real database inventory remains unknown. A failed read is not evidence of an empty collection.

## Goals, non-goals and failure conditions

Goals: one editable article collection; separate main/category presentation; reliable publishing; stable article URLs and existing category links; all content discoverable in the admin.

Non-goals: arbitrary page building, site-wide redesign, multilingual editing, automated writing, scheduled publishing, approval workflows, or changes to property listings and collection jobs.

Failure conditions: losing or duplicating existing articles; silently overwriting newer CMS edits; changing existing article URLs; draft content becoming public; unpublishing revealing a fallback copy; treating an unavailable database as empty; hiding articles beyond the current 40-row admin cap.

## CMS behavior

Keep the existing CMS entry point and Articles editor. Within the blog management area expose three clearly named functions: Articles, Blog Settings, and Categories. Exact tabs/subnavigation are a builder decision; preserve `?tab=articles` as a working entry point.

### Articles

- Paginated, server-filtered list across the complete collection, with title/category search and category/publication filters. Display result counts and current page; never imply a capped subset is the whole collection.
- Edit title, excerpt, full body, cover image and its alternative text, category, reading time, publication date, SEO title/description and draft/published state.
- Support headings, paragraphs, lists, links and images in a straightforward editor with preview. The builder may select a maintained editor compatible with the existing app. Convert existing body formats without changing their visible meaning; sanitize all rendered rich content. Do not render arbitrary stored HTML unsafely.
- Preserve article-specific links and media from existing content, including links currently supplied separately by the fallback registry.
- Existing article slugs are read-only. New slugs are validated for uniqueness and URL safety before creation, and become fixed after first publication. Slug changes/redirect management are outside this scope.
- Saving a draft keeps it private; an explicit Publish action publishes it. Saving an already published article updates the public article after successful persistence and cache invalidation. Label this action clearly. Unpublish is explicit and confirmed, removes public access, and does not delete the record.
- Use a version/updated-at check to reject stale concurrent edits with a useful reload/reconcile message. Keep unsaved-change protection and report failures without closing the editor.
- Preview uses authenticated access and is excluded from public caches/indexing; draft previews must not leak through public endpoints.

### Main blog settings

Editable heading, introduction, SEO title/description, and an ordered featured-article selection. Seed settings with the current approved public copy so activation does not unexpectedly rewrite the site.

The main feature picker can select any published article. Selection order controls display order. Featured articles appear once on that page: first in a featured area, then excluded from the ordinary list. Ordinary articles sort by publication date descending with a stable tie-breaker. With no featured selections, omit that area.

### Categories

Each category has a stable internal ID, display name, stable public query key, navigation order, its own heading/introduction, SEO fields, and ordered featured selections. Each article has one category for compatibility with the current model; uncategorized articles appear on the main blog only.

Preserve current query keys exactly, including `成交分析`. Renaming a category changes its display name but not its query key or existing links. New categories receive unique keys. Use explicit validation for duplicates and invalid values.

Category feature pickers offer only published articles in that category. Reassignment or unpublishing removes the article from affected visible feature selections; warn about affected placements when saving. The public read also checks eligibility, so stale references cannot leak content. Do not fill empty slots with unrelated articles.

Allow creating, editing and ordering categories. Avoid hard deletion in this scope: allow hiding a category from navigation while retaining its URL and articles. Hiding is not unpublishing; explain this in the CMS. Unknown category keys return a clear category-not-found state, rather than silently showing all posts. Known empty categories show their heading/introduction and an honest empty state.

Settings changes apply on explicit Save, with unsaved-change protection and version checks. A saved category heading or introduction overrides the main settings for that category; when blank, use the category display name and no introduction. Main and category featured selections are independent.

## Content model and application boundaries

Keep the existing articles table as the article source of truth. Add normalized category identity and category presentation settings, one main-blog settings record, and ordered feature relationships scoped to main blog or a category. Use unique constraints for article slug, category key and duplicate feature membership; enforce consistent ordering and referential integrity.

Adapt the legacy article category text field during migration; do not leave two independently editable category sources. Add an explicit body-format marker or equivalent safe conversion strategy for legacy text and new rich content. Preserve excerpts, cover media, dates, SEO data and supplemental links.

Use existing TanStack server-function boundaries and Neon data access. Staff authorization must be enforced server-side for article edits, settings, categories, feature changes, preview and media operations. Reuse the established CMS permission policy from the authoritative revision; do not widen staff permissions as part of this change. Public reads return published content and public settings only.

Record editorial changes using the existing audit/revision facilities where available. Public rendering consumes the same normalized category/settings data as the CMS. Apply cache invalidation to article detail, main list and affected category pages after successful saves, publishing and unpublishing. If no cache is present, document and verify fresh reads instead.

## Existing content reconciliation and cutover

1. Establish the deployed revision and authorized target environment. Inventory database articles, code-defined articles, public URLs/sitemap entries and category keys. Include published and draft database records. Report missing sources and inaccessible records as unresolved, not absent.
2. Produce a read-only reconciliation manifest keyed by exact existing slug/URL. Include source identity, content fingerprint, category, publication state, media/supplemental links and proposed disposition. Count every existing article and category.
3. Existing database records are authoritative for their current content and publication state. Never overwrite them automatically with a code copy. A code/public copy conflicting with a draft or unpublished database record requires an explicit disposition; do not republish automatically. Flag conflicting public/database/code content for review before cutover.
4. Import missing approved code-only/public articles into the CMS with their exact slugs, preserving body, links, media, metadata and dates. Do not invent article text or dates when sources are unavailable. Populate category mappings and settings from the approved inventory. Preserve all existing drafts.
5. Use a repeatable, transactional or checkpointed import with uniqueness constraints, dry-run output and a backup of affected data. A repeated import must not duplicate records or overwrite subsequent editor changes. Record inserted IDs and fingerprints for reconciliation and recovery.
6. Validate the complete URL/content manifest in an isolated environment. Every inventoried article must have an editable CMS record, with public visibility matching the approved publication state. Validate category membership and presentation separately.
7. Activate database-backed article/settings reads only after reconciliation passes. Remove runtime article fallbacks from both list and detail paths; retain reference copies for recovery only. A database outage becomes an explicit temporary-unavailable response, not an empty list or fallback content. A missing/unpublished article returns the site's normal not-found response.
8. For live cutover, briefly pause editorial writes, capture a fresh inventory/version snapshot, reconcile any changes since rehearsal, then import/activate/invalidate caches and verify before reopening editing. If the pause or final reconciliation fails, defer cutover. Deployment and production writes require separate task-specific approval.

Recovery must preserve post-import edits and unpublished states. Use recorded IDs/versions and backups for targeted recovery; never blindly restore older rows over newer edits. Do not roll back to a renderer that resurrects fallback articles. If safe content recovery cannot be established, show temporary unavailability while repairing the forward path.

## Public behavior and metadata

`/blog` renders its own settings, ordered featured articles and the remaining published collection. `/blog?category=<existing-key>` renders only that category's settings and eligible published articles. Article details keep their existing `/blog/<slug>` URLs.

Use saved SEO fields when present, with sensible title/excerpt fallbacks. Preserve the deployed canonical/indexing policy after verifying it rather than changing category indexing inadvertently. Escape metadata and render safe article content. Update sitemap publication membership consistently with publish/unpublish, following the existing sitemap mechanism.

## Acceptance criteria

- Every reconciled existing article is findable and editable in the CMS, including records beyond 40; existing URLs remain unchanged.
- A text/body/media edit survives reload and appears on the correct public article. SEO overrides are reflected in metadata.
- Main heading/introduction changes do not alter category settings; two category settings can be changed independently.
- Category rename keeps its original query URL working. Navigation ordering and hiding work without removing article URLs.
- Featured order is preserved; main/category selections are independent; no duplicate cards appear in a page's list. Wrong-category/draft selections are rejected server-side.
- Unpublishing removes detail/list/category/featured/sitemap visibility and never resurrects code content, including when the article also existed in the old registry.
- Migration dry-run accounts for all sources; a second run creates no duplicates and does not overwrite an intervening CMS edit. Conflicts block activation.
- Drafts and authenticated previews remain private. Unauthorized writes and stale concurrent saves fail safely.
- Database failures display an error/unavailable state rather than a successful empty state. Cache invalidation prevents stale publication state from remaining visible under the documented cache policy.
- Keyboard and narrow-screen editing are usable, fields have clear labels, errors preserve edits, and destructive publication actions are understandable.

Test pure validation and rendering decisions with focused automated tests; exercise import idempotency, publication permissions, stale writes and read/write integration against an isolated database. Validate the complete URL manifest and perform signed-in editor/public-browser checks in an authorized preview. Keep local, isolated, preview and production results separate; source tests alone do not establish hosted acceptance.

## Proposed defaults and builder discretion

The user explicitly agreed to existing CMS reuse, all existing articles being editable, stable article URLs, and separate main/category settings. The editor format, one category per article, independent ordered feature selections without duplicate cards, fixed existing slugs, category hiding instead of deletion, immediate updates to published articles on Save, and no scheduling/review workflow are design recommendations for approval rather than previously stated user requirements.

Builder discretion: exact CMS navigation layout, compatible editor library, schema/table names, page size, transaction implementation, responsive feature layout and focused test organization. These must satisfy the behavior and preservation guarantees above.

## Planning-time delivery boundary and current handoff

At initial design delivery, this file was saved in a writable project workspace while the authoritative application checkout was unconfirmed; no product code, data, deployment or Git history had been changed at that time. That was a planning boundary, not a statement about the later implementation. The approved design now accompanies the uncommitted Tasks1–9 candidate in `C:/Users/laich/.codex/worktrees/earnest-blog-cms/Earnestproperty`; local source/build/owned-DB/HTTP evidence supersedes those planning prerequisites. Synced `sources/` remain outside the task. Hosted acceptance, complete real inventory, a reliable all-writer pause, the production adapter and exact live target/action remain unestablished. Follow the cutover package gates; no release approval is requested while those particulars are unknown.
