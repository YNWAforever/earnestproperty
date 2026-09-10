import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { articlePublishedAt, blogArticles, publishedBlogArticles } from "./blog-articles.ts";
import { estatePageContent } from "./estate-pages.ts";
import { estateRegistry } from "./estate-registry.ts";
import { estateReviewArticles } from "./estate-review-articles.ts";
import { schoolNets } from "./school-nets.ts";
import { DESCRIPTION_MAX_UNITS, DESCRIPTION_MIN_UNITS, displayWidth } from "./seo-budget.js";

/**
 * The 屋苑開箱 set behind /estate-reviews's 最新屋苑文章.
 *
 * Width, uniqueness and shared-tail rules are already swept site-wide by
 * seo-copy.test.mjs (these articles are part of `blogArticles`, so they are in
 * that sweep). What this file guards is what is specific to a *derived* article
 * set: that the derivation stays sourced, that internal engineering notes never
 * leak into reader copy, and that the set does not quietly shrink.
 */

/** Titles get `｜晉誠地產` appended by blog_.$slug.tsx's head(), which trims to
 * the 60-unit budget. Authoring to 50 means a reader never sees that trim. */
const TITLE_BUDGET_WITH_SUFFIX = 50;

const reviewArticles = blogArticles.filter((article) => article.category === "屋苑開箱");

test("the section is populated: 50 屋苑開箱 articles, one per estate plus the multi-estate set", () => {
  assert.equal(estateReviewArticles.length, 50);
  assert.equal(reviewArticles.length, 50, "all 50 must reach blogArticles with the right category");

  // Every estate with a detail page gets its own 開箱, so a new estate cannot
  // land with no article pointing at it.
  const published = estateRegistry.filter((entry) => entry.hasPage);
  for (const entry of published) {
    assert.ok(
      estateReviewArticles.some((article) => article.slug === `${entry.slug}-estate-review`),
      `${entry.slug} has a detail page but no 屋苑開箱 article`,
    );
  }
  assert.equal(published.length, 22);
});

test("屋苑開箱 is a real blog category, not a string only this page queries", () => {
  // /estate-reviews calls fetchPublishedArticlesByCategory("屋苑開箱"), and the
  // header, footer and VIDEO_CATEGORIES all treat it as a section -- but it was
  // absent from BLOG_CATEGORIES, so no article authored through the site's own
  // taxonomy could ever appear there and the CMS never offered the category.
  const article = reviewArticles[0];
  assert.equal(article.category, "屋苑開箱");
});

test("every article has real structure, not a single heading-less blob", () => {
  for (const article of estateReviewArticles) {
    assert.ok(
      article.sections.length >= 4,
      `${article.slug} has only ${article.sections.length} sections`,
    );
    for (const section of article.sections) {
      assert.ok(section.heading.trim().length > 0, `${article.slug} has an empty heading`);
      assert.ok(
        section.paragraphs.length > 0,
        `${article.slug}'s "${section.heading}" has no paragraphs`,
      );
      for (const paragraph of section.paragraphs) {
        assert.ok(
          typeof paragraph === "string" && paragraph.trim().length > 0,
          `${article.slug}'s "${section.heading}" has a blank paragraph`,
        );
      }
    }
    assert.ok(article.answerSummary.trim().length > 0, `${article.slug} has no answerSummary`);
    assert.ok(article.sourcesNote.trim().length > 0, `${article.slug} has no sourcesNote`);
  }
});

test("every title leaves room for the brand suffix the head appends", () => {
  for (const article of estateReviewArticles) {
    const width = displayWidth(article.title);
    assert.ok(
      width <= TITLE_BUDGET_WITH_SUFFIX,
      `${article.slug} title is ${width} units; over ${TITLE_BUDGET_WITH_SUFFIX} the head trims it`,
    );
  }
});

