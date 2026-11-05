import { expect, test } from "bun:test";
import { validateCategoryKey } from "./validation";
import { selectBlogArticles, resolveBlogHeading } from "./presentation";
import { blogCategorySchema, blogSettingsSchema } from "./write-schemas";
import type { ArticleSummary } from "./types";

const article = (id: string, fields: Partial<ArticleSummary> = {}): ArticleSummary => ({
  id,
  slug: id,
  title: id,
  excerpt: null,
  categoryId: "a",
  published: true,
  publishedAt: "2026-01-01T00:00:00Z",
  createdAt: "2025-01-01T00:00:00Z",
  coverImage: null,
  coverAlt: null,
  ...fields,
});
test("decoded category keys remain exact, without trimming or Unicode normalization", () => {
  for (const key of ["成交分析", " a ", "e\u0301", "Estate"])
    expect(validateCategoryKey(key)).toBe(key);
});
test("new keys reject empty, controls and URL delimiters without decoding again", () => {
  for (const key of [
    "全部",
    "",
    "  ",
    "\n",
    "a\u007fb",
    "a\u0085b",
    "a/b",
    "a?b",
    "a#b",
    "a&b",
    "a=b",
    "%E6",
    "a+b",
    "a:b",
    "a\\b",
  ])
    expect(() => validateCategoryKey(key)).toThrow();
});

test("category blank copy follows current name while main copy is independently required", () => {
  const id = "70000000-0000-4000-8000-000000002001";
  const copy = { heading: "", introduction: "", seoTitle: null, seoDescription: null };
  const category = {
    ...copy,
    key: "成交分析",
    name: "新名稱",
    navigationOrder: 0,
    hidden: false,
    version: 0,
    settingsVersion: 0,
  };
  expect(blogCategorySchema.parse(category).heading).toBe("");
  expect(() => blogCategorySchema.parse({ ...category, key: "全部" })).toThrow();
  const scope = { kind: "category" as const, categoryId: id };
  expect(blogSettingsSchema.parse({ ...copy, scope, featuredIds: [], version: 1 }).heading).toBe(
    "",
  );
  expect(() =>
    blogSettingsSchema.parse({ ...copy, scope: { kind: "main" }, featuredIds: [], version: 1 }),
  ).toThrow();
  expect(resolveBlogHeading(scope, "  ", "新名稱")).toBe("新名稱");
  expect(resolveBlogHeading(scope, "已設定", "新名稱")).toBe("已設定");
  expect(resolveBlogHeading({ kind: "main" }, "主頁", "新名稱")).toBe("主頁");
});
test("duplicate featured identities fail even when missing from articles", () => {
  expect(() => selectBlogArticles({ kind: "main" }, ["missing", "missing"], [])).toThrow();
});
test("main and category features are independent and preserve configured order", () => {
  const rows = [
    article("1"),
    article("2"),
    article("3", { categoryId: "b" }),
    article("4", { categoryId: null }),
    article("5", { published: false }),
  ];
  const main = selectBlogArticles({ kind: "main" }, ["3", "2", "5", "missing"], rows);
  expect(main.featured.map((x) => x.id)).toEqual(["3", "2"]);
  expect(main.regular.map((x) => x.id)).toEqual(["1", "4"]);
  const category = selectBlogArticles({ kind: "category", categoryId: "a" }, ["1", "3", "5"], rows);
  expect(category.featured.map((x) => x.id)).toEqual(["1"]);
  expect(category.regular.map((x) => x.id)).toEqual(["2"]);
});
test("regular ordering is publication date descending, null last, creation descending then id ascending", () => {
  const rows = [
    article("z", { publishedAt: null }),
    article("b"),
    article("a"),
    article("new-created", { createdAt: "2025-12-01T00:00:00Z" }),
    article("new-published", { publishedAt: "2026-02-01T00:00:00Z" }),
    article("null-new", { publishedAt: null, createdAt: "2026-01-01T00:00:00Z" }),
  ];
  const original = rows.map((x) => x.id);
  expect(selectBlogArticles({ kind: "main" }, [], rows).regular.map((x) => x.id)).toEqual([
    "new-published",
    "new-created",
    "a",
    "b",
    "null-new",
    "z",
  ]);
  expect(rows.map((x) => x.id)).toEqual(original);
});

test("future published entries are excluded from featured and regular selections", () => {
  const future = article("future", { publishedAt: "2999-01-01T00:00:00Z" });
  expect(selectBlogArticles({ kind: "main" }, ["future"], [future, article("due")])).toEqual({
    featured: [],
    regular: [article("due")],
  });
});
