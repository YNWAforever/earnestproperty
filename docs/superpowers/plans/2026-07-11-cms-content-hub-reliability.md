# CMS Content Hub Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic admin CMS with a reliable Content Hub where estates, articles, videos, FAQs, and media use Draft -> Preview -> Publish, server-authorized publishing, and version restore.

**Architecture:** Keep existing canonical Neon tables as the public source of truth. Add an append-only `cms_content_revisions` layer for drafts and versions, then project a validated published revision to the canonical table inside a transaction. Split `/admin/cms` into independent hub, category, editor, revision, and recovery modules so one category failure cannot break the rest of CMS.

**Tech Stack:** TanStack Start, React 19, TypeScript, Neon Serverless SQL, Neon Auth, Zod, shadcn/Radix, Node test runner, Vite.

## Global Constraints

- Work only in an isolated worktree; never modify the user's dirty primary checkout.
- Canonical `estates`, `articles`, `faqs`, `cms_videos`, and `media_assets` rows remain the public-route source of truth.
- A draft is never returned by a public Neon read helper.
- `admin` and `manager` publish, restore, and archive; `agent` saves drafts only.
- Publish and restore enforce roles and validation on the server, never in client code alone.
- Keep the latest 20 full revision snapshots per resource; preserve audit metadata for all historical actions.
- Use explicit Save with seven-day per-user browser-local recovery; no background database autosave.
- Every category owns its own loading, empty, unavailable, retry, and mutation-error state.
- Do not hard-delete published content or referenced media.
- Preserve the existing Chinese public and admin copy unless this plan explicitly adds a label.

---

## File Structure

- Create: `neon/migrations/20260711090000_cms_content_revisions.sql` - revision table, indexes, backfill, and retention helper.
- Create: `src/lib/neon/cms-revisions.ts` - pure lifecycle, role, and restore helpers.
- Create: `src/lib/neon/cms-revisions.test.mjs` - lifecycle unit tests.
- Create: `src/lib/neon/admin-cms.types.ts` - hub rows, revision records, filters, editor inputs, conflicts, and preview contracts.
- Create: `src/lib/neon/admin-cms.server.ts` - Neon read, draft save, publish, restore, archive, and projection functions.
- Create: `src/lib/neon/admin-cms.ts` - browser-safe `createServerFn` wrappers.
- Create: `src/lib/neon/admin-cms.contract.test.mjs` - route/server wrapper and public-isolation contract checks.
- Create: `src/components/admin/cms/CmsContentHub.tsx` - overview, saved views, search, and category shortcuts.
- Create: `src/components/admin/cms/CmsCategoryTable.tsx` - independent category list states and row actions.
- Create: `src/components/admin/cms/CmsEditorShell.tsx` - sticky save/preview/publish controls and validation panel.
- Create: `src/components/admin/cms/CmsRevisionPanel.tsx` - version timeline, comparison, and restore controls.
- Create: `src/components/admin/cms/useCmsDraftRecovery.ts` - seven-day local recovery hook.
- Create: `src/routes/admin.cms.$type.tsx` - category route for `estates`, `articles`, `videos`, `faqs`, and `media`.
- Create: `src/routes/admin.cms.$type_.$id.tsx` - create/edit route with protected staff preview.
- Modify: `src/routes/admin.cms.tsx` - replace the 1,537-line tab workspace with the Content Hub route shell.
- Modify: `src/lib/neon/admin-data.ts` and `src/lib/neon/admin-data.server.ts` - keep compatibility exports as delegates while callers move.
- Modify: `src/lib/neon/public-data.server.ts` and `src/lib/neon/public-data.ts` - add published-revision isolation assertions without exposing drafts.
- Modify: `src/routes/admin.routes.test.mjs` and `src/config/site.test.mjs` - register new routes and preserve public CMS safety checks.

## Shared Interfaces

```ts
export const CMS_RESOURCE_TYPES = ["estate", "article", "video", "faq", "media"] as const;
export type CmsResourceType = (typeof CMS_RESOURCE_TYPES)[number];
export type CmsRevisionState = "draft" | "published" | "superseded" | "archived";

export type CmsDraftSaveInput = {
  resourceType: CmsResourceType;
  resourceId: string;
  basePublishedVersion: number | null;
  payload: Record<string, unknown>;
};

export type CmsPublishInput = {
  revisionId: string;
  expectedPublishedVersion: number | null;
};

export type CmsRevisionConflict = {
  code: "CMS_REVISION_CONFLICT";
  currentPublishedVersion: number;
  currentRevisionId: string;
};
```