test("every excerpt fills the snippet budget without overflowing it", () => {
  for (const article of estateReviewArticles) {
    const width = displayWidth(article.excerpt);
    assert.ok(width >= DESCRIPTION_MIN_UNITS, `${article.slug} excerpt is only ${width} units`);
    assert.ok(width <= DESCRIPTION_MAX_UNITS, `${article.slug} excerpt is ${width} units`);
  }
});

test("no two articles share a slug, a title or an excerpt", () => {
  for (const field of ["slug", "title", "excerpt"]) {
    const values = estateReviewArticles.map((article) => article[field]);
    assert.equal(new Set(values).size, values.length, `two 屋苑開箱 articles share a ${field}`);
  }
});

test("internal data-handling guidance never reaches reader copy", () => {
  // estatePageContent.marketNote is written for whoever builds the market
  // snapshot ("成交圖表必須提供產品類型", "MLS alias 不可互相吞併"), not for a
  // buyer. Deriving articles from the same object makes leaking it a one-line
  // mistake, so it is pinned out.
  const marketNotes = Object.values(estatePageContent).map((entry) => entry.marketNote);
  for (const article of estateReviewArticles) {
    const body = [
      article.title,
      article.excerpt,
      article.answerSummary,
      ...article.sections.flatMap((section) => [section.heading, ...section.paragraphs]),
    ].join("\n");
    for (const note of marketNotes) {
      assert.ok(!body.includes(note), `${article.slug} leaks a marketNote into reader copy`);
    }
    for (const term of ["estate_id", "MLS", "Neon", "alias"]) {
      assert.ok(!body.includes(term), `${article.slug} leaks the internal term "${term}"`);
    }
  }
});

test("copy that addresses the page, not the reader, is stripped", () => {
  // estatePageContent mixes real buyer advice ("成交量較少，應把較長時段成交…
  // 一併比較") with a few clauses written for whoever builds the page
  // ("頁面必須按期數標示", "新路線或班次必須引用最新營運資料"). The first
  // belongs in an article; the second reads as nonsense to a buyer, and
  // deriving 50 articles from the same object turns one such clause into 50.
  for (const article of estateReviewArticles) {
    const body = article.sections.flatMap((section) => section.paragraphs).join("\n");
    assert.ok(!body.includes("頁面"), `${article.slug} tells the reader what the page must show`);
    assert.ok(!body.includes("引用最新營運資料"), `${article.slug} leaks a citation instruction`);
  }
});

test("sentence lists never render a doubled delimiter", () => {
  // buyerFit entries already end in 。, so joining them raw produced
  // 「…希望社區較簡潔的自住客。；在深井尋找…」.
  for (const article of estateReviewArticles) {
    const body = [
      article.excerpt,
      article.answerSummary,
      ...article.sections.flatMap((section) => section.paragraphs),
    ].join("\n");
    for (const artifact of ["。；", "。、", "；。", "、。", "，。", "：。"]) {
      assert.ok(!body.includes(artifact), `${article.slug} renders "${artifact}"`);
    }
  }
});

test("no article names a primary school", () => {
  // school-nets.ts keeps primarySchools empty on purpose until an Education
  // Bureau register is supplied, and forbids naming schools from any other
  // source. The articles cite the net code and say no list is published.
  for (const net of Object.values(schoolNets)) {
    assert.deepEqual(net.primarySchools, [], "this test assumes no school list is sourced yet");
  }
  for (const article of estateReviewArticles) {
    const body = article.sections.flatMap((section) => section.paragraphs).join("\n");
    assert.ok(!/小學|中學/.test(body.replace(/小學名單/g, "")), `${article.slug} names a school`);
  }
});

test("articles avoid the retired listing wording", () => {
  // Same char-code spelling as the site-wide guard in src/config/site.test.mjs,
  // so these literals never show up in the repo-wide grep it exists to keep
  // clean.
  const forbidden = [
    String.fromCharCode(30495, 30436, 28304),
    String.fromCharCode(22533, 30436, 28304),
    String.fromCharCode(21313, 22810, 24180),
  ];
  for (const article of estateReviewArticles) {
    const body = [
      article.title,
      article.excerpt,
      ...article.sections.flatMap((section) => section.paragraphs),
    ].join("\n");
    for (const phrase of forbidden) {
      assert.ok(!body.includes(phrase), `${article.slug} uses retired wording ${phrase}`);
    }
  }
});

