# P6b — Wire the CMS revision engine for estates and articles

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `admin.cms.tsx`'s direct-write path for **estates and articles only** with the already-built, currently-uncalled revision engine (`src/lib/neon/admin-cms.ts`/`admin-cms.server.ts`) — real draft → publish → restore → archive, backed by `cms_content_revisions`, with visible version history.

**Scope boundary (deliberate — do not expand):** Video, FAQ, and media stay on the existing `admin-data.ts` direct-write path this phase. A prior investigation (see `docs/superpowers/plans/2026-08-28-frontend-revamp-plan.md`'s P6 section and this plan's own commit history) found three unresolved architectural conflicts for those types: a background YouTube-sync job writes `cms_videos` directly and would race with revision-engine publishes; new media uploads (`api.admin.media.upload.ts`, plus an MLS sync path) create `media_assets` rows with no corresponding revision row, so editing a freshly-uploaded asset would show a blank editor; and FAQ's bulk-import flow (`checkAdminFaqConflicts` + `upsert: true`) has no batch-shaped equivalent in the revision engine at all. None of that is fixed here — video/FAQ/media wiring is a separate future phase.

**Architecture:** No schema changes (the `cms_content_revisions` table, its backfill, and the `estates.published`/`articles.published`/`published_at` columns already exist from `20260711090000_cms_content_revisions.sql`). This phase only touches `src/routes/admin.cms.tsx` (estate + article dialogs, table row actions, imports) and its test coverage. `admin-cms.ts`/`admin-cms.server.ts`/`cms-revisions.ts` are used exactly as they already exist — this is a caller-side wiring change, not an engine change.

