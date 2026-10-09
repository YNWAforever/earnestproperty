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
