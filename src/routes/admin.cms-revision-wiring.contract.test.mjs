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

const editor = readFileSync(
  join(process.cwd(), "src/components/admin/blog/ArticleEditor.tsx"),
  "utf8",
);
const manager = readFileSync(
  join(process.cwd(), "src/components/admin/blog/BlogManager.tsx"),
  "utf8",
);
test("Articles entry delegates to the role-aware blog manager", () => {
  assert.match(source, /<BlogManager canPublish=/);
  assert.match(manager, /saveBlogArticle/);
  assert.match(manager, /getBlogCategoryOptions/);
  assert.match(editor, /儲存草稿/);
  assert.match(editor, /更新已發布文章/);
  assert.match(editor, /取消發布/);
  assert.doesNotMatch(editor, /checked=\{.*published/);
});
test("both editors preserve restore and publication confirmation", () => {
  assert.match(source, /handleRestoreEstateRevision/);
  assert.match(source, /handleArchiveEstate/);
  assert.match(editor, /restoreAdminCmsRevision/);
  assert.match(editor, /CmsRestoreConfirm/);
  assert.match(editor, /AdminConfirmDialog/);
  assert.match(editor, /reviewDraftRevisionId/);
});