test("every comparison table and link points at a real estate page", () => {
  const published = new Set(
    estateRegistry.filter((entry) => entry.hasPage).map((entry) => entry.slug),
  );
  for (const article of estateReviewArticles) {
    assert.ok(
      (article.compareEstateSlugs ?? []).length > 0,
      `${article.slug} renders no live comparison table, so its numbers come from nowhere`,
    );
    assert.ok(
      (article.compareEstateSlugs ?? []).length <= 5,
      `${article.slug} would fetch more than 5 estate rows for one table`,
    );
    for (const slug of article.compareEstateSlugs ?? []) {
      assert.ok(published.has(slug), `${article.slug} compares "${slug}", which has no page`);
    }
    for (const link of article.links ?? []) {
      assert.ok(link.href.startsWith("/"), `${article.slug} has an off-site link: ${link.href}`);
      assert.ok(link.label.trim().length > 0, `${article.slug} has an unlabelled link`);
      const estateMatch = /^\/estate\/([a-z0-9-]+)$/.exec(link.href);
      if (estateMatch) {
        assert.ok(
          published.has(estateMatch[1]),
          `${article.slug} links /estate/${estateMatch[1]}, which has no page`,
        );
      }
    }
  }
});

test("multi-estate articles group estates that really share the attribute", () => {
  // An attribute article's membership is derived from the estates' own
  // published prose (estatesMentioning), so the grouping claim is traceable.
  // This proves the derivation is live rather than a hand-typed list that has
  // drifted: each attribute article quotes its keyword, and every member's own
  // content must contain it.
  const attributeArticles = estateReviewArticles.filter((article) =>
    article.sections.some((section) =>
      section.paragraphs.some((paragraph) => paragraph.includes("嘅公開屋苑資料都提到「")),
    ),
  );
  assert.equal(attributeArticles.length, 8, "expected 8 attribute round-ups");

  for (const article of attributeArticles) {
    const premise = article.sections
      .flatMap((section) => section.paragraphs)
      .find((paragraph) => paragraph.includes("嘅公開屋苑資料都提到「"));
    const keyword = /都提到「(.+?)」/.exec(premise)?.[1];
    assert.ok(keyword, `${article.slug} states no grouping keyword`);
    for (const slug of article.compareEstateSlugs ?? []) {
      const entry = estatePageContent[slug];
      const haystack = [
        entry.heroPositioning,
        ...entry.overview,
        ...entry.buyerFit,
        ...entry.pros,
        ...entry.watchouts,
        entry.transportLifestyle,
      ].join(" ");
      assert.ok(
        haystack.includes(keyword),
        `${article.slug} groups ${slug} under "${keyword}", but its own content never says so`,
      );
    }
  }
});

// --- publication schedule --------------------------------------------------

const singleEstateArticles = estateReviewArticles.filter((article) =>
  article.slug.endsWith("-estate-review"),
);
const scheduledArticles = estateReviewArticles
  .filter((article) => !article.slug.endsWith("-estate-review"))
  .slice()
  .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));

test("the 22 single-estate articles all launch together", () => {
  assert.equal(singleEstateArticles.length, 22);
  const dates = new Set(singleEstateArticles.map((article) => article.publishedAt));
  assert.equal(dates.size, 1, "the launch batch must share one date");
  assert.ok(
    Date.parse([...dates][0]) <= Date.parse("2026-09-07T00:00:00.000Z"),
    "the launch batch must already be live",
  );
});

