import assert from "node:assert/strict";
import test from "node:test";

import { blogArticles } from "./blog-articles.ts";
import { castlePeakRoadHub, castlePeakRoadSegments } from "./castle-peak-road.ts";
import { estateSeo, pageSeo } from "./seo.ts";
import {
  DESCRIPTION_MAX_UNITS,
  DESCRIPTION_MIN_UNITS,
  SHARED_TAIL_CHARS,
  TITLE_MAX_UNITS,
  TITLE_MIN_UNITS,
  displayWidth,
  seoCopyIssues,
} from "./seo-budget.js";

/**
 * The site-wide guard on SEO 標題 / SEO 描述 completeness.
 *
 * Every check here started as a real defect: estate descriptions that were
 * positioning prose with no verifiable fact and shared a template tail across
 * 15 of 22 entries, a dead pageSeo entry whose title was byte-identical to the
 * corridor hub's, and titles measured with `.length` so a 30-glyph zh-HK title
 * passed a 60-character check while rendering at 60 units. Sweeping every
 * entry, rather than spot-checking, is what stops the next one landing quietly.
 *
 * Scope: the static content layer. Copy generated per row -- listings
 * (src/lib/listing-seo.ts) and DB-backed estates/articles -- is covered by its
 * own suites, because there is no fixed set of strings to sweep.
 */

/** Every static title/description pair on the public site, with a stable key. */
function everyCopyPair() {
  const pairs = [];
  for (const [key, entry] of Object.entries(pageSeo)) {
    pairs.push({ key: `pageSeo.${key}`, ...entry });
  }
  for (const [slug, entry] of Object.entries(estateSeo)) {
    pairs.push({ key: `estateSeo.${slug}`, title: entry.title, description: entry.description });
  }
  pairs.push({
    key: "castlePeakRoadHub",
    title: castlePeakRoadHub.title,
    description: castlePeakRoadHub.description,
  });
  for (const segment of castlePeakRoadSegments) {
    pairs.push({
      key: `corridor.${segment.slug}`,
      title: segment.title,
      description: segment.description,
    });
  }
  // Articles carry no seo_title/seo_description of their own; blog_.$slug.tsx
  // builds the head from `title` and `excerpt`, so those are the strings that
  // reach a SERP.
  for (const article of blogArticles) {
    pairs.push({
      key: `blog.${article.slug}`,
      title: article.title,
      description: article.excerpt,
    });
  }
  return pairs;
}

test("the sweep actually covers the whole content layer", () => {
  const pairs = everyCopyPair();
  // A guard that silently stops covering things is worse than no guard. If an
  // entry is added or removed, this number moves deliberately.
  assert.equal(Object.keys(pageSeo).length, 16, "pageSeo entry count changed");
  assert.equal(Object.keys(estateSeo).length, 22, "estateSeo entry count changed");
  assert.equal(castlePeakRoadSegments.length, 2, "corridor segment count changed");
  assert.ok(pairs.length >= 41, `expected the sweep to cover 41+ pairs, got ${pairs.length}`);
});

test("every title and description is present and non-blank", () => {
  for (const pair of everyCopyPair()) {
    assert.ok(
      typeof pair.title === "string" && pair.title.trim() !== "",
      `${pair.key} has no SEO 標題`,
    );
    assert.ok(
      typeof pair.description === "string" && pair.description.trim() !== "",
      `${pair.key} has no SEO 描述`,
    );
  }
});

test("every title fits the SERP width budget", () => {
  for (const { key, title } of everyCopyPair()) {
    const width = displayWidth(title);
    assert.ok(
      width <= TITLE_MAX_UNITS,
      `${key} title is ${width} units, over the ${TITLE_MAX_UNITS} budget: ${title}`,
    );
    assert.ok(
      width >= TITLE_MIN_UNITS,
      `${key} title is only ${width} units -- too thin to carry its page's terms: ${title}`,
    );
  }
});

