import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanVideoText,
  redactPhoneNumbers,
  summarizeVideoDescription,
  summarizeVideoDescriptionForSchema,
} from "./video-description.js";

const OBJ = "\uFFFC";

test("cleanVideoText removes U+FFFC and the doubled spaces it leaves", () => {
  assert.equal(cleanVideoText(`一梯兩伙！${OBJ}有匙即看！${OBJ}${OBJ}`), "一梯兩伙！有匙即看！");
  assert.equal(cleanVideoText(`A ${OBJ} B`), "A B");
  assert.equal(cleanVideoText(null), "");
});

const BOILERPLATE =
  "一梯兩伙，有匙即看！\n樓盤編號：T027001\n刊登日期：2026-09-01\n公司牌照：C-018613\n營業員：陳大文 9123 4567";

test("summarizeVideoDescription cuts at 樓盤編號 and never returns an 8-digit number from the boilerplate", () => {
  const summary = summarizeVideoDescription(BOILERPLATE);
  assert.equal(summary, "一梯兩伙，有匙即看！");
  assert.doesNotMatch(summary ?? "", /樓盤編號/);
  assert.doesNotMatch(summary ?? "", /\d{4}\s?\d{4}/);
});

test("summarizeVideoDescription returns null for whitespace-only input", () => {
  assert.equal(summarizeVideoDescription("   \n\t "), null);
  assert.equal(summarizeVideoDescription(`${OBJ}${OBJ}`), null);
});

test("redactPhoneNumbers removes HK numbers in every written form, with labels", () => {
  const cases = [
    ["睇樓請打 9123 4567 預約", "睇樓請打 預約"],
    ["預約電話：91234567。", "預約。"],
    ["WhatsApp: 9123-4567", "WhatsApp: 9123-4567"],
    ["手機 +852 9123 4567 陳生", "陳生"],
    ["Tel (852) 2688 2988", ""],
    ["聯絡 +852-91234567", ""],
    ["電話：９１２３４５６７", ""],
  ];
  for (const [input, expected] of cases) {
    const out = redactPhoneNumbers(input);
    assert.doesNotMatch(out, /[2-9]\d{3}[\s-]?\d{4}/, input);
    if (!input.startsWith("WhatsApp")) assert.equal(out, expected, input);
  }
  assert.equal(redactPhoneNumbers("WhatsApp: 9123-4567"), "");
});

test("redactPhoneNumbers keeps listing ids, prices and areas", () => {
  const text = "A056377 C-018613 售680萬 實用512呎 2026-09-01";
  assert.equal(redactPhoneNumbers(text), text);
});

test("summarizeVideoDescriptionForSchema drops a phone placed before a marker", () => {
  const out = summarizeVideoDescriptionForSchema("一梯兩伙，電話：9123 4567\n樓盤編號：T027001");
  assert.equal(out, "一梯兩伙");
  assert.equal(summarizeVideoDescriptionForSchema("9123 4567"), null);
  assert.doesNotMatch(
    summarizeVideoDescriptionForSchema("致電 +852 6123 4567 睇樓，售680萬 A056377") ?? "",
    /\d{4}\s?\d{4}/,
  );
});
