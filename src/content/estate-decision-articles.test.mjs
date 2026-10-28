import assert from "node:assert/strict";
import test from "node:test";

import { publishedBlogArticles } from "./blog-articles.ts";
import { estateRegistry } from "./estate-registry.ts";
import { DESCRIPTION_MAX_UNITS, DESCRIPTION_MIN_UNITS, displayWidth } from "./seo-budget.js";

const expectedSlugs = [
  "bellagio-renting-guide",
  "hong-kong-garden-renting-guide",
  "sea-crest-villa-renting-guide",
  "hoi-wan-hin-renting-guide",
  "lido-garden-renting-guide",
  "castle-peak-villas-vs-ching-lai-waan-villas",
  "pearl-island-estates-comparison",
  "tuen-mun-court-vs-elegant-villa",
  "nga-tak-yuen-vs-ching-yung-toi",
  "deauville-vs-kwun-hoi-villas",
  "fei-yeung-vs-oma-by-the-sea",
  "napa-vs-ocean-camino",
  "bayview-terrace-vs-hoi-wai-garden",
  "nam-ngon-vs-palm-cove",
  "hoi-king-garden-vs-ching-yung-toi",
  "kwan-lun-vs-oi-kam-waan",
  "chui-king-garden-vs-fiona-garden",
  "hoi-ching-hin-vs-oi-kam-waan",
  "long-beach-gardens-vs-riviera",
  "l-aquatique-vs-hong-kong-garden",
];

test("all 20 new estate guides are published as distinct review articles", () => {
  const articles = publishedBlogArticles(new Date("2026-11-01T00:00:00Z"));
  for (const slug of expectedSlugs) {
    const matches = articles.filter((article) => article.slug === slug);
    assert.equal(matches.length, 1, `expected one published article for ${slug}`);
    assert.equal(matches[0].category, "屋苑開箱");
    assert.ok(matches[0].publishedAt, `${slug} needs its own publication date`);
  }
  const firstReviews = articles.filter((article) => article.category === "屋苑開箱").slice(0, 20);
  assert.deepEqual(new Set(firstReviews.map((article) => article.slug)), new Set(expectedSlugs));
});

test("the new guides provide substantive copy, sources and valid estate links", () => {
  const articles = publishedBlogArticles(new Date("2026-11-01T00:00:00Z")).filter((article) =>
    expectedSlugs.includes(article.slug),
  );
  assert.equal(articles.length, 20);
  const estateSlugs = new Set(
    estateRegistry.filter((entry) => entry.hasPage).map((entry) => entry.slug),
  );
  for (const article of articles) {
    assert.ok(article.sections.length >= 4, `${article.slug} needs several useful sections`);
    const body = article.sections.flatMap((section) => section.paragraphs).join("");
    assert.ok(body.length >= 450, `${article.slug} is too short to answer the reader's question`);
    assert.ok(article.answerSummary.trim(), `${article.slug} needs a summary`);
    assert.ok(article.sourcesNote.trim(), `${article.slug} needs a source note`);
    assert.ok(
      article.links.some((link) => link.href.startsWith("/estate/")),
      `${article.slug} needs an estate link`,
    );
    assert.ok(
      article.links.some((link) => link.href.startsWith("https://")),
      `${article.slug} needs a linked source`,
    );
    for (const link of article.links) {
      const match = /^\/estate\/([a-z0-9-]+)$/.exec(link.href);
      if (match) assert.ok(estateSlugs.has(match[1]), `${article.slug} links a missing estate`);
    }
    assert.ok(displayWidth(article.title) <= 50, `${article.slug} title exceeds the SEO budget`);
    const excerptWidth = displayWidth(article.excerpt);
    assert.ok(
      excerptWidth >= DESCRIPTION_MIN_UNITS && excerptWidth <= DESCRIPTION_MAX_UNITS,
      `${article.slug} excerpt is outside the SEO budget: ${excerptWidth}`,
    );
  }
  for (const field of ["title", "excerpt"]) {
    assert.equal(
      new Set(articles.map((article) => article[field])).size,
      articles.length,
      `duplicate ${field}`,
    );
  }
});

test("the new batch is not available before its stated publication date", () => {
  const articles = publishedBlogArticles(new Date("2026-11-01T00:00:00Z")).filter((article) =>
    expectedSlugs.includes(article.slug),
  );
  for (const article of articles) {
    const justBefore = new Date(Date.parse(article.publishedAt) - 1);
    assert.ok(!publishedBlogArticles(justBefore).some((item) => item.slug === article.slug));
  }
});

test("the Sea Crest rental guide links the separately indexed fifth phase", () => {
  const article = publishedBlogArticles(new Date("2026-11-01T00:00:00Z")).find(
    (item) => item.slug === "sea-crest-villa-renting-guide",
  );
  assert.ok(article);
  assert.ok(article.links.some((link) => link.href === "/estate/tai-wah-hin"));
  assert.ok(article.links.some((link) => link.href === "/listings?deal=rent&estate=tai-wah-hin"));
  assert.match(article.sections.flatMap((section) => section.paragraphs).join(" "), /第五期/);
});
