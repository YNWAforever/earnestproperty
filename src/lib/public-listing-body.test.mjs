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
