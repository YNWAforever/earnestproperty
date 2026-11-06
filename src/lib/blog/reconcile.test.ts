import { test, expect } from "bun:test";
import fixture from "./fixtures/import-source.json";
import { buildImportPlan, fingerprint, candidate, inventoryArticle } from "./reconcile";
import type { Inventory } from "./reconcile";
import type { ArticleInput } from "./types";

const article = () => candidate(fixture as ArticleInput, "registry");
const inventory = (): Inventory => ({
  articles: [
    inventoryArticle("registry", article(), "https://example.invalid/blog/fixture-original-url"),
  ],
  completeSources: ["database", "registry", "public", "presentation"],
  unresolvedSources: [],
  categories: [],
  settings: [],
  sourceRevision: "fixture-source-v1",
  targetIdentity: "owned-fixture",
});
test("reserved category stays exactly inventoried and blocks cutover rather than mapping to main", () => {
  const input = inventory();
  input.categories.push({
    id: "legacy-all",
    key: "全部",
    name: "原有分類",
    heading: "",
    introduction: "",
    seoTitle: null,
    seoDescription: null,
    hidden: false,
    navigationOrder: 0,
    version: 1,
    settingsVersion: 1,
  });
  const plan = buildImportPlan(input);
  expect(plan.unresolved).toContain("reserved-category-key:全部");
  expect(plan.inventory.categories[0].key).toBe("全部");
});
test("same inputs/order give deterministic fingerprints, no invented dates or altered content", () => {
  const input = inventory(),
    plan = buildImportPlan(input);
  expect(plan.insert).toHaveLength(1);
  expect(plan.insert[0].publishedAt).toBeNull();
  expect(plan.insert[0].createdAt).toBe("");
  expect(plan.insert[0].body).toEqual(fixture.body as ArticleInput["body"]);
  expect(plan.insert[0].links).toEqual(fixture.links);
  expect(plan.insert[0].coverImage).toBe(fixture.coverImage);
  expect(plan.insert[0].editorial.compareEstateSlugs).toEqual(["bellagio", "sea-crest-villa"]);
  expect(plan.fingerprint).toBe(buildImportPlan(structuredClone(input)).fingerprint);
  expect(fingerprint({ b: 2, a: 1 })).toBe(fingerprint({ a: 1, b: 2 }));
  expect(input.articles[0].article.slugLocked).toBe(true);
});
test("draft-only database identity blocks published registry collision, never overwrites draft", () => {
  const input = inventory();
  const draft = { ...article(), id: "db-draft", published: false, version: 4 };
  input.articles.push(inventoryArticle("database", draft, input.articles[0].url));
  const plan = buildImportPlan(input);
  expect(plan.insert).toEqual([]);
  expect(plan.conflicts).toEqual([{ slug: fixture.slug, reason: "database-authoritative" }]);
  expect(plan.inventory.articles.find((a) => a.source === "database")?.article.published).toBe(
    false,
  );
});
test("missing or inaccessible source is not complete/empty; missing body is unresolved", () => {
  const input = inventory();
  input.completeSources = ["registry"];
  expect(buildImportPlan(input).unresolved).toContain("source:database");
  expect(buildImportPlan(input).unresolved).toContain("source:public");
  delete (input.articles[0].article as { body?: unknown }).body;
  input.articles[0].fingerprint = fingerprint(input.articles[0].article);
  expect(buildImportPlan(input).unresolved.some((x) => x.includes("invalid-article"))).toBe(true);
});
test("future publication, exact URL, null metadata and changed input fingerprint survive", () => {
  const input = inventory();
  input.articles[0].article.publishedAt = "2099-01-01T00:00:00.000Z";
  input.articles[0] = inventoryArticle(
    "registry",
    input.articles[0].article,
    input.articles[0].url + "?x=%2f",
  );
  const p = buildImportPlan(input);
  expect(p.insert[0].publishedAt).toBe("2099-01-01T00:00:00.000Z");
  expect(p.inventory.articles[0].url).toEndWith("?x=%2f");
  expect(p.insert[0].seoTitle).toBeNull();
  const changed = structuredClone(input);
  changed.sourceRevision = "new";
  expect(buildImportPlan(changed).fingerprint).not.toBe(p.fingerprint);
});
test("tampered source digest, duplicate slugs and reserved policy route block", () => {
  const input = inventory();
  input.articles[0].article.title = "tampered";
  expect(buildImportPlan(input).unresolved).toContain("fingerprint:registry:" + fixture.slug);
  const duplicate = inventory();
  duplicate.articles.push(structuredClone(duplicate.articles[0]));
  expect(buildImportPlan(duplicate).conflicts).toHaveLength(1);
  const policy = inventory();
  policy.articles[0] = inventoryArticle(
    "registry",
    { ...article(), slug: "editorial-standards" },
    "https://example.invalid/blog/editorial-standards",
  );
  expect(buildImportPlan(policy).insert).toEqual([]);
  expect(buildImportPlan(policy).unresolved.length).toBeGreaterThan(0);
});