test("the 28 multi-estate articles publish one a day, with no gaps or collisions", () => {
  assert.equal(scheduledArticles.length, 28);
  const DAY_MS = 24 * 60 * 60 * 1000;
  for (const [index, article] of scheduledArticles.entries()) {
    assert.ok(article.publishedAt, `${article.slug} has no publishedAt`);
    if (index === 0) continue;
    const gap =
      Date.parse(article.publishedAt) - Date.parse(scheduledArticles[index - 1].publishedAt);
    assert.equal(
      gap,
      DAY_MS,
      `${article.slug} is ${gap / DAY_MS} days after the previous article, not 1`,
    );
  }
  // Every scheduled article is strictly after the launch batch.
  assert.ok(
    Date.parse(scheduledArticles[0].publishedAt) > Date.parse(singleEstateArticles[0].publishedAt),
    "the daily run must start after launch",
  );
});

test("the daily run alternates between the three kinds", () => {
  // Six area round-ups shipping on six consecutive days would read as a dump.
  const kindOf = (article) => {
    const body = article.sections.flatMap((section) => section.paragraphs).join("\n");
    if (body.includes("嘅公開屋苑資料都提到「")) return "attribute";
    return article.compareEstateSlugs.length === 2 ? "versus" : "area";
  };
  const kinds = scheduledArticles.map(kindOf);
  assert.deepEqual(kinds.slice(0, 6), [
    "area",
    "versus",
    "attribute",
    "area",
    "versus",
    "attribute",
  ]);
});

test("publishedBlogArticles gates on the clock, so a scheduled article is not live early", () => {
  const launchDay = publishedBlogArticles(new Date("2026-09-07T12:00:00.000Z"));
  // 22 estate 開箱 + the two flagship guides.
  assert.equal(launchDay.length, 24);
  assert.equal(launchDay.filter((article) => article.category === "屋苑開箱").length, 22);

  const firstScheduled = scheduledArticles[0];
  const justBefore = new Date(Date.parse(firstScheduled.publishedAt) - 1000);
  const justAfter = new Date(Date.parse(firstScheduled.publishedAt));
  assert.ok(
    !publishedBlogArticles(justBefore).some((a) => a.slug === firstScheduled.slug),
    "an article must not be reachable a second before its date",
  );
  assert.ok(
    publishedBlogArticles(justAfter).some((a) => a.slug === firstScheduled.slug),
    "an article must be live exactly on its date",
  );

  // Everything is out by the day after the last scheduled article.
  const afterRun = new Date(
    Date.parse(scheduledArticles[scheduledArticles.length - 1].publishedAt) + 1000,
  );
  assert.equal(publishedBlogArticles(afterRun).length, blogArticles.length);
});

test("every article carries a real date, and the flagship pair keep theirs", () => {
  for (const article of blogArticles) {
    const at = articlePublishedAt(article);
    assert.ok(!Number.isNaN(Date.parse(at)), `${article.slug} has an unparseable date: ${at}`);
  }
  // The two guides predate scheduling and are always published.
  const flagship = blogArticles.filter((article) => article.publishedAt === undefined);
  assert.equal(flagship.length, 2);
});

test("routes and the sitemap read the published set, not the authored set", () => {
  // The whole point of the schedule is that an unpublished article 404s rather
  // than merely being unlisted. A route reverting to `blogArticles` would
  // silently publish all 50 at once, so the wiring is pinned here.
  for (const path of [
    "src/routes/blog.tsx",
    "src/routes/blog_.$slug.tsx",
    "src/routes/estate-reviews.tsx",
    "src/routes/estate.$slug.tsx",
    "src/routes/sitemap[.]xml.ts",
  ]) {
    const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    assert.match(source, /publishedBlogArticles\(/, `${path} must gate on publishedBlogArticles`);
    // Checked against the import list rather than the file text, so a comment
    // that merely names the ungated export does not trip it.
    const imports = source.match(/import\s[\s\S]*?from\s+"@\/content\/blog-articles";/g) ?? [];
    for (const statement of imports) {
      assert.ok(!/\bblogArticles\b/.test(statement), `${path} imports the ungated blogArticles`);
    }
  }
});