---

### Task 1: Add the Revision Schema and Pure Lifecycle Rules

**Files:**
- Create: `neon/migrations/20260711090000_cms_content_revisions.sql`
- Create: `src/lib/neon/cms-revisions.ts`
- Create: `src/lib/neon/cms-revisions.test.mjs`

**Interfaces:**
- Produces: `CmsResourceType`, `CmsRevisionState`, `canPublishCmsRevision`, `nextCmsVersion`, and `makeRestoreDraft`.
- Consumes: existing `staff_role` values from `neon/migrations/20260623090000_neon_admin_crm_whatsapp.sql`.

- [ ] **Step 1: Write failing lifecycle tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  canPublishCmsRevision,
  makeRestoreDraft,
  nextCmsVersion,
} from "./cms-revisions.ts";

test("only admin and manager can publish or restore CMS revisions", () => {
  assert.equal(canPublishCmsRevision(["admin"]), true);
  assert.equal(canPublishCmsRevision(["manager"]), true);
  assert.equal(canPublishCmsRevision(["agent"]), false);
});

test("nextCmsVersion increments from the latest revision", () => {
  assert.equal(nextCmsVersion([]), 1);
  assert.equal(nextCmsVersion([{ version_number: 7 }]), 8);
});

test("restore creates a new draft without rewriting the source revision", () => {
  const restored = makeRestoreDraft({
    id: "old", resource_type: "estate", resource_id: "estate-1",
    version_number: 4, payload: { name_zh: "麗都花園" },
  });
  assert.deepEqual(restored, {
    resourceType: "estate", resourceId: "estate-1", basePublishedVersion: 4,
    payload: { name_zh: "麗都花園" }, restoredFromRevisionId: "old",
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/lib/neon/cms-revisions.test.mjs`

Expected: FAIL because `cms-revisions.ts` does not exist.

- [ ] **Step 3: Add the migration and minimal pure module**

```sql
CREATE TABLE IF NOT EXISTS cms_content_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type text NOT NULL CHECK (resource_type IN ('estate','article','video','faq','media')),
  resource_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  state text NOT NULL CHECK (state IN ('draft','published','superseded','archived')),
  payload jsonb NOT NULL,
  validation_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  base_published_version integer,
  created_by uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  restored_from_revision_id uuid REFERENCES cms_content_revisions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (resource_type, resource_id, version_number)
);

CREATE INDEX IF NOT EXISTS cms_content_revisions_resource_idx
  ON cms_content_revisions (resource_type, resource_id, version_number DESC);
CREATE INDEX IF NOT EXISTS cms_content_revisions_state_idx
  ON cms_content_revisions (state, created_at DESC);
```

```ts
export const CMS_RESOURCE_TYPES = ["estate", "article", "video", "faq", "media"] as const;
export type CmsResourceType = (typeof CMS_RESOURCE_TYPES)[number];
export type CmsRevisionState = "draft" | "published" | "superseded" | "archived";

export function canPublishCmsRevision(roles: string[]) {
  return roles.includes("admin") || roles.includes("manager");
}

export function nextCmsVersion(rows: Array<{ version_number: number }>) {
  return (rows[0]?.version_number ?? 0) + 1;
}

export function makeRestoreDraft(revision: {
  id: string; resource_type: CmsResourceType; resource_id: string;
  version_number: number; payload: Record<string, unknown>;
}) {
  return {
    resourceType: revision.resource_type,
    resourceId: revision.resource_id,
    basePublishedVersion: revision.version_number,
    payload: revision.payload,
    restoredFromRevisionId: revision.id,
  };
}
```

- [ ] **Step 4: Add migration backfill statements**

Backfill canonical rows as published version 1 using one `INSERT ... SELECT ... ON CONFLICT DO NOTHING` per source table. Use `to_jsonb(row) - 'created_at' - 'updated_at'` as each payload and preserve the existing UUID as `resource_id`. Add the five statements for `estates`, `articles`, `cms_videos`, `faqs`, and `media_assets`.

- [ ] **Step 5: Run the lifecycle test and migration syntax check**

Run: `node --test src/lib/neon/cms-revisions.test.mjs`

Expected: PASS with 3 tests.

- [ ] **Step 6: Commit**

```bash
git add neon/migrations/20260711090000_cms_content_revisions.sql src/lib/neon/cms-revisions.ts src/lib/neon/cms-revisions.test.mjs
git commit -m "feat: add CMS revision lifecycle"
```

### Task 2: Define CMS Hub Contracts and Server Function Boundaries

**Files:**
- Create: `src/lib/neon/admin-cms.types.ts`
- Create: `src/lib/neon/admin-cms.ts`
- Create: `src/lib/neon/admin-cms.contract.test.mjs`
- Modify: `src/lib/neon/admin-data.contract.test.mjs`

**Interfaces:**
- Consumes: `CmsResourceType` and `CmsRevisionState` from `cms-revisions.ts`.
- Produces: `fetchAdminCmsHub`, `fetchAdminCmsCategory`, `fetchAdminCmsEditor`, `saveAdminCmsDraft`, `publishAdminCmsRevision`, `restoreAdminCmsRevision`, and `archiveAdminCmsResource` wrappers.

- [ ] **Step 1: Write failing wrapper contract tests**

```js
test("admin CMS wrappers expose isolated hub and revision operations", () => {
  const source = read("src/lib/neon/admin-cms.ts");
  for (const name of [
    "fetchAdminCmsHub", "fetchAdminCmsCategory", "fetchAdminCmsEditor",
    "saveAdminCmsDraft", "publishAdminCmsRevision",
    "restoreAdminCmsRevision", "archiveAdminCmsResource",
  ]) assert.match(source, new RegExp(`export const ${name}\\b`));
});
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `node --test src/lib/neon/admin-cms.contract.test.mjs`

Expected: FAIL because `admin-cms.ts` does not exist.

- [ ] **Step 3: Define exact shared types and wrappers**

```ts
export type CmsHubView = "mine" | "ready" | "published";
export type CmsHubRow = {
  resourceType: CmsResourceType; resourceId: string; title: string; slug: string | null;
  state: CmsRevisionState; latestRevisionId: string; latestVersion: number;
  publishedVersion: number | null; updatedAt: string; updatedBy: string | null;
};
export type CmsCategoryResult = { rows: CmsHubRow[]; unavailableReason?: string };
```

```ts
export const fetchAdminCmsHub = createServerFn({ method: "GET" })
  .inputValidator((data: { view: CmsHubView; query?: string }) => data)
  .handler(async ({ data }) => (await import("./admin-cms.server")).fetchAdminCmsHub(data));
export const saveAdminCmsDraft = createServerFn({ method: "POST" })
  .inputValidator((data: CmsDraftSaveInput) => data)
  .handler(async ({ data, request }) => (await import("./admin-cms.server")).saveAdminCmsDraft(data, request));
```

- [ ] **Step 4: Extend the existing compatibility contract**

Keep `fetchAdminCms`, `saveAdminEstate`, `saveAdminArticle`, `saveAdminFaq`, `saveAdminCmsVideo`, and `updateAdminMediaAsset` exported from `admin-data.ts` until their callers migrate. Add assertions that those exports delegate to the new CMS layer rather than duplicate revision logic.

- [ ] **Step 5: Run focused contracts**

Run: `node --test src/lib/neon/admin-cms.contract.test.mjs src/lib/neon/admin-data.contract.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/neon/admin-cms.types.ts src/lib/neon/admin-cms.ts src/lib/neon/admin-cms.contract.test.mjs src/lib/neon/admin-data.contract.test.mjs
git commit -m "feat: define CMS hub contracts"
```

### Task 3: Implement Isolated CMS Reads, Draft Saves, and Role Guards

**Files:**
- Create: `src/lib/neon/admin-cms.server.ts`
- Modify: `src/lib/neon/auth.server.ts`
- Modify: `src/lib/neon/admin-data.server.ts`
- Test: `src/lib/neon/admin-cms.contract.test.mjs`

**Interfaces:**
- Consumes: Task 1 lifecycle helpers and Task 2 contracts.
- Produces: server implementations for all Task 2 wrappers and typed `CMS_REVISION_CONFLICT` responses.

- [ ] **Step 1: Write failing server guard tests**

```js
test("CMS publish and restore require admin or manager roles", () => {
  const source = read("src/lib/neon/admin-cms.server.ts");
  assert.match(source, /requireStaffAccess\(request, \["admin", "manager"\]\)/);
  assert.match(source, /CMS_REVISION_CONFLICT/);
  assert.match(source, /BEGIN/);
  assert.match(source, /COMMIT/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/lib/neon/admin-cms.contract.test.mjs`

Expected: FAIL because `admin-cms.server.ts` does not exist.

- [ ] **Step 3: Implement independent reads**

Implement `fetchAdminCmsHub` as a revision-table query that joins the latest revision per `(resource_type, resource_id)` and filters `mine`, `ready`, and `published`. Implement `fetchAdminCmsCategory` with one resource type per call; wrap only the `cms_videos` query in its existing missing-table handling and return `{ rows: [], unavailableReason }` instead of throwing.

- [ ] **Step 4: Implement draft save with optimistic concurrency metadata**

Use `requireStaffAccess(request, ["admin", "manager", "agent"])`, validate `resourceType`, normalize the type-specific payload, and insert a `draft` revision. For an existing draft, update only its payload and `validation_summary`. Return `{ revisionId, versionNumber, savedAt }`.

- [ ] **Step 5: Preserve legacy calls as delegates**

Change the five CMS mutation implementations in `admin-data.server.ts` to convert their existing typed inputs into `CmsDraftSaveInput` and call `saveAdminCmsDraft`. Do not change non-CMS CRM, WhatsApp, or campaign functions.

- [ ] **Step 6: Run server contracts**

Run: `node --test src/lib/neon/admin-cms.contract.test.mjs src/lib/neon/admin-data.contract.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/neon/admin-cms.server.ts src/lib/neon/auth.server.ts src/lib/neon/admin-data.server.ts src/lib/neon/admin-cms.contract.test.mjs
git commit -m "feat: add isolated CMS draft operations"
```

### Task 4: Implement Publish, Restore, Archive, and Public Isolation

**Files:**
- Modify: `src/lib/neon/admin-cms.server.ts`
- Modify: `src/lib/neon/public-data.server.ts`
- Modify: `src/lib/neon/public-data.ts`
- Modify: `src/config/site.test.mjs`
- Test: `src/lib/neon/cms-revisions.test.mjs`

**Interfaces:**
- Consumes: `CmsPublishInput`, `makeRestoreDraft`, `requireStaffAccess`.
- Produces: atomic publication, restore-as-draft, archive, and public-read isolation behavior.

- [ ] **Step 1: Write failing publish and public-isolation tests**

```js
test("public CMS reads use canonical published rows and never cms_content_revisions", () => {
  const publicServer = read("src/lib/neon/public-data.server.ts");
  assert.doesNotMatch(publicServer, /cms_content_revisions/);
});

test("restore creates a draft and publish checks the expected public version", () => {
  const source = read("src/lib/neon/admin-cms.server.ts");
  assert.match(source, /makeRestoreDraft/);
  assert.match(source, /expectedPublishedVersion/);
  assert.match(source, /CMS_REVISION_CONFLICT/);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test src/lib/neon/cms-revisions.test.mjs src/config/site.test.mjs`

Expected: FAIL on the missing publish implementation assertion.

- [ ] **Step 3: Implement atomic publish**

Within one transaction, lock the current published revision for the resource, compare its version with `expectedPublishedVersion`, validate the draft payload, mark the previous published revision `superseded`, mark the draft `published`, and project the payload into its canonical table. Use explicit projector functions named `publishEstatePayload`, `publishArticlePayload`, `publishVideoPayload`, `publishFaqPayload`, and `publishMediaPayload`.

- [ ] **Step 4: Implement restore and archive**

`restoreAdminCmsRevision` loads the selected version, calls `makeRestoreDraft`, and inserts a new draft. `archiveAdminCmsResource` requires `admin` or `manager`, creates an archived revision, updates the canonical row's public visibility field where that type supports one, and writes an audit record. Do not issue `DELETE` for a published row.

- [ ] **Step 5: Record audit events**

Call the existing `writeAudit(actor.staffId, action, subjectType, subjectId, metadata)` for `cms_draft_saved`, `cms_published`, `cms_restored`, and `cms_archived`.

- [ ] **Step 6: Run focused public and lifecycle tests**

Run: `node --test src/lib/neon/cms-revisions.test.mjs src/config/site.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/neon/admin-cms.server.ts src/lib/neon/public-data.server.ts src/lib/neon/public-data.ts src/lib/neon/cms-revisions.test.mjs src/config/site.test.mjs
git commit -m "feat: publish and restore CMS revisions safely"
```

### Task 5: Build the Content Hub and Independent Category Lists

**Files:**
- Create: `src/components/admin/cms/CmsContentHub.tsx`
- Create: `src/components/admin/cms/CmsCategoryTable.tsx`
- Create: `src/routes/admin.cms.$type.tsx`
- Modify: `src/routes/admin.cms.tsx`
- Modify: `src/routes/admin.routes.test.mjs`

**Interfaces:**
- Consumes: `fetchAdminCmsHub`, `fetchAdminCmsCategory`, `CmsHubRow`.
- Produces: `/admin/cms` overview and `/admin/cms/$type` category routes.

- [ ] **Step 1: Write failing route tests**

```js
test("admin CMS uses independent hub and category routes", () => {
  for (const [file, names] of [
    ["src/routes/admin.cms.tsx", ["CmsContentHub", "fetchAdminCmsHub"]],
    ["src/routes/admin.cms.$type.tsx", ["CmsCategoryTable", "fetchAdminCmsCategory"]],
  ]) {
    const source = read(file);
    for (const name of names) assert.match(source, new RegExp(`\\b${name}\\b`));
  }
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/routes/admin.routes.test.mjs`

Expected: FAIL because `admin.cms.$type.tsx` does not exist.

- [ ] **Step 3: Implement `CmsContentHub`**

Render My drafts, Ready to publish, Recently published, search input, category shortcuts, and a `New content` menu. Use `AdminEmptyState` for empty views and a retry button for hub load errors. Do not fetch category data from the hub route.

- [ ] **Step 4: Implement `CmsCategoryTable`**

Render category-local loading, unavailable, empty, error, and table states. Each row includes title, status, last editor, updated time, published version, Resume draft, Preview, Publish, and History actions. Use `Link` routes rather than dialog state.

- [ ] **Step 5: Replace the legacy tab route**

Reduce `admin.cms.tsx` to the `AdminShell` plus `CmsContentHub`; move the existing AI knowledge card into a focused `CmsKnowledgeStatus` component only if it remains a CMS concern. Do not retain `refreshCmsData()` or one shared tab state.

- [ ] **Step 6: Run route tests**

Run: `node --test src/routes/admin.routes.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/cms/CmsContentHub.tsx src/components/admin/cms/CmsCategoryTable.tsx src/routes/admin.cms.tsx src/routes/admin.cms.$type.tsx src/routes/admin.routes.test.mjs
git commit -m "feat: add CMS content hub"
```

### Task 6: Add Shared Editor, Recovery, Preview, and Revision UI

**Files:**
- Create: `src/components/admin/cms/CmsEditorShell.tsx`
- Create: `src/components/admin/cms/CmsRevisionPanel.tsx`
- Create: `src/components/admin/cms/useCmsDraftRecovery.ts`
- Create: `src/routes/admin.cms.$type_.$id.tsx`
- Test: `src/routes/admin.routes.test.mjs`

**Interfaces:**
- Consumes: Task 2 editor, save, publish, and restore contracts.
- Produces: one protected editor route and reusable recovery/version controls.

- [ ] **Step 1: Write failing recovery and editor-route assertions**

```js
test("CMS editor keeps recovery, preview, publish, and revision controls together", () => {
  const editor = read("src/components/admin/cms/CmsEditorShell.tsx");
  const recovery = read("src/components/admin/cms/useCmsDraftRecovery.ts");
  assert.match(editor, /Save draft/);
  assert.match(editor, /Preview/);
  assert.match(editor, /Publish/);
  assert.match(editor, /CmsRevisionPanel/);
  assert.match(recovery, /localStorage/);
  assert.match(recovery, /7 \* 24 \* 60 \* 60 \* 1000/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/routes/admin.routes.test.mjs`

Expected: FAIL because the shared editor files do not exist.

- [ ] **Step 3: Implement local draft recovery**

Use key `earnestproperty:cms-recovery:${staffId}:${resourceType}:${resourceId}`. Store `{ savedAt, payload }`, restore only when `Date.now() - savedAt <= 7 * 24 * 60 * 60 * 1000`, and expose `saveRecovery`, `clearRecovery`, and `recoveredPayload`.

- [ ] **Step 4: Implement the editor shell**

Place type-specific fields in the main column. Use a sticky action bar with explicit Save draft, staff Preview, and conditionally visible Publish. Preserve the entered draft after a failed save. Show server validation errors and conflict metadata in the side panel.

- [ ] **Step 5: Implement the revision panel and editor route**

Show the latest 20 revisions, selected-version metadata, payload comparison, and Restore as draft. The route accepts only the five resource types; invalid types render `AdminError` rather than attempting a database query.

- [ ] **Step 6: Run route tests**

Run: `node --test src/routes/admin.routes.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/cms/CmsEditorShell.tsx src/components/admin/cms/CmsRevisionPanel.tsx src/components/admin/cms/useCmsDraftRecovery.ts src/routes/admin.cms.$type_.$id.tsx src/routes/admin.routes.test.mjs
git commit -m "feat: add recoverable CMS editor workflow"
```

### Task 7: Migrate Estate and Article Editors to the Shared Workflow

**Files:**
- Create: `src/components/admin/cms/EstateCmsEditor.tsx`
- Create: `src/components/admin/cms/ArticleCmsEditor.tsx`
- Modify: `src/lib/neon/admin-cms.server.ts`
- Test: `src/lib/neon/admin-cms.contract.test.mjs`

**Interfaces:**
- Consumes: `CmsEditorShell`, `AdminEstateInput`, `AdminArticleInput`.
- Produces: normalized estate/article payload validators and canonical publish projectors.

- [ ] **Step 1: Write failing type-specific validator tests**

```js
test("estate and article drafts validate required public fields before publish", () => {
  const source = read("src/lib/neon/admin-cms.server.ts");
  assert.match(source, /validateEstatePayload/);
  assert.match(source, /validateArticlePayload/);
  assert.match(source, /publishEstatePayload/);
  assert.match(source, /publishArticlePayload/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/lib/neon/admin-cms.contract.test.mjs`

Expected: FAIL on the missing validator names.

- [ ] **Step 3: Implement estate and article editors**

Map the current estate fields (`slug`, `name_zh`, `district_slug`, SEO fields, facilities, highlights, transport, schools) and article fields (`slug`, `title`, category, excerpt, body, published date, SEO fields) into controlled editor payloads. Keep all labels and validation messages in Chinese where the existing editor already uses Chinese.

- [ ] **Step 4: Implement validation and projectors**

`validateEstatePayload` requires `slug`, `name_zh`, and `district_slug`. `validateArticlePayload` requires `slug` and `title`. Projectors use the existing `saveAdminEstate` and `saveAdminArticle` SQL field sets inside the publish transaction rather than creating parallel canonical schemas.

- [ ] **Step 5: Run focused tests**

Run: `node --test src/lib/neon/admin-cms.contract.test.mjs src/lib/neon/cms-revisions.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/cms/EstateCmsEditor.tsx src/components/admin/cms/ArticleCmsEditor.tsx src/lib/neon/admin-cms.server.ts src/lib/neon/admin-cms.contract.test.mjs
git commit -m "feat: migrate estate and article CMS editors"
```

### Task 8: Migrate Videos, FAQs, and Media to the Shared Workflow

**Files:**
- Create: `src/components/admin/cms/VideoCmsEditor.tsx`
- Create: `src/components/admin/cms/FaqCmsEditor.tsx`
- Create: `src/components/admin/cms/MediaCmsEditor.tsx`
- Modify: `src/lib/neon/admin-cms.server.ts`
- Modify: `src/routes/videos.tsx`
- Test: `src/config/site.test.mjs`

**Interfaces:**
- Consumes: `isYouTubeVideoUrl`, `parseAdminFaqImport`, `updateAdminMediaAsset` behavior.
- Produces: video/FAQ/media draft validators and safe public-video behavior.

- [ ] **Step 1: Write failing video, FAQ, and media tests**

```js
test("CMS workflow keeps video validation, FAQ import, and safe media references", () => {
  const server = read("src/lib/neon/admin-cms.server.ts");
  assert.match(server, /isYouTubeVideoUrl/);
  assert.match(server, /validateFaqPayload/);
  assert.match(server, /validateMediaPayload/);
  assert.match(server, /isMediaAssetReferenced/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/lib/neon/admin-cms.contract.test.mjs`

Expected: FAIL on the missing validator names.

- [ ] **Step 3: Implement type-specific editors and validators**

Video validation requires title and a valid YouTube video URL. FAQ validation requires scope, question, and answer; retain the existing parser preview before an import creates draft revisions. Media validation permits alt text and owner metadata but requires an explicit reference check before archive; do not delete a Blob.

- [ ] **Step 4: Preserve public video resilience**

Keep `fetchCmsVideos()` returning only canonical published rows and retain its missing-table fallback. Add a source test that `/videos` does not request draft revisions.

- [ ] **Step 5: Run focused tests**

Run: `npm.cmd run test:contact; node --test src/lib/neon/admin-cms.contract.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/cms/VideoCmsEditor.tsx src/components/admin/cms/FaqCmsEditor.tsx src/components/admin/cms/MediaCmsEditor.tsx src/lib/neon/admin-cms.server.ts src/routes/videos.tsx src/config/site.test.mjs src/lib/neon/admin-cms.contract.test.mjs
git commit -m "feat: migrate video FAQ and media CMS editors"
```

### Task 9: Verify Migration Safety, Accessibility, and Production Build

**Files:**
- Modify only verification failures in files from Tasks 1-8.
- Test: `src/lib/neon/cms-revisions.test.mjs`, `src/lib/neon/admin-cms.contract.test.mjs`, `src/routes/admin.routes.test.mjs`, `src/config/site.test.mjs`.

**Interfaces:**
- Consumes: all Task 1-8 contracts.
- Produces: verified implementation with no regression to the existing admin and public CMS flows.

- [ ] **Step 1: Run the complete focused CMS suite**

Run:

```bash
node --test src/lib/neon/cms-revisions.test.mjs src/lib/neon/admin-cms.contract.test.mjs src/lib/neon/admin-data.contract.test.mjs src/routes/admin.routes.test.mjs
npm.cmd run test:contact
```

Expected: every test passes.

- [ ] **Step 2: Run lint and production build**

Run:

```bash
npm.cmd run lint
npm.cmd run build
```

Expected: lint and Vite build pass. Record pre-existing failures separately if they occur before touching a CMS file.

- [ ] **Step 3: Manually verify desktop and mobile flows**

Verify as `agent` that Save draft is available but Publish, Restore, and Archive are denied. Verify as `manager` that an estate draft saves, survives a reload through local recovery, previews without changing `/estate/$slug`, publishes, appears on the public page, shows version 2, and restores version 1 through a new draft. Verify a missing `cms_videos` table state does not break Estates, Articles, FAQs, or Media.

- [ ] **Step 4: Commit verification fixes only when needed**

```bash
git add <only-files-fixed-by-verification>
git commit -m "fix: stabilize CMS content hub"
```

Expected: omit this commit when verification needs no code change.

## Plan Self-Review

- Spec coverage: Tasks 1-4 cover revisions, migration, roles, publish, restore, archive, public isolation, and missing-table behavior. Tasks 5-8 cover the Content Hub and all five content types. Task 9 covers automated and manual verification.
- No placeholders: every task names exact files, interfaces, tests, commands, expected outcomes, and commit scopes.
- Type consistency: all tasks use `CmsResourceType`, `CmsRevisionState`, `CmsDraftSaveInput`, `CmsPublishInput`, and `CMS_REVISION_CONFLICT` from the shared interface section.

