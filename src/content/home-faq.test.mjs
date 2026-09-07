import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { castlePeakRoadHub } from "./castle-peak-road.ts";
import { estateRegistry } from "./estate-registry.ts";
import { earnestPublicTrust } from "./estate-pages.ts";
import { castlePeakRoadHomeFaqs } from "./home-faq.ts";
import { schoolNets } from "./school-nets.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const answers = castlePeakRoadHomeFaqs.map((faq) => faq.answer).join("\n");

test("the homepage 青山公路 FAQ has real questions and answers", () => {
  assert.ok(castlePeakRoadHomeFaqs.length >= 5, "a 5-question FAQ is the floor worth shipping");
  for (const faq of castlePeakRoadHomeFaqs) {
    assert.ok(faq.question.trim().length > 0, "a question is blank");
    assert.ok(faq.answer.trim().length > 0, `"${faq.question}" has a blank answer`);
    // renderableFaqs drops blanks before render, but a blank here would mean
    // the derivation silently produced nothing.
    assert.ok(faq.answer.trim().length > 30, `"${faq.question}" has a stub answer`);
    assert.match(faq.question, /？$/, `"${faq.question}" should read as a question`);
  }
  const questions = castlePeakRoadHomeFaqs.map((faq) => faq.question);
  assert.equal(new Set(questions).size, questions.length, "two questions are identical");
});

test("it does not republish the corridor page's own FAQ", () => {
  // castlePeakRoadHub.faqs already render on /castle-peak-road. Repeating them
  // here would put the same Q&A, and the same FAQPage entities, on two
  // indexable pages.
  const hubQuestions = new Set(castlePeakRoadHub.faqs.map((faq) => faq.question));
  const hubAnswers = new Set(castlePeakRoadHub.faqs.map((faq) => faq.answer));
  for (const faq of castlePeakRoadHomeFaqs) {
    assert.ok(!hubQuestions.has(faq.question), `"${faq.question}" duplicates the corridor hub`);
    assert.ok(!hubAnswers.has(faq.answer), `"${faq.question}" reuses a corridor hub answer`);
  }
});

test("the estate count and area split are derived, so they cannot drift", () => {
  const withPage = estateRegistry.filter((entry) => entry.hasPage);
  assert.match(answers, new RegExp(`${withPage.length} 個屋苑設獨立屋苑專頁`));

  const byArea = new Map();
  for (const entry of withPage) {
    const area = (entry.locationLabelZh ?? "").split(/[／/]/)[0].trim();
    if (area) byArea.set(area, (byArea.get(area) ?? 0) + 1);
  }
  for (const [area, count] of byArea) {
    assert.match(answers, new RegExp(`${area} ${count} 個`), `${area} count is wrong or missing`);
  }
  // The counts must add up to the total, so no area is quietly dropped.
  assert.equal(
    [...byArea.values()].reduce((sum, count) => sum + count, 0),
    withPage.length,
  );
});

test("school nets are cited by code only, never by school name", () => {
  for (const net of Object.values(schoolNets)) {
    assert.deepEqual(net.primarySchools, [], "this test assumes no school list is sourced yet");
  }
  assert.match(answers, /62 校網（荃灣）/);
  assert.match(answers, /71 校網（屯門）/);
  // 小學名單 is the one permitted use of 小學: the answer says no list is
  // published, which is school-nets.ts's own rule.
  assert.ok(
    !/小學|中學/.test(answers.replace(/小學名單/g, "").replace(/小一入學統一派位選校名冊/g, "")),
    "the FAQ names a school",
  );
});

test("contact details come from the shared trust block, not retyped", () => {
  assert.ok(answers.includes(earnestPublicTrust.licenceNo));
  assert.ok(answers.includes(earnestPublicTrust.phoneDisplay));
  assert.ok(answers.includes(earnestPublicTrust.address));
  const source = read("src/content/home-faq.ts");
  // A hardcoded copy would drift from the estate pages' own trust proof.
  assert.doesNotMatch(source, /C-018613/);
  assert.doesNotMatch(source, /2688 2988/);
});

test("no price, developer, year or unit-count claim", () => {
  // Those live in the database and reach the reader through the estate pages
  // and comparison tables, never through hand-written homepage copy.
  assert.doesNotMatch(answers, /萬|呎價 \$|發展商/);
  assert.doesNotMatch(answers, /(19|20)\d{2} 年落成/);
});

test("the homepage renders both FAQ sections under one FAQPage", () => {
  const home = read("src/routes/index.tsx");
  assert.match(home, /title="深井買樓租樓 FAQ"/);
  assert.match(home, /title="青山公路屋苑買樓租樓 FAQ"/);
  assert.match(home, /castlePeakRoadHomeFaqs/);
  // Two FAQPage scripts on one URL declare two competing FAQ entities for the
  // same document, so the two sets share a single script.
  assert.equal(
    (home.match(/"@type": "FAQPage"/g) ?? []).length,
    1,
    "the homepage must emit exactly one FAQPage",
  );
  assert.match(home, /mainEntity: allFaqs\.map/);
  // A CMS row under the 青山公路 scope must still win over the static set.
  assert.match(home, /fetchFaqs\("district:castle-peak-road"\)/);
  assert.match(home, /corridorRows\.length > 0 \? corridorRows : \[\.\.\.castlePeakRoadHomeFaqs\]/);
});

test("the 最新放盤 section header carries no subtitle", () => {
  // #133/#134 renamed this section from 精選筍盤 to 最新放盤 and gave it the
  // subtitle 「按最新上架排序，隨時 WhatsApp 查詢及預約睇樓。」; the rename stays,
  // the subtitle was dropped at the client's request.
  const home = read("src/routes/index.tsx");
  assert.match(home, /title="最新放盤"/, "the section itself must stay");
  assert.doesNotMatch(home, /隨時 WhatsApp 查詢及預約睇樓/, "the removed subtitle is back");
  assert.doesNotMatch(home, /按最新上架排序/, "the removed subtitle is back");
});
