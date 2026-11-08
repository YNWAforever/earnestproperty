import { describe, expect, test } from "bun:test";
import { blogArticles } from "../../content/blog-articles";
import {
  convertLegacyBody,
  validateArticleBody,
  validateSupplementalLinks,
  validateEditorialMetadata,
} from "./content";
import { convertRegistryArticle } from "./registry-content";
import { articleEditorSchema } from "./editor-schema";

const rich = (content: unknown[]) => ({
  format: "editor-json-v1" as const,
  document: { type: "doc", content },
});
const text = (value: string) => ({ type: "text", text: value });
const paragraph = (value: string) => ({ type: "paragraph", content: [text(value)] });

// Only normalize editor-added null attributes and mark ordering. Preserve all
// text, node ordering, attributes with values, media and structural boundaries.
function normalizeEditorJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeEditorJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (key === "attrs") {
        const attrs = Object.fromEntries(
          Object.entries(item as Record<string, unknown>).filter(([, attr]) => attr !== null),
        );
        return Object.keys(attrs).length ? [[key, attrs]] : [];
      }
      if (key === "marks" && Array.isArray(item)) {
        return [
          [
            key,
            item
              .map(normalizeEditorJson)
              .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
          ],
        ];
      }
      return [[key, normalizeEditorJson(item)]];
    }),
  );
}

