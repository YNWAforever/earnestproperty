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

test("both dialogs offer a distinct save-draft and publish action", () => {
  assert.match(source, /handleSaveEstateDraft/);
  assert.match(source, /handlePublishEstate/);
  assert.match(source, /handleSaveArticleDraft/);
  assert.match(source, /handlePublishArticle/);
});

test("both dialogs offer restore and archive actions", () => {
  assert.match(source, /handleRestoreEstateRevision/);
  assert.match(source, /handleArchiveEstate/);
  assert.match(source, /handleRestoreArticleRevision/);
  assert.match(source, /handleArchiveArticle/);
});
