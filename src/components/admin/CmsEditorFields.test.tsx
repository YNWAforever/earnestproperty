import { cmsEditorHasChanges } from "./cms-editor-state";
import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { CmsDistrictSelect, CmsImageField } from "./CmsEditorFields";
test("district select preserves unknown existing value alongside authoritative choices", () => {
  const $ = load(
    renderToStaticMarkup(
      createElement(CmsDistrictSelect, {
        value: "legacy",
        options: [{ slug: "sham-tseng", name_zh: "深井" }],
        onChange() {},
      }),
    ),
  );
  expect($('option[value="legacy"]').text()).toContain("legacy");
  expect($('option[value="sham-tseng"]').text()).toBe("深井");
});
test("image control has preview and manual URL alternative", () => {
  const $ = load(
    renderToStaticMarkup(
      createElement(CmsImageField, {
        label: "封面圖片",
        ownerType: "article",
        value: "https://example.com/photo.jpg",
        onChange() {},
      }),
    ),
  );
  expect($("img").attr("src")).toBe("https://example.com/photo.jpg");
  expect($('input[type="file"]').attr("accept")).toContain("image/avif");
  expect($('input[inputmode="url"]').val()).toBe("https://example.com/photo.jpg");
});
test("saved feedback excludes identity but detects edits made during save", () => {
  expect(cmsEditorHasChanges({ id: "new", title: "saved" }, { title: "saved" })).toBe(false);
  expect(cmsEditorHasChanges({ id: "new", title: "later edit" }, { title: "saved" })).toBe(true);
  expect(cmsEditorHasChanges({ title: "new" }, null)).toBe(true);
});

test("manual image URL accepts existing root-relative media paths", () => {
  const $ = load(
    renderToStaticMarkup(
      createElement(CmsImageField, {
        label: "屋苑主圖",
        ownerType: "estate",
        value: "/images/estate.jpg",
        onChange() {},
      }),
    ),
  );
  expect($('input[inputmode="url"]').attr("type")).toBe("text");
  expect($('input[inputmode="url"]').val()).toBe("/images/estate.jpg");
});