describe("article body contracts", () => {
  test("legacy strings remain literal, including markup, whitespace and JSON-looking text", () => {
    for (const value of [
      "  第一段\r\n\r\n第二段  ",
      "<script>alert(1)</script>",
      '{"type":"doc"}',
      "",
    ]) {
      expect(validateArticleBody(convertLegacyBody(value))).toEqual({
        format: "legacy-text",
        text: value,
      });
    }
  });
  test("paragraph arrays explicitly convert to separate editor paragraphs without trimming", () => {
    expect<unknown>(convertLegacyBody([" 第一段 ", "", "第二段\n原文"])).toEqual(
      rich([paragraph(" 第一段 "), { type: "paragraph" }, paragraph("第二段\n原文")]),
    );
    expect(() => convertLegacyBody([])).not.toThrow();
  });
  test("headings, lists, links, marks and images survive schema JSON round-trip", () => {
    const original = rich([
      { type: "heading", attrs: { level: 2 }, content: [text("標題")] },
      {
        type: "orderedList",
        attrs: { start: 3 },
        content: [{ type: "listItem", content: [paragraph("三")] }],
      },
      { type: "bulletList", content: [{ type: "listItem", content: [paragraph("項目")] }] },
      {
        type: "paragraph",
        content: [
          {
            ...text("來源"),
            marks: [
              { type: "bold" },
              {
                type: "link",
                attrs: {
                  href: "https://example.com/?a=1&b=2",
                  target: "_blank",
                  rel: "noopener noreferrer",
                  class: null,
                },
              },
            ],
          },
          { type: "hardBreak" },
          {
            ...text("註"),
            marks: [{ type: "italic" }, { type: "underline" }, { type: "strike" }],
          },
        ],
      },
      { type: "blockquote", content: [paragraph("引述")] },
      { type: "horizontalRule" },
      { type: "image", attrs: { src: "/photo.jpg", alt: "屋苑", title: "原圖" } },
    ]);
    const body = validateArticleBody(original);
    if (body.format !== "editor-json-v1") throw new Error("wrong format");
    const roundTrip = articleEditorSchema.nodeFromJSON(body.document).toJSON();
    const restored = validateArticleBody({
      ...body,
      document: JSON.parse(JSON.stringify(roundTrip)),
    });
    if (restored.format !== "editor-json-v1") throw new Error("wrong format");
    expect(normalizeEditorJson(restored.document)).toEqual(normalizeEditorJson(original.document));
  });
  test.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java\nscript:alert(1)",
    "data:text/html,x",
    "vbscript:x",
    "//evil.test/x",
    "/\\evil.test",
    " https://example.com",
    "file:///x",
  ])("rejects unsafe link/image URL %s", (url) => {
    expect(() =>
      validateArticleBody(
        rich([
          {
            type: "paragraph",
            content: [{ ...text("x"), marks: [{ type: "link", attrs: { href: url } }] }],
          },
        ]),
      ),
    ).toThrow();
    expect(() => validateArticleBody(rich([{ type: "image", attrs: { src: url } }]))).toThrow();
    expect(() => validateSupplementalLinks([{ href: url, label: "x" }])).toThrow();
  });
  test.each([
    { type: "script", content: [text("alert(1)")] },
    { type: "image", attrs: { src: "/ok.jpg", onerror: "alert(1)" } },
    { type: "paragraph", attrs: { style: "color:red" } },
    { type: "heading", attrs: { level: 9 }, content: [text("x")] },
    { type: "text", text: "top-level inline" },
    { type: "bulletList", content: [paragraph("invalid child")] },
    { type: "paragraph", content: [{ ...text("x"), marks: [{ type: "unknown" }] }] },
    {
      type: "paragraph",
      content: [{ ...text("x"), marks: [{ type: "link", attrs: { href: "/ok", onclick: "x" } }] }],
    },
  ])("rejects unknown keys/nodes/marks and malformed structure %#", (node) => {
    expect(() => validateArticleBody(rich([node]))).toThrow();
  });

  test.each([3, 5, 7, 14, 28])(
    "malformed nesting depth %i has bounded linear child reads",
    (depth) => {
      for (const wrapper of ["unsupported", "blockquote"]) {
        let reads = 0;
        let node: unknown = { type: "unsupported" };
        for (let i = 0; i < depth; i++) {
          const child = node;
          node = {
            type: wrapper,
            get content() {
              reads++;
              return [child];
            },
          };
        }
        const start = performance.now();
        expect(() => validateArticleBody(rich([node]))).toThrow();
        const elapsed = performance.now() - start;
        console.info(
          JSON.stringify({
            probe: "malformed-nesting",
            depth,
            wrapper,
            reads,
            milliseconds: Number(elapsed.toFixed(3)),
          }),
        );
        // One bounded-input walk plus one dispatched schema walk, with slack for
        // parser field reads. A union exploring all recursive alternatives fails.
        expect(reads).toBeLessThanOrEqual(4 * (depth + 1));
      }
    },
  );

  test("rejects malformed envelopes, oversized/deep/cyclic documents", () => {
    for (const body of [
      null,
      { format: "html", text: "x" },
      { format: "legacy-text", text: "x", document: {} },
      rich([]),
    ]) {
      expect(() => validateArticleBody(body as never)).toThrow();
    }
    let nested: unknown = paragraph("x");
    for (let i = 0; i < 50; i++) nested = { type: "blockquote", content: [nested] };
    expect(() => validateArticleBody(rich([nested]))).toThrow();
    const cycle: { type: string; content: unknown[] } = { type: "blockquote", content: [] };
    cycle.content.push(cycle);
    expect(() => validateArticleBody(rich([cycle]))).toThrow();
    expect(() => validateArticleBody(rich([paragraph("x".repeat(1_000_001))]))).toThrow();
  });
  test("supplementary links retain labels/order independently of body and reject extra keys", () => {
    const links = [
      { href: "/estate/a", label: "屋苑" },
      { href: "https://example.com", label: "來源" },
    ];
    expect(validateSupplementalLinks(links)).toEqual(links);
    expect(() => validateSupplementalLinks([{ ...links[0], onclick: "bad" }])).toThrow();
  });
  test("metadata is typed JSON, rejects unexpected keys and unsafe comparison identifiers", () => {
    const value = {
      author: "作者",
      reviewer: null,
      sourcesNote: "來源",
      answerSummary: "摘要",
      compareEstateSlugs: ["bellagio"],
    };
    expect(validateEditorialMetadata(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(() => validateEditorialMetadata({ ...value, html: "<script>" })).toThrow();
    expect(() => validateEditorialMetadata({ ...value, compareEstateSlugs: ["../bad"] })).toThrow();
  });
  test("every registry article preserves sections, links, metadata and schedule without mutation", () => {
    const before = JSON.stringify(blogArticles);
    for (const article of blogArticles) {
      const converted = convertRegistryArticle(article);
      expect(converted.slug).toBe(article.slug);
      expect(converted.title).toBe(article.title);
      expect(converted.categoryKey).toBe(article.category);
      expect(converted.readingMinutes).toBe(article.readingMinutes);
      expect(converted.publishedAt).toBe(article.publishedAt ?? null);
      expect(converted.links).toEqual([...article.links]);
      expect(converted.editorial).toEqual({
        author: article.author,
        reviewer: article.reviewer,
        sourcesNote: article.sourcesNote,
        answerSummary: article.answerSummary,
        compareEstateSlugs: [...(article.compareEstateSlugs ?? [])],
      });
      expect<unknown>(converted.body).toEqual(
        rich(
          article.sections.flatMap((section) => [
            { type: "heading", attrs: { level: 2 }, content: [text(section.heading)] },
            ...section.paragraphs.map(paragraph),
          ]),
        ),
      );
      expect(validateArticleBody(JSON.parse(JSON.stringify(converted.body)))).toEqual(
        converted.body,
      );
    }
    expect(JSON.stringify(blogArticles)).toBe(before);
  });
  test("null dates remain null and future dates are never promoted by conversion", () => {
    const source = { ...blogArticles[0], publishedAt: undefined };
    expect(convertRegistryArticle(source).publishedAt).toBeNull();
    expect(
      convertRegistryArticle({ ...source, publishedAt: "2099-01-01T00:00:00.000Z" }).publishedAt,
    ).toBe("2099-01-01T00:00:00.000Z");
    const row = { publishedAt: null, body: "literal" };
    convertLegacyBody(row.body);
    expect(row.publishedAt).toBeNull();
  });
});
