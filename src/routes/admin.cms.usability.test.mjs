import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const source = readFileSync(new URL("./admin.cms.tsx", import.meta.url), "utf8");
test("server search empty state describes full category and retains clear action", () => {
  const snippet = source.slice(
    source.indexOf("function NoSearchMatch("),
    source.indexOf("function Field("),
  );
  const js = ts.transpileModule(snippet, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const Empty = ({ title, description, action }) =>
    React.createElement("section", null, title, description, action);
  const Button = ({ children, ...props }) => React.createElement("button", props, children);
  const Component = new Function(
    "React",
    "AdminEmptyState",
    "Button",
    js + "; return NoSearchMatch;",
  )(React, Empty, Button);
  const html = renderToStaticMarkup(
    React.createElement(Component, { label: "文章", query: "fixture", onClear() {} }),
  );
  assert.match(html, /搜尋涵蓋.*全部/);
  assert.doesNotMatch(html, /只涵蓋本頁|在已載入/);
  assert.match(html, /清除搜尋/);
});
test("both revision editors have saved payload tracking and explicit confirmation", () => {
  for (const kind of ["Estate", "Article"]) {
    const body = source
      .slice(
        source.indexOf(`function ${kind}Dialog(`),
        source.indexOf(`function ${kind}Dialog(`) + 15000,
      )
      .split("\nfunction ")[0];
    assert.match(body, /savedPayload/);
    assert.match(body, /confirmingPublish/);
    assert.match(body, /CmsPublicationCompare/);
    assert.match(body, /useDirtyCloseGuard/);
  }
});

test("upload pending disables all editor actions and replaces saved feedback", () => {
  const snippet = source.slice(
    source.indexOf("function CmsPublishFooter("),
    source.indexOf("const CMS_REVISION_STATE_LABELS"),
  );
  const js = ts.transpileModule(snippet, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const Button = ({ children, ...props }) => React.createElement("button", props, children);
  const Footer = new Function(
    "React",
    "DialogFooter",
    "Button",
    "Save",
    "Upload",
    js + "; return CmsPublishFooter;",
  )(
    React,
    "footer",
    Button,
    () => null,
    () => null,
  );
  const props = {
    formId: "cms-estate-form",
    dirty: false,
    hasSaved: true,
    saving: false,
    publishing: false,
    onClose() {},
    onPublish() {},
  };
  const pending = renderToStaticMarkup(React.createElement(Footer, { ...props, uploading: true }));
  assert.equal((pending.match(/disabled=""/g) ?? []).length, 3);
  assert.match(pending, /上載中/);
  assert.doesNotMatch(pending, /目前內容已儲存/);
  const settled = renderToStaticMarkup(React.createElement(Footer, { ...props, uploading: false }));
  assert.doesNotMatch(settled, /disabled=""/);
});

test("estate and article close guards and submit paths include pending upload", () => {
  for (const kind of ["Estate", "Article"]) {
    const body = source.slice(source.indexOf(`function ${kind}Dialog(`)).split("\nfunction ")[0];
    assert.match(body, /isDirty: isDirty \|\| imageUploading/);
    assert.match(body, /onUploadingChange=\{setImageUploading\}/);
    assert.match(body, /uploading=\{imageUploading\}/);
    assert.match(body, /if \(imageUploading\)/);
  }
});

test("image upload reports pending until success or failure and applies only successful URL", async () => {
  const imageSource = readFileSync(
    new URL("../components/admin/CmsEditorFields.tsx", import.meta.url),
    "utf8",
  );
  const snippet = imageSource
    .slice(imageSource.indexOf("export function CmsImageField"))
    .replace("export function", "function");
  const js = ts.transpileModule(snippet, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const fails of [false, true]) {
    let settle;
    const pending = new Promise((resolve, reject) => {
      settle = () =>
        fails ? reject(new Error("fixture upload failed")) : resolve({ url: "/images/new.jpg" });
    });
    const states = [],
      values = [];
    const Component = new Function(
      "React",
      "useState",
      "useRef",
      "useEffect",
      "Input",
      "uploadAdminMedia",
      js + ";return CmsImageField;",
    )(
      React,
      (initial) => [initial, () => {}],
      (initial) => ({ current: initial }),
      (effect) => effect(),
      "input",
      () => pending,
    );
    const tree = Component({
      label: "封面圖片",
      value: "/images/old.jpg",
      ownerType: "article",
      onChange: (value) => values.push(value),
      onUploadingChange: (value) => states.push(value),
    });
    function findFile(node) {
      if (!node || typeof node !== "object") return null;
      if (node.type === "input" && node.props.type === "file") return node;
      for (const child of React.Children.toArray(node.props?.children)) {
        const found = findFile(child);
        if (found) return found;
      }
      return null;
    }
    const upload = findFile(tree).props.onChange({
      target: { files: [{ name: "fixture.png" }], value: "fixture.png" },
    });
    assert.deepEqual(states, [true]);
    assert.deepEqual(values, []);
    settle();
    await upload;
    assert.deepEqual(states, [true, false]);
    assert.deepEqual(values, fails ? [] : ["/images/new.jpg"]);
  }
});

// FX-11a (E-10): the rebuild runs as the ai.knowledge.rebuild background job, and the
// admin copy no longer promises an in-request rebuild or a "front-end AI" that cites
// stale chunks.
test("FAQ import no longer rebuilds in-request and the rebuild button reports a queued job", () => {
  const body = (name) => {
    const start = source.indexOf(`async function ${name}(`);
    assert.notEqual(start, -1, `Expected to find ${name}`);
    const end = source.slice(start).search(/\r?\n {2}\}\r?\n/);
    assert.notEqual(end, -1, `Expected ${name} to close`);
    return source.slice(start, start + end);
  };
  assert.doesNotMatch(body("handleImportFaqs"), /rebuildAdminAiKnowledge/);
  assert.match(body("handleRebuildKnowledge"), /已排程重建 AI 知識庫/);
  assert.doesNotMatch(source, /前台 AI\s*仍會引用舊資料/);
  assert.doesNotMatch(source, /重建 live agent 知識庫/);
});

test("restore asks first and is hidden on draft rows and for agents", () => {
  assert.doesNotMatch(source, /onClick=\{\(\) => onRestoreRevision\(/);
  const history = source.slice(
    source.indexOf("function CmsRevisionHistory("),
    source.indexOf("function KnowledgeMetric("),
  );
  assert.match(history, /canRestore: boolean/);
  assert.match(history, /onRequestRestore: \(revision: CmsRevisionSummary\) => void/);
  const guard = history.indexOf('canRestore && revision.state !== "draft"');
  assert.ok(guard > 0, "還原 must render only for restorers on non-draft rows");
  const button = history.indexOf("還原", guard);
  assert.ok(button > guard, "the 還原 button sits inside the guard");
  assert.match(history.slice(guard, button), /onClick=\{\(\) => onRequestRestore\(revision\)\}/);
  for (const kind of ["Estate", "Article"]) {
    const body = source.slice(source.indexOf(`function ${kind}Dialog(`)).split("\nfunction ")[0];
    assert.match(body, /useCmsCanRestore\(\)/, `${kind} reads the staff session role`);
    assert.match(body, /<CmsRestoreConfirm/, `${kind} confirms before restoring`);
    assert.match(
      body,
      /savedDraft=\{revisions\?\.find\(\(revision\) => revision\.state === "draft"\)/,
    );
  }
  const estateEditor = readFileSync(
    new URL("../components/admin/estates/AdminEstateEditorForm.tsx", import.meta.url),
    "utf8",
  );
  assert.match(estateEditor, /<CmsRestoreConfirm/);
  assert.doesNotMatch(estateEditor, /還原會以該版本內容建立新草稿，並覆蓋目前表單內未儲存的修改。/);
  assert.match(estateEditor, /canRestore && revision\.state !== "draft"/);
});

test("compare no longer prints raw JSON", () => {
  const compare = readFileSync(
    new URL("../components/admin/CmsPublicationCompare.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(compare, /JSON\.stringify\(comparison\.published/);
  assert.match(compare, /cmsFieldDiff\(/);
  assert.match(compare, /與已發布版本比較/);
  assert.match(compare, /複製本機修改（備份）/);
  assert.match(compare, /本機修改備份（可複製）/);
  assert.doesNotMatch(compare, /比較目前發布版本（保留本機修改）/);
});

test("restore baseline is never null while a record is open, and the dialog closes rather than unmounting", () => {
  for (const kind of ["Estate", "Article"]) {
    const body = source.slice(source.indexOf(`function ${kind}Dialog(`)).split("\nfunction ")[0];
    assert.match(body, /useOpeningSnapshot\(/, `${kind} keeps the form as it was opened`);
    assert.match(body, /openingForm=\{opening/);
  }
  const confirm = readFileSync(
    new URL("../components/admin/CmsRestoreConfirm.tsx", import.meta.url),
    "utf8",
  );
  assert.match(confirm, /open=\{revision !== null\}/);
  assert.doesNotMatch(confirm, /\n\s+open\n/);
  for (const [file, phrase] of [
    ["../components/admin/admin-error-text.ts", "請使用與已發布版本比較。"],
    ["./admin.cms.tsx", "請先與已發布版本比較並核對內容。"],
  ]) {
    const text = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(text.includes(phrase), `${file} names the compare button as 與已發布版本比較`);
    assert.ok(!text.includes("比較目前發布版本"), `${file} still names the old button`);
  }
});

test("confirm dialogs hand focus back to the button that opened them", () => {
  // Checked in Chromium (FX-17a fix round 1): these dialogs open from state, with no
  // AlertDialogTrigger, so without this Radix drops focus on <body> instead of on 還原.
  const dialog = readFileSync(
    new URL("../components/admin/AdminConfirmDialog.tsx", import.meta.url),
    "utf8",
  );
  assert.match(dialog, /onOpenAutoFocus=\{\(\) => \{[\s\S]*?openerRef\.current =/);
  assert.match(
    dialog,
    /onCloseAutoFocus=\{\(event\) => \{[\s\S]*?event\.preventDefault\(\);\s*opener\.focus\(\);/,
  );
});

test("FAQ delete says it can be restored and archived rows offer 還原", () => {
  // FX-18a Task 2 (C-12): approved copy, verbatim.
  for (const phrase of [
    'title="封存 FAQ？"',
    "確定要封存「${deletingFaq.question}」？公開頁面會即時移除此問答。經理或管理員之後可在「顯示已封存」還原。",
    'refreshAfterWrite("已封存")',
    "此 FAQ 已被封存或刪除，請重新載入頁面。",
    "顯示已封存（${archivedFaqCount}）",
    'title="還原此 FAQ？"',
    "還原後「${restoringFaq.question}」會以封存時的答案重新在公開頁面顯示。",
    'refreshAfterWrite("已還原")',
    "已封存（不會匯入）",
    "其中 ${faqImportArchived.length} 條已封存，不會匯入；如需更新，請先還原。",
  ]) {
    assert.ok(source.includes(phrase), `admin.cms.tsx is missing ${phrase}`);
  }
  assert.doesNotMatch(source, /此操作無法復原，公開頁面及 AI Agent 知識庫會即時移除此問答/);
  assert.doesNotMatch(source, /title="刪除 FAQ"/);
  // Archived rows: a badge and 還原 that opens the dialog, no 編輯.
  const table = source.slice(source.indexOf("{rows.map((faq) => ("), source.indexOf("未有 FAQ"));
  assert.match(table, /faq\.published \? \(/);
  assert.match(table, /<Badge variant="outline"[^>]*>\s*已封存\s*<\/Badge>/);
  assert.match(table, /onClick=\{\(\) => setRestoringFaq\(faq\)\}/);
  assert.doesNotMatch(table, /onClick=\{[^}]*handleRestoreFaq\(/);
  // The import loop never sends an archived question.
  const preview = source.slice(source.indexOf("const faqImportPreview = useMemo("));
  assert.match(preview.slice(0, 1500), /filter\(\(row\) => !faqImportArchivedKeys\.has\(/);

  const estateEditor = readFileSync(
    new URL("../components/admin/estates/AdminEstateEditorForm.tsx", import.meta.url),
    "utf8",
  );
  for (const phrase of [
    'title="封存 FAQ？"',
    'description="公開屋苑頁面會即時移除此問答。之後可在內容中心 › FAQ 還原。"',
    'toast.success("已封存")',
    '"未能封存，請重試。"',
    "此 FAQ 已被封存或刪除，請重新載入頁面。",
    "另有 {archivedFaqCount} 條已封存，可在內容中心 › FAQ 還原。",
  ]) {
    assert.ok(estateEditor.includes(phrase), `estate editor is missing ${phrase}`);
  }
  assert.doesNotMatch(estateEditor, /刪除後無法還原/);
});
