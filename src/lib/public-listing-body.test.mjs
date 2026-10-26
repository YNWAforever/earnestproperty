import assert from "node:assert/strict";
import test from "node:test";

import { showListingFeatureChips, stripCapturedListingFacts } from "./public-listing-body.js";

const A049264 = "帝濤灣 海琴軒，中層，實用面積 670 平方呎，3 房，1 浴室。";

const STUFFED = [
  "晉誠地產三行聯營深井‧青山公路23年 廿多位同事平均年資超過20年，經驗豐富，信心保證!",
  "座數及單位：1座 低層 (1-11/18樓)",
  "小學校網：62校網(荃灣區)",
  "中學校網：荃灣區(NT2)",
  "發展商：中冶",
  "管理公司：第一太平戴維斯物業管理有限公司",
  "樓齡：7 年",
  "入伙日期：2019",
  "屋苑介紹：逸璟•龍灣由中冶置業發展，設有2座，提供198伙，實用面積為261至3,857平方呎。",
  "屋苑單位數目：198伙",
  "屋苑座數：2座",
  "屋苑車位：住宅停車位：35個",
].join("\n");

test("a linked listing's short description is left untouched", () => {
  assert.equal(stripCapturedListingFacts(A049264), A049264);
  assert.equal(stripCapturedListingFacts(`  ${A049264}  `), A049264);
});

test("ordinary rental terms and management fees remain in the description", () => {
  for (const description of [
    "租金包括：管理費及差餉。可即時入住。",
    "管理費：每月 $1,200。可即時入住。",
    "開揚海景。 租金包括：管理費及差餉。可即時入住。",
    "租金包括：差餉\n管理費：每月 $1,200\n可即時入住。",
    "發展商：新鴻基地產。單位新裝修。",
    "小學校網：62校網\n中學校網：荃灣區。可即時入住。",
  ]) {
    assert.equal(stripCapturedListingFacts(description), description);
  }
});

test("rental terms before a confirmed capture appendix are preserved", () => {
  const description = "租金包括：管理費及差餉。可即時入住。\n管理費：已包括。";
  const appendix = "座數及單位：1座\n發展商：新鴻基地產\n入伙日期：1999\n屋苑單位數目：856伙";
  assert.equal(stripCapturedListingFacts(`${description}\n${appendix}`), description);
  assert.equal(
    stripCapturedListingFacts(`${description}\n${appendix}`.replace(/\s+/g, " ")),
    description.replace(/\s+/g, " "),
  );
});

test("estate facts outside the saved-capture order are not treated as an appendix", () => {
  const description = "屋苑單位數目：856伙\n入伙日期：1999\n發展商：新鴻基地產。可即時入住。";
  assert.equal(stripCapturedListingFacts(description), description);
});

test("rental terms after estate labels are not swallowed as appendix values", () => {
  for (const separator of ["\n", " "]) {
    const description = [
      "座數及單位：海琴軒3座中層",
      "小學校網：71校網",
      "中學校網：屯門區",
      "租金包括：管理費及差餉。可即時入住。",
    ].join(separator);
    assert.equal(stripCapturedListingFacts(description), description);
  }
});

test("unit copy before a capture appendix is not absorbed through earlier estate labels", () => {
  for (const separator of ["\n", " "]) {
    const description = ["座數及單位：海琴軒3座中層", "管理費：已包括。可即時入住。"].join(
      separator,
    );
    const appendix = ["發展商：新鴻基地產", "入伙日期：1999", "屋苑單位數目：856伙"].join(
      separator,
    );
    assert.equal(stripCapturedListingFacts(`${description}${separator}${appendix}`), description);
  }
});

test("rental and fee boundaries also protect prose immediately after Chinese punctuation", () => {
  for (const label of ["租金包括", "管理費"]) {
    const terms = `${label}：已包括差餉。可即時入住。`;
    const description = `座數及單位：海琴軒3座中層\n小學校網：71校網\n中學校網：屯門區。${terms}`;
    assert.equal(stripCapturedListingFacts(description), description);
    const prefix = `座數及單位：海琴軒3座中層。${terms}`;
    const appendix = "發展商：新鴻基地產\n入伙日期：1999\n屋苑單位數目：856伙";
    assert.equal(stripCapturedListingFacts(`${prefix}\n${appendix}`), prefix);
  }
});

test("captured estate encyclopedia is removed from the unit description and not returned as facts", () => {
  assert.equal(
    stripCapturedListingFacts(STUFFED),
    "晉誠地產三行聯營深井‧青山公路23年 廿多位同事平均年資超過20年，經驗豐富，信心保證!",
  );
  const collapsed = STUFFED.replace(/\s+/g, " ");
  assert.equal(
    stripCapturedListingFacts(collapsed),
    "晉誠地產三行聯營深井‧青山公路23年 廿多位同事平均年資超過20年，經驗豐富，信心保證!",
  );
  assert.equal(typeof stripCapturedListingFacts(STUFFED), "string");
});

test("a description that is only the encyclopedia appendix does not become fake unit copy", () => {
  assert.equal(
    stripCapturedListingFacts("發展商：新鴻基地產\n入伙日期：1999\n屋苑單位數目：856伙"),
    null,
  );
  assert.equal(stripCapturedListingFacts("   "), null);
  assert.equal(stripCapturedListingFacts(null), null);
  assert.equal(stripCapturedListingFacts(undefined), null);
});

test("feature chips are hidden once an estate record is linked", () => {
  assert.equal(showListingFeatureChips(null), true);
  assert.equal(showListingFeatureChips(undefined), true);
  assert.equal(
    showListingFeatureChips({
      name_zh: "帝濤灣",
      slug: "tai-tou-waan",
      developer: "新鴻基地產",
      year_completed: 1999,
      total_units: 856,
    }),
    false,
  );
});
