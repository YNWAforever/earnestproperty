import { expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";

// The real dialog portals into document.body, which a static render never reaches.
// This stand-in prints exactly what the dialog would show and wires confirm.
mock.module("@/components/admin/AdminConfirmDialog", () => ({
  AdminConfirmDialog: (props: {
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    children?: ReactNode;
  }) =>
    props.open
      ? createElement(
          "section",
          { "data-dialog": "" },
          createElement("h2", null, props.title),
          createElement("p", { "data-description": "" }, props.description),
          props.children,
          createElement("button", { type: "button" }, props.confirmLabel),
        )
      : null,
}));

const { CmsRestoreConfirm } = await import("./CmsRestoreConfirm");

const target = {
  id: "rev-2",
  versionNumber: 2,
  state: "superseded" as const,
  createdAt: "2026-10-01T02:30:00.000Z",
  createdBy: "staff-a",
};
const savedDraft = {
  id: "rev-5",
  versionNumber: 5,
  state: "draft" as const,
  createdAt: "2026-10-08T09:15:00.000Z",
  createdBy: "staff-me",
};
const savedPayload = { slug: "sea-view", name_zh: "海景花園", seo_title: "舊標題", area_min: 500 };

function render(props: Partial<Parameters<typeof CmsRestoreConfirm>[0]> = {}) {
  return load(
    renderToStaticMarkup(
      createElement(CmsRestoreConfirm, {
        resource: "estate",
        revision: target,
        savedPayload,
        openingForm: null,
        form: { ...savedPayload, id: "estate-1" },
        savedDraft: null,
        onOpenChange() {},
        onConfirm() {},
        ...props,
      }),
    ),
  );
}

test("lists the unsaved fields and the draft that will be replaced", () => {
  const $ = render({
    form: { ...savedPayload, id: "estate-1", name_zh: "海景花園二期", seo_title: "新標題" },
    savedDraft,
  });
  expect($("h2").text()).toBe("還原此版本？");
  expect($("[data-description]").text()).toBe(
    "還原會以 v2（已被取代，01/10/2026 10:30）的內容建立新草稿。以下內容會被取代：",
  );
  const items = $("li")
    .map((_, el) => $(el).text())
    .get();
  expect(items).toEqual([
    "目前表單內未儲存的修改：中文名、SEO 標題",
    "你已儲存的草稿 v5（08/10/2026 17:15）",
  ]);
  expect($("button").text()).toBe("還原");
});

test("says 目前沒有未儲存的修改 when the form is clean", () => {
  const $ = render();
  const items = $("li")
    .map((_, el) => $(el).text())
    .get();
  expect(items).toEqual(["目前沒有未儲存的修改。"]);
});

test("unsaved changes to unlabelled fields are still counted, never reported as clean", () => {
  const $ = render({ form: { ...savedPayload, id: "estate-1", lat: 22.3 } });
  const items = $("li")
    .map((_, el) => $(el).text())
    .get();
  expect(items).toEqual(["另有 1 項系統欄位不同。"]);
});

test("before the saved draft has loaded, only edits since the record was opened are listed", () => {
  // The 內容中心 dialog can show history before its saved payload has matched the open
  // record. The form as it was opened is then the baseline, never an empty record.
  const opened = { ...savedPayload, id: "estate-1" };
  const clean = render({ savedPayload: null, openingForm: opened, form: { ...opened } });
  expect(
    clean("li")
      .map((_, el) => clean(el).text())
      .get(),
  ).toEqual(["目前沒有未儲存的修改。"]);
  const edited = render({
    savedPayload: null,
    openingForm: opened,
    form: { ...opened, name_zh: "海景花園二期" },
  });
  expect(
    edited("li")
      .map((_, el) => edited(el).text())
      .get(),
  ).toEqual(["目前表單內未儲存的修改：中文名"]);
});

test("a saved payload, when present, is the baseline rather than the opening form", () => {
  const $ = render({
    openingForm: { ...savedPayload, name_zh: "開啟時的名稱" },
    form: { ...savedPayload, id: "estate-1" },
  });
  expect(
    $("li")
      .map((_, el) => $(el).text())
      .get(),
  ).toEqual(["目前沒有未儲存的修改。"]);
});

test("renders nothing until a version is chosen", () => {
  expect(
    renderToStaticMarkup(
      createElement(CmsRestoreConfirm, {
        resource: "article",
        revision: null,
        savedPayload: null,
        form: {},
        savedDraft: null,
        onOpenChange() {},
        onConfirm() {},
      }),
    ),
  ).toBe("");
});
