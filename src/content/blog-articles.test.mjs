import assert from "node:assert/strict";
import test from "node:test";

import { BLOG_CATEGORIES, blogArticles } from "./blog-articles.ts";
import { estateRegistry } from "./estate-registry.ts";

test("every article's category is one of the named taxonomy", () => {
  for (const article of blogArticles) {
    assert.ok(
      BLOG_CATEGORIES.includes(article.category),
      `${article.slug}'s category "${article.category}" is not in BLOG_CATEGORIES`,
    );
  }
});

test("every article has at least one section (ToC needs real structure)", () => {
  for (const article of blogArticles) {
    assert.ok(article.sections.length > 0, `${article.slug} has no sections`);
    for (const section of article.sections) {
      assert.ok(section.heading.trim().length > 0, `${article.slug} has an empty section heading`);
      assert.ok(section.paragraphs.length > 0, `${article.slug}'s "${section.heading}" has no paragraphs`);
    }
  }
});

test("reviewer is null or a real non-empty name, never an empty-string placeholder", () => {
  for (const article of blogArticles) {
    assert.ok(
      article.reviewer === null || article.reviewer.trim().length > 0,
      `${article.slug}'s reviewer must be null or non-empty, never ""`,
    );
  }
});

test("author is always a non-empty organizational byline", () => {
  for (const article of blogArticles) {
    assert.ok(article.author.trim().length > 0, `${article.slug} has no author`);
  }
});

test("compareEstateSlugs only references real, published estates in the registry", () => {
  const registrySlugs = new Set(
    estateRegistry.filter((entry) => entry.hasPage).map((entry) => entry.slug),
  );
  for (const article of blogArticles) {
    for (const slug of article.compareEstateSlugs ?? []) {
      assert.ok(
        registrySlugs.has(slug),
        `${article.slug} references "${slug}", which is not a real published estate in estate-registry.ts`,
      );
    }
  }
});

test("no article slug is duplicated", () => {
  const slugs = blogArticles.map((article) => article.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});
