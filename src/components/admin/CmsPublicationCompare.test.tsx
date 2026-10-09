import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { CmsCompareResult } from "./CmsPublicationCompare";

function render(props: Parameters<typeof CmsCompareResult>[0]) {
  return load(renderToStaticMarkup(createElement(CmsCompareResult, props)));
}

test("compare is a field table with only the differing fields, in the form's labels", () => {
  const $ = render({
    resourceType: "estate",
    published: { slug: "sea-view", name_zh: "海景花園", facilities: ["會所"], lat: 22.1 },
    version: 3,
    local: { slug: "sea-view", name_zh: "海景花園二期", facilities: [], lat: 22.2, id: "x" },
  });
  expect($("h3").text()).toBe("與已發布版本 v3 比較");
  expect(
    $("thead th")
      .map((_, el) => $(el).text())
      .get(),
  ).toEqual(["欄位", "已發布版本", "目前表單"]);
  const rows = $("tbody tr")
    .map((_, el) =>
      $(el)
        .find("th, td")
        .map((__, cell) => $(cell).text())
        .get()
        .join("|"),
    )
    .get();
  expect(rows).toEqual(["中文名|海景花園|海景花園二期", "設施|會所|（空白）"]);
  expect($.text()).toContain("另有 1 項系統欄位不同。");
  expect($.text()).not.toContain("{");
});

test("a never-published record lists every form field", () => {
  const $ = render({
    resourceType: "article",
    published: null,
    version: null,
    local: { slug: "guide", title: "置業指南" },
  });
  expect($.text()).toContain("此內容尚未發布，以下列出目前表單的所有欄位。");
  expect($("tbody tr").length).toBe(2);
});

test("identical content says so instead of an empty table", () => {
  const $ = render({
    resourceType: "article",
    published: { slug: "guide", title: "置業指南" },
    version: 1,
    local: { slug: "guide", title: "置業指南" },
  });
  expect($.text()).toContain("目前表單與已發布版本相同。");
  expect($("table").length).toBe(0);
});

test("long values clamp to three lines with a 顯示全部 toggle", () => {
  const long = "長".repeat(400);
  const $ = render({
    resourceType: "article",
    published: { content: "短" },
    version: 2,
    local: { content: long },
  });
  expect($(".line-clamp-3").length).toBe(1);
  expect($("button").text()).toBe("顯示全部");
});