**A note on test coverage (read before starting):** `admin-cms.server.ts` calls `queryRows`/`getSql` as bare module-level imports (no dependency-injection seam like `admin-team.server.ts`'s factory pattern), and this project has no live database access from this environment. The three existing test files for the revision engine (`admin-cms.contract.test.mjs`, `admin-cms.server.contract.test.mjs`, `cms-revisions.test.mjs`) are source-shape/pure-function tests, not live-SQL tests — that stays true after this phase; this plan does not add live-DB tests, because doing so would require refactoring `admin-cms.server.ts` into a dependency-injectable shape, which is out of scope for a wiring task. The SQL logic (optimistic-concurrency conflict, archive-in-use guard) is verified today only by reading the SQL, same as before this phase. **Recommend a manual smoke test in a preview deploy before merging to `main`**, since this is the first time these code paths run against a real request.

---

## 0. Design decisions (state these before touching code)

1. **Two explicit actions replace one "Save" button:** 儲存草稿 (save draft — calls `saveAdminCmsDraft`, never touches the live table) and 發布 (publish — calls `saveAdminCmsDraft` then immediately `publishAdminCmsRevision` with the returned `revisionId`). This matches how `PUBLISH_ROLES = ["admin","manager"]` differs from `ALL_CMS_ROLES` in `admin-cms.server.ts` — an agent can save a draft but the 發布 button must be hidden/disabled for them (server already enforces this with a 403; the client hides it too so an agent isn't shown a button that always fails).
2. **`resourceId` is minted server-side on first draft save**, not client-side. A "新增屋苑"/"新增文章" dialog opens with `editingEstate.id`/`editingArticle.id` unset. After the first successful `saveAdminCmsDraft` call, the returned `resourceId` must be written back into the editing state (`onChange({ ...estate, id: result.resourceId })`) so subsequent draft saves in the same dialog session update the same resource instead of minting a new one each time.
3. **`ArticleDialog` drops its `published`/`published_at` fields entirely.** The article projector in `admin-cms.server.ts` unconditionally sets `published = true, published_at = now()` on every publish — a manually-set toggle/date would be silently overwritten, so keeping the fields would be actively misleading. "Unpublish" becomes the 封存 (archive) action instead of toggling a checkbox. `EstateDialog` never had these fields (estates already only became `published` via the P4 registry gate), so no equivalent change is needed there.
4. **Archive is a new action, not a delete.** Estates/articles have no delete today. 封存 calls `archiveAdminCmsResource`, which sets the live table's `published = false` and marks the current published revision `superseded` — the row keeps existing in the live table and in the admin list (unchanged: the list still reads live `estates`/`articles` via `fetchAdminCms()`, which already shows unpublished rows). "Un-archiving" is: open the archived resource's editor, find the archived revision in its version history, click 還原 (restore, creates a fresh draft from that payload), then 發布.
5. **The estate/article list table is unchanged** — still reads from `fetchAdminCms()` (live `estates`/`articles` tables), not from `fetchAdminCmsHub`/`fetchAdminCmsCategory`. Only the editor dialog and its data source change. (Adding a "has unpublished draft" badge to the list table is real, separable follow-up work, not required for this phase's acceptance.)
6. **Version history is a read-only list inside the editor dialog**, loaded via `fetchAdminCmsEditor({ resourceType, resourceId })` when the dialog opens for an *existing* resource (skip the call entirely for "new" — no `id` yet, nothing to show). Each entry shows state (badge), version number, `createdAt`, `createdBy` (display name if the hub row provides one, else the raw id), and a 還原 button (hidden for agents — restore is `PUBLISH_ROLES`-gated too).
7. **Error handling:** both `publishAdminCmsRevision` and `archiveAdminCmsResource` can return `{ ok: false, code }` (not thrown) alongside genuinely thrown errors (`CMS_REVISION_NOT_FOUND`, `CMS_REVISION_MISMATCH` from a stale/tampered revision id). A single new helper (`callCms`, Task 1) normalizes both into a thrown `Error` with a zh-HK message, so every call site can use the same `try { ... } catch (err) { toast.error(errorText(err)) }` shape already used throughout this file.

---

## Task 1: Add the CMS result-unwrapping helper

**Files:**
- Modify: `src/routes/admin.cms.tsx`

- [ ] **Step 1: Add the error-code map and `callCms` helper**

Add near the existing `assertNoServerError`/`errorText` helpers (end of file, alongside the other small utility functions):

```typescript
const CMS_ERROR_MESSAGES: Record<string, string> = {
  CMS_REVISION_CONFLICT: "此草稿的發布版本已被其他人更新，請重新載入頁面後再試一次。",
  CMS_REVISION_NOT_FOUND: "找不到此版本，可能已被更新，請重新載入頁面。",
  CMS_REVISION_MISMATCH: "版本資料不符，請重新載入頁面後再試一次。",
  CMS_RESOURCE_NOT_FOUND: "找不到此資源，可能已被其他人刪除或封存，請重新載入頁面。",
  CMS_MEDIA_IN_USE: "此媒體仍被其他內容使用，未能封存。",
};

function cmsErrorMessage(code: string): string {
  return CMS_ERROR_MESSAGES[code] ?? "操作失敗，請重試。";
}

/**
 * Normalizes both failure shapes the CMS revision engine can return -- a
 * thrown Error (CMS_REVISION_NOT_FOUND / CMS_REVISION_MISMATCH) and a typed
 * { ok: false, code } result (CMS_REVISION_CONFLICT / CMS_RESOURCE_NOT_FOUND /
 * CMS_MEDIA_IN_USE) -- into a single thrown Error with a zh-HK message, so
 * every call site can use the same catch-and-toast shape as the rest of this
 * file.
 */
async function callCms<T>(call: () => Promise<T>): Promise<T> {
  let result: T;
  try {
    result = await call();
  } catch (err) {
    const status =
      err && typeof err === "object" && "status" in err
        ? Number((err as { status?: unknown }).status)
        : 0;
    if (status === 401) throw new Error("登入已過期，請重新登入後再試。");
    if (status === 403) throw new Error("你的角色沒有此操作的權限，請聯絡管理員或主管。");
    throw new Error(cmsErrorMessage(errorText(err)));
  }
  if (result && typeof result === "object" && "ok" in result && (result as { ok: unknown }).ok === false) {
    const code = "code" in result ? String((result as { code?: unknown }).code) : "";
    throw new Error(cmsErrorMessage(code));
  }
  return result;
}
```

(Note: `T` is deliberately unconstrained, not `T extends { ok: boolean }` — `saveAdminCmsDraft`/`restoreAdminCmsRevision` never return an `ok` field at all, they throw on failure. The runtime `"ok" in result` check is what lets one helper wrap both the plain-success and the `{ok, code}`-shaped functions.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (this step only adds unused-so-far helpers; nothing calls them yet).

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin.cms.tsx
git commit -m "feat(admin): add CMS revision-engine result-unwrapping helper"
```

---

## Task 2: Swap imports and add version-history state

**Files:**
- Modify: `src/routes/admin.cms.tsx`

- [ ] **Step 1: Update the `admin-data` import**

Remove `saveAdminEstate` and `saveAdminArticle` from the `@/lib/neon/admin-data` import block (lines ~57-70) — they stay used nowhere else in this file after Tasks 3-4. Keep every other import from that block (`saveAdminFaq`, `saveAdminCmsVideo`, `updateAdminMediaAsset`, `deleteAdminFaq`, `checkAdminFaqConflicts`, `fetchAdminCms`, `fetchAdminMediaAssets`, `fetchAdminCmsVideos`, `fetchAdminAiKnowledgeStatus`, `rebuildAdminAiKnowledge`, `saveAdminFaq`, `parseAdminFaqImport`) — those five content types/flows are unchanged this phase.

- [ ] **Step 2: Add the `admin-cms` import**

```typescript
import {
  archiveAdminCmsResource,
  fetchAdminCmsEditor,
  publishAdminCmsRevision,
  saveAdminCmsDraft,
} from "@/lib/neon/admin-cms";
import type { CmsRevisionSummary } from "@/lib/neon/admin-cms.types";
```

- [ ] **Step 3: Add version-history state**

Alongside the existing `editingEstate`/`editingArticle` state declarations:

```typescript
const [estateRevisions, setEstateRevisions] = useState<CmsRevisionSummary[] | null>(null);
const [articleRevisions, setArticleRevisions] = useState<CmsRevisionSummary[] | null>(null);
const [publishing, setPublishing] = useState(false);
const [archiving, setArchiving] = useState<{ type: "estate" | "article"; id: string } | null>(null);
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx tsc --noEmit`
Expected: errors for `saveAdminEstate`/`saveAdminArticle` no longer being imported but still referenced in `handleSaveEstate`/`handleSaveArticle` (Tasks 3-4 fix this) — confirms the import swap actually took effect rather than silently doing nothing.

- [ ] **Step 5: Commit is deferred to the end of Task 4** (this task's edits leave the file in a deliberately broken intermediate state; committing here would leave a red commit).

---

## Task 3: Rework the estate save/publish/archive flow

**Files:**
- Modify: `src/routes/admin.cms.tsx`

- [ ] **Step 1: Replace `handleSaveEstate` with `handleSaveEstateDraft` + `handlePublishEstate`**

Replace the existing `handleSaveEstate` function:

```typescript
async function handleSaveEstateDraft(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (!editingEstate) return;
  if (
    !editingEstate.slug.trim() ||
    !editingEstate.name_zh.trim() ||
    !editingEstate.district_slug.trim()
  ) {
    toast.error("請填寫屋苑 slug、中文名及地區");
    return;
  }

  setSaving(true);
  try {
    const result = await callCms(() =>
      saveAdminCmsDraft({
        data: {
          resourceType: "estate",
          resourceId: editingEstate.id,
          payload: { ...editingEstate },
          basePublishedVersion: estateRevisions?.find((r) => r.state === "published")
            ?.versionNumber,
        },
      }),
    );
    setEditingEstate({ ...editingEstate, id: result.resourceId });
    await loadEstateRevisions(result.resourceId);
    toast.success("草稿已儲存");
  } catch (err) {
    toast.error(errorText(err));
  } finally {
    setSaving(false);
  }
}

async function handlePublishEstate() {
  if (!editingEstate) return;
  setPublishing(true);
  try {
    const draft = await callCms(() =>
      saveAdminCmsDraft({
        data: {
          resourceType: "estate",
          resourceId: editingEstate.id,
          payload: { ...editingEstate },
          basePublishedVersion: estateRevisions?.find((r) => r.state === "published")
            ?.versionNumber,
        },
      }),
    );
    await callCms(() =>
      publishAdminCmsRevision({
        data: { resourceType: "estate", resourceId: draft.resourceId, revisionId: draft.revisionId },
      }),
    );
    setEditingEstate(null);
    await Promise.all([refreshAfterWrite("屋苑已發布"), loadEstateRevisions(draft.resourceId)]);
  } catch (err) {
    toast.error(errorText(err));
  } finally {
    setPublishing(false);
  }
}

async function loadEstateRevisions(resourceId: string | undefined) {
  if (!resourceId) {
    setEstateRevisions(null);
    return;
  }
  try {
    const { revisions } = await fetchAdminCmsEditor({
      data: { resourceType: "estate", resourceId },
    });
    setEstateRevisions(revisions);
  } catch {
    setEstateRevisions(null);
  }
}

async function handleRestoreEstateRevision(revisionId: string) {
  if (!editingEstate?.id) return;
  setSaving(true);
  try {
    const { restoreAdminCmsRevision } = await import("@/lib/neon/admin-cms");
    const result = await callCms(() => restoreAdminCmsRevision({ data: { revisionId } }));
    await loadEstateRevisions(result.resourceId);
    toast.success("已還原為新草稿，請檢查內容後發布");
  } catch (err) {
    toast.error(errorText(err));
  } finally {
    setSaving(false);
  }
}

async function handleArchiveEstate(estateId: string) {
  setSaving(true);
  try {
    await callCms(() =>
      archiveAdminCmsResource({ data: { resourceType: "estate", resourceId: estateId } }),
    );
    setArchiving(null);
    await refreshAfterWrite("屋苑已封存");
  } catch (err) {
    toast.error(errorText(err));
  } finally {
    setSaving(false);
  }
}
```

(`restoreAdminCmsRevision` is dynamically imported inline in `handleRestoreEstateRevision` only to keep the top-level import list from Task 2 minimal — actually, since it is also needed for articles in Task 4, add it to the Task 2 top-level import instead: `import { archiveAdminCmsResource, fetchAdminCmsEditor, publishAdminCmsRevision, restoreAdminCmsRevision, saveAdminCmsDraft } from "@/lib/neon/admin-cms";` — use the top-level import, not the inline dynamic one shown above; the inline form was scratch reasoning only, replace it with a direct call to the top-level `restoreAdminCmsRevision`.)

- [ ] **Step 2: Load revisions when the estate dialog opens**

Find where `setEditingEstate(estateToInput(estate))` is called (the 編輯 button's `onClick` in the estates table) and add a call to `loadEstateRevisions(estate.id)` alongside it:

```typescript
onClick={() => {
  setEditingEstate(estateToInput(estate));
  void loadEstateRevisions(estate.id);
}}
```

Also reset `estateRevisions` to `null` when `setEditingEstate({ ...emptyEstate })` is called for "新增屋苑" (new estate has no history yet) — find both call sites (the header button and the empty-state action button) and add `setEstateRevisions(null);` alongside each.

- [ ] **Step 3: Add the archive confirm dialog**

Add state and a confirm dialog for archiving, following the exact pattern already used for `deletingFaq`/`AdminConfirmDialog` in this file. Add an "封存" button next to each estate row's existing 編輯 button:

```typescript
<Button
  variant="outline"
  size="sm"
  onClick={() => setArchiving({ type: "estate", id: estate.id })}
>
  <Archive className="h-4 w-4" />
  封存
</Button>
```

(Import `Archive` and `History` from `lucide-react` alongside the file's existing icon imports.)

Add one shared `AdminConfirmDialog` for archiving (estates and articles share it, branching on `archiving?.type`), placed alongside the existing `deletingFaq` confirm dialog:

```typescript
<AdminConfirmDialog
  open={archiving !== null}
  title="封存"
  description={
    archiving
      ? `確定要封存此${archiving.type === "estate" ? "屋苑" : "文章"}？封存後會從公開網站下架，但可在版本紀錄中還原。`
      : ""
  }
  confirmLabel="封存"
  confirmVariant="destructive"
  isPending={saving}
  onOpenChange={(open) => {
    if (!open) setArchiving(null);
  }}
  onConfirm={() => {
    if (!archiving) return;
    if (archiving.type === "estate") void handleArchiveEstate(archiving.id);
    else void handleArchiveArticle(archiving.id);
  }}
/>
```

- [ ] **Step 4: Update `EstateDialog` to show version history and the two actions**

Replace the single `<EditorFooter saving={saving} onClose={requestClose} />` in `EstateDialog`'s form with a footer that has two submit-shaped buttons. `EstateDialog` needs three new props: `revisions: CmsRevisionSummary[] | null`, `publishing: boolean`, `onPublish: () => void`, `onRestoreRevision: (revisionId: string) => void`, `canPublish: boolean` (derived from the acting staff's roles — see Step 5). Change `onSubmit` to mean "save draft" specifically (rename the prop usage to match `handleSaveEstateDraft`), and add a distinct 發布 button that calls `onPublish` directly (not a form submit, since publish needs to run after a fresh draft save, not instead of one):

```tsx
<div className="flex items-center justify-end gap-2 border-t pt-4">
  <Button type="button" variant="ghost" onClick={requestClose} disabled={saving || publishing}>
    取消
  </Button>
  <Button type="submit" variant="outline" disabled={saving || publishing}>
    <Save className="h-4 w-4" />
    {saving ? "儲存中…" : "儲存草稿"}
  </Button>
  {canPublish ? (
    <Button type="button" onClick={onPublish} disabled={saving || publishing}>
      <Upload className="h-4 w-4" />
      {publishing ? "發布中…" : "發布"}
    </Button>
  ) : null}
</div>
```

(`Upload` icon already imported in this file for the media tab — reuse it.)

Add a version-history panel below the form (inside the same `lg:grid-cols-[minmax(0,1fr)_24rem]` layout, stacked under `AdminContentCopilot` in the right-hand column, or as a new row if that column gets crowded — use a new row below the two-column grid, spanning full width, since the copilot panel is already tall):

```tsx
{estate?.id && revisions ? (
  <div className="mt-4 rounded-md border p-4 lg:col-span-2">
    <h4 className="text-sm font-semibold">版本紀錄</h4>
    {revisions.length ? (
      <ul className="mt-2 space-y-2">
        {revisions.map((revision) => (
          <li
            key={revision.id}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="flex items-center gap-2">
              <Badge variant={revision.state === "published" ? "default" : "outline"}>
                {revision.state === "draft"
                  ? "草稿"
                  : revision.state === "published"
                    ? "已發布"
                    : revision.state === "superseded"
                      ? "已被取代"
                      : "已封存"}
              </Badge>
              <span className="text-muted-foreground">
                v{revision.versionNumber} · {formatDateTime(revision.createdAt)}
              </span>
            </span>
            {canPublish ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRestoreRevision(revision.id)}
              >
                <History className="h-4 w-4" />
                還原
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    ) : (
      <p className="mt-2 text-sm text-muted-foreground">暫無版本紀錄</p>
    )}
  </div>
) : null}
```

- [ ] **Step 5: Determine `canPublish` and thread all new props through**

In the `AdminCms` component, derive `const canPublish = (user?.roles ?? []).some((role) => role === "admin" || role === "manager");` (check `useNeonAuth()`'s actual returned shape for how roles are exposed — if `user.roles` isn't the right accessor, use whatever this file's existing `useNeonAuth()` usage already exposes; this file already reads `user` from `useNeonAuth()` at the top of the component, confirm its `roles` field name against `src/hooks/use-neon-auth.ts` before writing this line). Pass `revisions={estateRevisions}`, `publishing={publishing}`, `onPublish={handlePublishEstate}`, `onRestoreRevision={handleRestoreEstateRevision}`, `canPublish={canPublish}` into the `<EstateDialog>` mount, and change its `onSubmit={handleSaveEstate}` to `onSubmit={handleSaveEstateDraft}`.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors related to estates (article-related errors from Task 2's import swap are expected until Task 4 lands).

- [ ] **Step 7: Manual verification note**

This cannot be verified against a live database from this environment (no DB access). After Task 4 completes and the branch is pushed, request a preview-deploy smoke test: open `/admin/cms`, create a test estate, save as draft (confirm it does NOT appear on the public site), publish it (confirm it now appears), edit and publish again (confirm the old version shows in 版本紀錄 as `已被取代`), archive it (confirm it disappears from the public site), restore the archived version and publish again (confirm it reappears).

- [ ] **Step 8: Commit is deferred to the end of Task 4.**

---

## Task 4: Rework the article save/publish/archive flow (mirrors Task 3)

**Files:**
- Modify: `src/routes/admin.cms.tsx`

- [ ] **Step 1: Replace `handleSaveArticle` with `handleSaveArticleDraft` + `handlePublishArticle` + `loadArticleRevisions` + `handleRestoreArticleRevision` + `handleArchiveArticle`**, following exactly the same shape as Task 3 Step 1, substituting `resourceType: "article"`, `editingArticle`/`setEditingArticle`, `articleRevisions`/`setArticleRevisions`. Validation stays `!editingArticle.slug.trim() || !editingArticle.title.trim()` (unchanged from today).

- [ ] **Step 2: Load revisions when the article dialog opens** — same pattern as Task 3 Step 2, on the articles table's 編輯 button and both "新增文章" buttons.

- [ ] **Step 3: Add the "封存" button to each article row**, identical to Task 3 Step 3's estate row button (the shared `AdminConfirmDialog` from Task 3 Step 3 already branches on `archiving.type === "article"`).

- [ ] **Step 4: Update `ArticleDialog`:**
  - Remove the `published` `Switch` field and the `published_at` `datetime-local` field entirely (per Design Decision 3) — also remove the now-unused `toDateTimeLocal`/`fromDateTimeLocal` helpers IF nothing else in the file uses them (grep first; if they're only used by `ArticleDialog`, delete them too).
  - Add the same two-button footer (儲存草稿 / 發布, gated by `canPublish`) and version-history panel as `EstateDialog`, adapted for articles (`onPublish={handlePublishArticle}`, `onRestoreRevision={handleRestoreArticleRevision}`, `revisions={articleRevisions}`).
  - Change `onSubmit={handleSaveArticle}` to `onSubmit={handleSaveArticleDraft}` at the mount site.

- [ ] **Step 5: Remove the now-dead `published`/`published_at` fields from `emptyArticle`**

`emptyArticle`'s `published: false, published_at: null` fields become vestigial once the dialog no longer edits them — leave them in `AdminArticleInput`'s type (don't touch `admin-data.types.ts` this phase, that type is still used by other things this phase doesn't touch) but remove them from the `emptyArticle` constant object literal only if TypeScript requires every field to be present (it will, since `AdminArticleInput` isn't `Partial`) — so actually **keep** `published: false, published_at: null` in `emptyArticle` as inert defaults (the payload sent to `saveAdminCmsDraft` will include them since it spreads `{ ...editingArticle }`, but the article projector's publish step ignores whatever `published`/`published_at` the payload carries and always sets its own values — confirmed in the investigation above — so sending inert defaults is harmless, not misleading, since nothing reads them back out for display anymore).

- [ ] **Step 6: Run the CMS suite**

Run: `npm run test:cms && npm run test:command-center`
Expected: PASS. If `admin-cms.contract.test.mjs` or `admin-data.contract.test.mjs` fail, read the failure carefully — Task 5 addresses expected updates there.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit (Tasks 2-4 together, since Task 2 alone was deliberately left broken)**

```bash
git add src/routes/admin.cms.tsx
git commit -m "feat(admin): wire estate and article CMS editing to the revision engine

Replaces admin.cms.tsx's direct-write path for estates and articles with
saveAdminCmsDraft/publishAdminCmsRevision/restoreAdminCmsRevision/
archiveAdminCmsResource -- real draft, publish, restore, and archive,
with visible version history. Video, FAQ, and media stay on the old
admin-data.ts path this phase (see this plan's scope-boundary note)."
```

---

## Task 5: Update stale test assertions and the UNREACHABLE comment

**Files:**
- Modify: `src/lib/neon/admin-cms.ts` (comment only)
- Modify: `src/lib/ai/ai-contract.test.mjs` (check, likely no change needed — see Step 2)
- Create or modify: a contract test proving `admin.cms.tsx` now calls the new functions for estate/article

- [ ] **Step 1: Soften the UNREACHABLE comment**

In `src/lib/neon/admin-cms.ts`, replace the top-of-file comment. It currently claims the module "ships in no bundle and is called by nothing" — false after this phase for estate/article. Replace with:

```typescript
/**
 * CMS revision engine — draft / publish / restore / archive, backed by the
 * cms_content_revisions table.
 *
 * As of P6b (docs/superpowers/plans/2026-08-31-frontend-revamp-p6b-cms-revision-wiring.md),
 * src/routes/admin.cms.tsx calls this module for estates and articles.
 * Video, FAQ, and media still write through admin-data.ts directly -- see
 * that plan's "scope boundary" note for why (a background YouTube-sync job
 * races with this engine for video; new media uploads create no revision
 * row; FAQ bulk-import has no batch-shaped equivalent here). Do not remove
 * admin-data.ts's saveAdminCmsVideo/saveAdminFaq/updateAdminMediaAsset/
 * checkAdminFaqConflicts/deleteAdminFaq -- they are still the only write
 * path for those three resource types.
 */
```

- [ ] **Step 2: Check whether `ai-contract.test.mjs`'s negative assertion about `saveAdminArticle` needs updating**

Read `src/lib/ai/ai-contract.test.mjs`'s assertion mentioning `saveAdminArticle` (found during the P6b investigation as a negative assertion — "asserts `saveAdminArticle` does *not* appear in some other code path"). Confirm what file it's checking against. If it's checking that `saveAdminArticle` doesn't appear in an AI-related module (unrelated to `admin.cms.tsx`), no change is needed — this task's changes don't touch that file. Only update it if it specifically asserts something about `admin.cms.tsx`'s import list.

- [ ] **Step 3: Add a contract test proving the wiring actually happened**

Create `src/routes/admin.cms-revision-wiring.contract.test.mjs`:

```javascript
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "src/routes/admin.cms.tsx"), "utf8");

test("estate and article editing calls the CMS revision engine, not the old direct-write path", () => {
  assert.match(source, /from "@\/lib\/neon\/admin-cms"/);
  assert.match(source, /saveAdminCmsDraft/);
  assert.match(source, /publishAdminCmsRevision/);
  assert.match(source, /restoreAdminCmsRevision/);
  assert.match(source, /archiveAdminCmsResource/);
  assert.doesNotMatch(source, /saveAdminEstate\b/);
  assert.doesNotMatch(source, /saveAdminArticle\b/);
});

test("video, FAQ, and media still use the old admin-data.ts direct-write path", () => {
  assert.match(source, /saveAdminCmsVideo/);
  assert.match(source, /saveAdminFaq/);
  assert.match(source, /updateAdminMediaAsset/);
  assert.match(source, /checkAdminFaqConflicts/);
  assert.match(source, /deleteAdminFaq/);
});

test("ArticleDialog no longer exposes a manual published toggle", () => {
  const start = source.indexOf("function ArticleDialog(");
  assert.notEqual(start, -1);
  const end = source.indexOf("\nfunction ", start + 1);
  const articleDialogBody = source.slice(start, end === -1 ? undefined : end);
  assert.doesNotMatch(articleDialogBody, /published_at/);
  assert.doesNotMatch(
    articleDialogBody,
    /checked=\{article\.published\}/,
    "the manual 發布 Switch must be removed -- publish is now an explicit action, not a form field",
  );
});
```

- [ ] **Step 4: Register the new test file**

Add `src/routes/admin.cms-revision-wiring.contract.test.mjs` to `test:cms` in `package.json`.

- [ ] **Step 5: Run test to verify it fails, then passes**

Run: `node --test src/routes/admin.cms-revision-wiring.contract.test.mjs`
Expected: written correctly against the already-completed Task 3/4 changes, this should PASS immediately (Tasks 3-4 already implemented the wiring) — if any assertion fails, it means Task 3 or 4 has a gap; fix that task, don't weaken this test.

- [ ] **Step 6: Run the full test-wiring guard**

Run: `node --test src/test-wiring.test.mjs`
Expected: PASS (confirms the new test file is registered in a script).

- [ ] **Step 7: Commit**

```bash
git add src/lib/neon/admin-cms.ts src/routes/admin.cms-revision-wiring.contract.test.mjs package.json
git commit -m "test(admin): lock in estate/article CMS revision-engine wiring, update stale UNREACHABLE comment"
```

---

## Final verification for P6b

Run: `npm run test:cms && npm run test:command-center && npm run test:content-copilot && npx tsc --noEmit && npm run lint`

All must pass. `tsc --noEmit`'s error count must be at or below this repo's current recorded baseline. Lint's error count must not increase from the baseline recorded in `CHANGELOG.md`/the P5 memory (301, as of this plan's writing).

## Acceptance

- Estates and articles: create → save as draft (confirm no live-site change) → publish (confirm it goes live) → edit and publish again (confirm the prior version becomes `superseded` and shows in 版本紀錄) → archive (confirm it comes off the live site) → restore an old revision and publish (confirm it's live again with that revision's content) — all without a deploy.
- An `agent`-role staff member can save a draft but the 發布/還原 controls are hidden for them (and the server independently 403s if attempted directly).
- `ArticleDialog` no longer exposes a manually-editable 發布 toggle or 發布時間 field.
- Video, FAQ, and media are untouched — still work exactly as before this phase.
- `admin-cms.ts`'s top comment no longer falsely claims the module is uncalled.
