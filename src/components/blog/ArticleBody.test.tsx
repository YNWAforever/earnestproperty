import { expect, test } from "bun:test";
import { load } from "cheerio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArticleBody } from "./ArticleBody";
import { convertLegacyBody } from "../../lib/blog/content";
import type { ArticleBody as Body } from "../../lib/blog/types";

const render = (body: Body, links = [{ href: "/estate/a", label: "屋苑資料" }]) =>
  load(renderToStaticMarkup(createElement(ArticleBody, { body, links })));

test("rich section anchors preserve existing ASCII and Chinese article fragments", () => {
  const $ = render({
    format: "editor-json-v1",
    document: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Overview" }] },
        { type: "paragraph", content: [{ type: "text", text: "正文" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "屋苑比較" }] },
      ],
    },
  });
  expect($("h2#overview-0")).toHaveLength(1);
  expect($("h2#section-1")).toHaveLength(1);
});

test("legacy HTML-looking text is escaped literally, preserving whitespace and supplemental links", () => {
  const value = "  <script>alert(1)</script>\r\n<img src=x onerror=alert(1)>  ";
  const $ = render(convertLegacyBody(value));
  // HTML parsers normalize CRLF; the emitted HTML and stored body retain the original bytes.
  expect(
    renderToStaticMarkup(createElement(ArticleBody, { body: convertLegacyBody(value), links: [] })),
  ).toContain("\r\n");
  expect($("[data-article-body]").text()).toBe(value.replace(/\r\n/g, "\n"));
  expect($("script,img")).toHaveLength(0);
  expect($("[data-article-body]").attr("style")).toContain("white-space:pre-wrap");
  expect($("a").attr("href")).toBe("/estate/a");
  expect($("a").text()).toBe("屋苑資料");
});

test("renders allowed semantic markup without interpreting text as HTML", () => {
  const $ = render({
    format: "editor-json-v1",
    document: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "標題" }] },
        {
          type: "orderedList",
          attrs: { start: 3 },
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "項目" }] }],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "<b>來源</b>",
              marks: [
                { type: "bold" },
                {
                  type: "link",
                  attrs: { href: "https://example.com", target: "_blank", rel: "opener" },
                },
              ],
            },
            { type: "hardBreak" },
            { type: "text", text: "次行" },
          ],
        },
        { type: "image", attrs: { src: "/photo.jpg", alt: "屋苑", title: "原圖" } },
      ],
    },
  });
  expect($("h2").text()).toBe("標題");
  expect($("ol").attr("start")).toBe("3");
  expect($("ol li").text()).toBe("項目");
  expect($("strong").text()).toBe("<b>來源</b>");
  expect($("b")).toHaveLength(0);
  expect($("br")).toHaveLength(1);
  expect($("img").attr("src")).toBe("/photo.jpg");
  expect($("img").attr("alt")).toBe("屋苑");
  expect($('a[href="https://example.com"]').attr("rel")).toBe("noopener noreferrer");
});

test("renderer validates untrusted input itself and fails closed for scripts and event attributes", () => {
  for (const node of [
    { type: "script" },
    { type: "image", attrs: { src: "/x", onerror: "alert(1)" } },
    { type: "image", attrs: { src: "data:image/svg+xml,<svg onload='alert(1)'/>" } },
  ]) {
    expect(() =>
      render({ format: "editor-json-v1", document: { type: "doc", content: [node] } }),
    ).toThrow();
  }
  expect(() =>
    render(convertLegacyBody("safe"), [{ href: "javascript:alert(1)", label: "bad" }]),
  ).toThrow();
});
