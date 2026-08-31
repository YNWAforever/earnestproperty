import assert from "node:assert/strict";
import test from "node:test";

import { buildEstateAnswerSummary, getEstatePageContent } from "./estate-pages.ts";

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
