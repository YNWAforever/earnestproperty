import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEstateAnswerSummary,
  estatePageContent,
  getEstatePageContent,
} from "./estate-pages.ts";
import { estateRegistry } from "./estate-registry.ts";

const bellagio = getEstatePageContent("bellagio");
assert.ok(
  bellagio,
  "bellagio must have real estate-pages.ts content for these tests to mean anything",
);

test("buildEstateAnswerSummary reuses buyerFit/transportLifestyle/watchouts verbatim, joined not paraphrased", () => {
  const summary = buildEstateAnswerSummary(bellagio, 15000, []);
  for (const phrase of bellagio.buyerFit) {
    assert.ok(summary.includes(phrase), `expected the real buyerFit phrase "${phrase}" verbatim`);
  }
  assert.ok(summary.includes(bellagio.transportLifestyle));
  for (const phrase of bellagio.watchouts) {
    assert.ok(summary.includes(phrase), `expected the real watchouts phrase "${phrase}" verbatim`);
  }
});

test("同價有咩選擇 sorts comparables by real PSF proximity to the current estate, nearest first", () => {
  const summary = buildEstateAnswerSummary(bellagio, 15000, [
    { nameZh: "遠價屋苑", avgPsf: 8000 },
    { nameZh: "近價屋苑", avgPsf: 14800 },
  ]);
  const nearIndex = summary.indexOf("近價屋苑");
  const farIndex = summary.indexOf("遠價屋苑");
  assert.ok(nearIndex !== -1 && farIndex !== -1);
  assert.ok(nearIndex < farIndex, "the closer-priced estate should be named first");
});

test("a comparable with a null avgPsf is dropped, not rendered as a fabricated match", () => {
  const summary = buildEstateAnswerSummary(bellagio, 15000, [
    { nameZh: "無資料屋苑", avgPsf: null },
  ]);
  assert.ok(!summary.includes("無資料屋苑"));
});

test("with zero comparables, the summary still covers the other 3 questions and never claims a same-price answer", () => {
  const summary = buildEstateAnswerSummary(bellagio, 15000, []);
  assert.ok(!summary.includes("同價有咩選擇"));
  assert.ok(summary.includes("適合邊類家庭"));
  assert.ok(summary.includes("交通取捨"));
  assert.ok(summary.includes("睇樓前要留意"));
});

// --- Estate Expansion 17 (2026-09-01 data pack), Task 4: 17 new estatePageContent entries ---

const ESTATE_EXPANSION_17_SLUGS = [
  "hoi-wan-hin",
  "tai-wah-hin",
  "hoi-wan-toi",
  "chun-wong-kui",
  "lung-tang-kok",
  "mun-ming-shan",
  "wong-gam-hoi-ngon",
  "oi-kam-hoi-ngon",
  "tai-yu",
  "wong-gam-hoi-waan",
  "sing-tai",
  "seong-yuen",
  "the-carmel",
  "oma-oma",
  "lin-shan",
  "long-tou-waan",
  "tai-tou-waan",
];

test("Estate Expansion 17: all 17 new slugs exist in estatePageContent", () => {
  assert.equal(ESTATE_EXPANSION_17_SLUGS.length, 17);
  for (const slug of ESTATE_EXPANSION_17_SLUGS) {
    assert.ok(getEstatePageContent(slug), `${slug} must have a real estatePageContent entry`);
  }
});

test("Estate Expansion 17: every new entry has exactly 2 overview paragraphs, 3 buyerFit/pros/watchouts, 2 faqs, 3 relatedLinks", () => {
  // These are the master spec's own stated minimums -- a regression guard so
  // a future edit can't silently drop an item from any of these lists.
  for (const slug of ESTATE_EXPANSION_17_SLUGS) {
    const content = getEstatePageContent(slug);
    assert.equal(content.overview.length, 2, `${slug}: overview should have 2 paragraphs`);
    assert.equal(content.buyerFit.length, 3, `${slug}: buyerFit should have 3 items`);
    assert.equal(content.pros.length, 3, `${slug}: pros should have 3 items`);
    assert.equal(content.watchouts.length, 3, `${slug}: watchouts should have 3 items`);
    assert.equal(content.faqs.length, 2, `${slug}: faqs should have 2 entries`);
    assert.equal(content.relatedLinks.length, 3, `${slug}: relatedLinks should have 3 entries`);
  }
});

test("Estate Expansion 17: every relatedLinks /estate/{slug} cross-reference targets a real registry slug", () => {
  // Catches a typo'd cross-reference, e.g. an entry linking to a slug that
  // doesn't exist in the registry (Task 4's own worked example links
  // hoi-wan-hin -> chun-wong-kui, which must resolve).
  const registrySlugs = new Set(estateRegistry.map((entry) => entry.slug));
  for (const slug of ESTATE_EXPANSION_17_SLUGS) {
    const content = getEstatePageContent(slug);
    for (const link of content.relatedLinks) {
      const match = link.href.match(/^\/estate\/([a-z0-9-]+)$/);
      if (!match) continue;
      assert.ok(
        registrySlugs.has(match[1]),
        `${slug}'s relatedLinks references /estate/${match[1]}, which is not a real registry slug`,
      );
    }
  }
});

test("Estate Expansion 17: estatePageContent has exactly 22 entries (5 original + 17 new)", () => {
  assert.equal(Object.keys(estatePageContent).length, 22);
});
