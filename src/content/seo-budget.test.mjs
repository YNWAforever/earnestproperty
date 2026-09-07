import assert from "node:assert/strict";
import test from "node:test";

import {
  DESCRIPTION_MAX_UNITS,
  DESCRIPTION_MIN_UNITS,
  TITLE_MAX_UNITS,
  TITLE_MIN_UNITS,
  displayWidth,
  seoCopyIssues,
  truncateToWidth,
} from "./seo-budget.js";

test("displayWidth counts CJK glyphs as two cells and ASCII as one", () => {
  assert.equal(displayWidth(""), 0);
  assert.equal(displayWidth(null), 0);
  assert.equal(displayWidth(undefined), 0);
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("晉誠地產"), 8);
  // The fullwidth bar U+FF5C separates the page term from the brand in every
  // title on this site, so it has to count as two -- 24 titles depend on it.
  assert.equal(displayWidth("｜"), 2);
  assert.equal(displayWidth("深井｜晉誠地產"), 4 + 2 + 8);
});

test("displayWidth measures the real homepage title the way the audit did", () => {
  // 晉誠地產(8) + " "(1) + Earnest(7) + " "(1) + Property(8) + ｜(2)
  // + 深井(4) + " "(1) + 青山公路(8) + " "(1) + 汀九樓盤(8) = 49
  assert.equal(displayWidth("晉誠地產 Earnest Property｜深井 青山公路 汀九樓盤"), 49);
});

test("displayWidth treats fullwidth punctuation as wide and ambiguous dashes as narrow", () => {
  assert.equal(displayWidth("，。、（）"), 10);
  // U+2013/U+2014 render halfwidth in the Latin-primary font a SERP uses.
  // Counting them as 2 would over-report every description carrying a range.
  assert.equal(displayWidth("2003–2006"), 9);
});

test("displayWidth counts an astral-plane glyph once, not twice", () => {
  // "🏠" is a surrogate pair: .length is 2, its display width is 2 as well,
  // but a naive per-UTF-16-unit loop would score it 4.
  assert.equal("🏠".length, 2);
  assert.equal(displayWidth("🏠"), 2);
  assert.equal(displayWidth("🏠a"), 3);
});

test("the budgets are the SERP truncation points, with floors below them", () => {
  assert.equal(TITLE_MAX_UNITS, 60);
  assert.equal(DESCRIPTION_MAX_UNITS, 160);
  assert.ok(TITLE_MIN_UNITS < TITLE_MAX_UNITS);
  assert.ok(DESCRIPTION_MIN_UNITS < DESCRIPTION_MAX_UNITS);
});

test("truncateToWidth leaves copy already inside the budget untouched", () => {
  const inside = "深井放盤搜尋｜晉誠地產";
  assert.equal(truncateToWidth(inside, TITLE_MAX_UNITS), inside);
  assert.equal(truncateToWidth("", 60), "");
  assert.equal(truncateToWidth(null, 60), "");
});

test("truncateToWidth cuts on a clause boundary instead of mid-clause", () => {
  // The defect this replaces: `description.slice(0, 150)` on zh-HK prose.
  const prose =
    "碧堤半島位於深井青山公路深井段 33 號，由會德豐九龍倉發展，2003 至 2006 年分三期落成，共 8 座";
  const cut = truncateToWidth(prose, 40);
  assert.ok(displayWidth(cut) <= 40, `expected <= 40 units, got ${displayWidth(cut)}`);
  // No dangling clause delimiter, which is what makes a sliced snippet read
  // as broken rather than merely short.
  assert.doesNotMatch(cut, /[，。、；：]$/);
  assert.ok(prose.startsWith(cut), "the truncation must be a prefix of the input");
});

test("truncateToWidth never exceeds the budget even with no boundary to rewind to", () => {
  const unbroken = "碧堤半島浪翠園豪景花園海韻花園麗都花園海雲軒帝華軒海韻臺縉皇居龍騰閣";
  const cut = truncateToWidth(unbroken, 21);
  // 21 is odd and every glyph is 2 wide, so the cut has to land on 20.
  assert.equal(displayWidth(cut), 20);
});

test("seoCopyIssues reports a shippable pair as clean", () => {
  assert.deepEqual(
    seoCopyIssues({
      title: "碧堤半島 Bellagio 深井｜放盤、成交、呎價、會所",
      description:
        "碧堤半島（Bellagio）深井海景豪宅，約 3,345 伙，坐擁青馬橋景。即時放盤、成交呎價、FAQ。WhatsApp 查詢 C-018613。",
    }),
    [],
  );
});

test("seoCopyIssues names a missing title or description", () => {
  assert.deepEqual(seoCopyIssues({ title: "", description: "" }), [
    "title_missing",
    "description_missing",
  ]);
  // A whitespace-only value is the same defect: an empty <title> in the HTML.
  assert.deepEqual(seoCopyIssues({ title: "   ", description: "   " }), [
    "title_missing",
    "description_missing",
  ]);
  assert.deepEqual(seoCopyIssues({}), ["title_missing", "description_missing"]);
});

test("seoCopyIssues names over-budget and thin copy separately", () => {
  assert.deepEqual(seoCopyIssues({ title: "深".repeat(40), description: "深".repeat(50) }), [
    "title_over_budget",
  ]);
  assert.deepEqual(seoCopyIssues({ title: "深".repeat(20), description: "深".repeat(90) }), [
    "description_over_budget",
  ]);
  assert.deepEqual(seoCopyIssues({ title: "代理｜晉誠", description: "深".repeat(50) }), [
    "title_thin",
  ]);
  assert.deepEqual(seoCopyIssues({ title: "深".repeat(20), description: "深井放盤。" }), [
    "description_thin",
  ]);
});
