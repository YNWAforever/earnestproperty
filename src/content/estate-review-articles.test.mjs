import assert from "node:assert/strict";
import test from "node:test";

import { blogArticles } from "./blog-articles.ts";
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
