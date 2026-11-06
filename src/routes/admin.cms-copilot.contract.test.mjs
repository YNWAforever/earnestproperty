import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("every supported CMS dialog embeds the shared Copilot and preserves save handlers", () => {
  const source = readFileSync("src/routes/admin.cms.tsx", "utf8");

  assert.match(source, /import \{ AdminContentCopilot \}/);
  for (const type of ["estate", "faq", "video"]) {
    assert.match(source, new RegExp(`resourceType="${type}"`));
  }
  assert.match(source, /onSubmit=\{handleSaveEstateDraft\}/);
  const article = readFileSync("src/components/admin/blog/ArticleEditor.tsx", "utf8");
  const manager = readFileSync("src/components/admin/blog/BlogManager.tsx", "utf8");
  assert.match(source, /<BlogManager/);
  assert.match(article, /resourceType="article"/);
  assert.match(article, /<AdminContentCopilot/);
  assert.match(article, /applyArticleCopilotPatch\(value, suggestion\)/);
  assert.match(manager, /api\.saveBlogArticle/);
  assert.match(source, /onSubmit=\{handleSaveFaq\}/);
  assert.match(source, /onSubmit=\{handleSaveCmsVideo\}/);
});

test("CMS Copilot panels provide current full-resource fingerprints without widening display values", () => {
  const source = readFileSync("src/routes/admin.cms.tsx", "utf8");
  const panel = readFileSync("src/components/admin/AdminContentCopilot.tsx", "utf8");

  for (const name of ["estate", "faq", "cmsVideo"]) {
    assert.match(source, new RegExp(`${name}FingerprintValues`));
  }
  assert.match(source, /fingerprintValues=\{fingerprintValues\}/);
  const article = readFileSync("src/components/admin/blog/ArticleEditor.tsx", "utf8");
  assert.match(article, /values=\{articleCopilotValues\(value\)\}/);
  assert.match(
    article,
    /fingerprintValues=\{\{[\s\S]*?\.\.\.value,[\s\S]*?editState: record\?\.editState/,
  );
  assert.match(panel, /fingerprintValues\?: Record<string, unknown>/);
  assert.match(panel, /buildContentFingerprint\(fingerprintValues \?\? values\)/);
});

test("CMS Copilot keeps browser form drift separate from the server-owned record fingerprint", () => {
  const panel = readFileSync("src/components/admin/AdminContentCopilot.tsx", "utf8");

  assert.match(panel, /proposalClientFingerprint/);
  assert.match(panel, /setProposalClientFingerprint\(generationFingerprint\)/);
  assert.match(panel, /sourceFingerprint: proposalClientFingerprint/);
  assert.doesNotMatch(panel, /sourceFingerprint: proposal\.sourceFingerprint/);
});