test("every description fits the snippet budget and fills it", () => {
  for (const { key, description } of everyCopyPair()) {
    const width = displayWidth(description);
    assert.ok(
      width <= DESCRIPTION_MAX_UNITS,
      `${key} description is ${width} units, over the ${DESCRIPTION_MAX_UNITS} budget`,
    );
    assert.ok(
      width >= DESCRIPTION_MIN_UNITS,
      `${key} description is only ${width} units -- under the ${DESCRIPTION_MIN_UNITS} floor, ` +
        `so Google fills the rest of the snippet with its own extraction`,
    );
  }
});

test("no two pages share a title or a description", () => {
  for (const field of ["title", "description"]) {
    const byValue = new Map();
    for (const pair of everyCopyPair()) {
      const existing = byValue.get(pair[field]) ?? [];
      existing.push(pair.key);
      byValue.set(pair[field], existing);
    }
    for (const [value, keys] of byValue) {
      assert.equal(
        keys.length,
        1,
        `${keys.join(" and ")} share the same ${field}: ${value.slice(0, 40)}…`,
      );
    }
  }
});

/**
 * A description with its brand/licence sign-off removed.
 *
 * "晉誠地產 C-018613。" is deliberately uniform -- it is the trust signal the
 * client wants on every commercial page, and the licence assertion below
 * requires it. What must not be uniform is the sentence in front of it, which
 * is where the real defect lived: 「…交通及 71 校網，WhatsApp 即時預約睇樓。」
 * word-for-word across five estates. So the tail check runs on what is left
 * after the sign-off, not on the sign-off itself.
 */
function substantiveTail(description) {
  const withoutSignOff = description
    .replace(/\s*(晉誠地產|持牌代理)?\s*C-018613\s*[。.]?\s*$/, "")
    .trim();
  return withoutSignOff.slice(-SHARED_TAIL_CHARS);
}

test("no three descriptions make the same closing statement", () => {
  // The defect: 15 of 22 estate descriptions ended with one of three identical
  // 16-character tails. Google reads a shared tail across many pages as
  // boilerplate and substitutes its own snippet, so the curated copy never
  // renders. Two sharing a closing clause is tolerated; three is a template.
  const byTail = new Map();
  for (const { key, description } of everyCopyPair()) {
    const tail = substantiveTail(description);
    const existing = byTail.get(tail) ?? [];
    existing.push(key);
    byTail.set(tail, existing);
  }
  for (const [tail, keys] of byTail) {
    assert.ok(
      keys.length < 3,
      `${keys.length} descriptions close with "${tail}" (${keys.join(", ")}) -- ` +
        `give each one its own closing clause`,
    );
  }
});

test("seoCopyIssues reports nothing for any shipped pair", () => {
  // The same rules the admin-side width hint applies, run over what is live.
  for (const { key, title, description } of everyCopyPair()) {
    assert.deepEqual(seoCopyIssues({ title, description }), [], `${key} has SEO copy issues`);
  }
});

test("every estate description carries a fact, not only positioning language", () => {
  // 19 of 22 were rewritten from each estate's own verified facts in
  // neon/migrations/20260901100000_estate_expansion_facts.sql precisely because
  // "戶型選擇多" and "適合想換空間嘅家庭" are true of every estate on the site.
  // A number -- a year, a unit count, an area or a school net -- is the cheapest
  // test that the copy is about *this* estate.
  for (const [slug, entry] of Object.entries(estateSeo)) {
    assert.match(
      entry.description,
      /\d/,
      `estateSeo.${slug} description states no number (year, 伙, 呎 or 校網): ${entry.description}`,
    );
  }
});

test("the licence number appears wherever the copy claims agency service", () => {
  // C-018613 is the EAA licence. It is a trust signal in a SERP and the client
  // asks for it, so it belongs on every commercial page's description -- but
  // never on the legal pages, whose descriptions are about the documents.
  // Exempt: the legal pages, whose descriptions are about the documents rather
  // than the agency service, and the two editorial pages, where a licence
  // number in a description about article sourcing reads as misplaced.
  const legal = new Set([
    "pageSeo.privacy",
    "pageSeo.terms",
    "pageSeo.disclaimer",
    "pageSeo.blog",
    "pageSeo.blogEditorialStandards",
  ]);
  for (const { key, description } of everyCopyPair()) {
    if (legal.has(key) || key.startsWith("blog.")) continue;
    assert.match(description, /C-018613/, `${key} description omits the licence number`);
  }
});
