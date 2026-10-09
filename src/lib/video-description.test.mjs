import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanVideoText,
  redactPhoneNumbers,
  summarizeVideoDescription,
  summarizeVideoDescriptionForSchema,
  videoSchemaText,
} from "./video-description.js";
import { visibleCategoryChips } from "./video-category-chips.js";

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

const LEAKS = [
  ["double space", "打 9123  4567 預約", "打 預約"],
  ["single space", "睇樓請打 9123 4567 預約", "睇樓請打 預約"],
  ["dot", "9123.4567", ""],
  ["pairs", "91 23 45 67", ""],
  ["slash", "9123/4567", ""],
  ["hyphen", "9123-4567", ""],
  ["plain", "預約電話：91234567。", "預約。"],
  ["+852 spaced", "+852 9123 4567", ""],
  ["+852 hyphen", "+852-91234567", ""],
  ["(852) landline", "(852) 2688-2988", ""],
  ["852 bare", "85291234567", ""],
  ["fullwidth digits", "電話：９１２３４５６７", ""],
  ["fullwidth space", "９１２３　４５６７", ""],
  ["WhatsApp label", "WhatsApp: 9123-4567 陳生", "陳生"],
  ["Whatsapp label", "Whatsapp 9123 4567", ""],
  ["手機 label", "手機 +852 9123 4567 陳生", "陳生"],
  ["Tel label", "Tel (852) 2688 2988", ""],
  ["Call label", "Call 6123 4567 now", "now"],
  ["致電 label", "致電 61234567 睇樓", "睇樓"],
  ["聯絡 label", "聯絡 +852-91234567", ""],
  ["after id run", "T027001 9123 4567", "T027001"],
  ["two numbers", "9123 4567 / 2688 2988 查詢", "查詢"],
];

for (const [name, input, expected] of LEAKS) {
  test(`redactPhoneNumbers removes: ${name}`, () => {
    assert.equal(redactPhoneNumbers(input), expected);
  });
}

const KEPT = [
  ["price after 價", "價 6800 0000"],
  ["price in 萬", "6800萬"],
  ["price in 萬 spaced", "成交 6800 萬"],
  ["price with $", "$68000000"],
  ["price with HK$", "HK$ 6800 0000"],
  ["price after 售 with unit", "售 680萬"],
  ["rent after 租 with $", "租 $28,000"],
  ["rent in 萬", "租 2萬8"],
  ["rent in 元", "租 28000000 元"],
  ["height", "高度 20000000 呎"],
  ["area in 呎", "512呎"],
  ["area in 平方呎", "20000000 平方呎"],
  ["area sq ft", "20000000 sq ft"],
  ["compact date", "20260901"],
  ["spaced date", "2026 0901"],
  ["hyphen date", "2026-09-01"],
  ["year", "2026年9月"],
  ["listing id", "A056377"],
  ["company licence", "C-018613"],
  ["long id", "T0270012345"],
];

for (const [name, input] of KEPT) {
  test(`redactPhoneNumbers keeps: ${name}`, () => {
    assert.equal(redactPhoneNumbers(input), input);
  });
}

const STUBS = [
  ["empty fullwidth brackets", "睇樓（9123 4567）", "睇樓"],
  ["empty brackets", "Call (9123 4567) now", "now"],
  ["wa.me stub", "wa.me/85291234567 查詢", "查詢"],
  ["chat stub", "WhatsApp chat 91234567.", "."],
  ["doubled punctuation", "睇樓，9123 4567，歡迎", "睇樓，歡迎"],
  ["trailing separator", "歡迎查詢：9123 4567", "歡迎查詢"],
];

for (const [name, input, expected] of STUBS) {
  test(`redactPhoneNumbers cleans stubs: ${name}`, () => {
    assert.equal(redactPhoneNumbers(input), expected);
  });
}

test("redactPhoneNumbers handles non-strings", () => {
  assert.equal(redactPhoneNumbers(null), "");
  assert.equal(redactPhoneNumbers(undefined), "");
});

test("summarizeVideoDescriptionForSchema drops a phone placed before a marker", () => {
  assert.equal(
    summarizeVideoDescriptionForSchema("一梯兩伙，電話：9123 4567\n樓盤編號：T027001"),
    "一梯兩伙",
  );
  assert.equal(summarizeVideoDescriptionForSchema("9123 4567"), null);
  assert.equal(
    summarizeVideoDescriptionForSchema("致電 +852 6123 4567 睇樓，售680萬 A056377"),
    "睇樓，售680萬 A056377",
  );
});

test("videoSchemaText gives a phone-free name and description", () => {
  const out = videoSchemaText(
    {
      title: "￼深井三房 致電 9123 4567",
      description: "海景單位 whatsapp 9123.4567\n樓盤編號：T027001\n營業員 9876 5432",
    },
    "FALLBACK",
  );
  assert.deepEqual(out, { name: "深井三房", description: "海景單位" });
  assert.equal(
    videoSchemaText({ title: "9123 4567", description: null }, "FALLBACK").name,
    "FALLBACK",
  );
  assert.equal(videoSchemaText({ title: null, description: "" }, "FALLBACK").description, null);
});

test("visibleCategoryChips hides empty categories but keeps the selected one", () => {
  const cats = ["樓盤實拍", "屋苑開箱", "市場評論"];
  const none = visibleCategoryChips([{ category: null }, {}], cats, undefined);
  assert.deepEqual(none, []);
  const some = visibleCategoryChips(
    [{ category: "屋苑開箱" }, { category: "屋苑開箱" }, { category: "樓盤實拍" }],
    cats,
    undefined,
  );
  assert.deepEqual(some, [
    { category: "樓盤實拍", count: 1 },
    { category: "屋苑開箱", count: 2 },
  ]);
  assert.deepEqual(visibleCategoryChips([], cats, "市場評論"), [
    { category: "市場評論", count: 0 },
  ]);
  assert.deepEqual(visibleCategoryChips([{ category: "樓盤實拍" }], cats, "市場評論"), [
    { category: "樓盤實拍", count: 1 },
    { category: "市場評論", count: 0 },
  ]);
});

// Fix round 3: every separator form, and labels always win over exemptions.
const SEPARATOR_LEAKS = [
  ["NBSP", "9123 4567"],
  ["narrow NBSP", "9123 4567"],
  ["ideographic space", "9123　4567"],
  ["en dash", "9123–4567"],
  ["em dash", "9123—4567"],
  ["fullwidth hyphen", "9123－4567"],
  ["non-breaking hyphen", "9123‑4567"],
  ["minus sign", "9123−4567"],
  ["fullwidth digits with fullwidth hyphen", "９１２３－４５６７"],
  ["fullwidth full stop", "9123．4567"],
  ["fullwidth slash with spaces", "9123 ／ 4567"],
  ["middle dot", "9123·4567"],
  ["katakana middle dot", "9123・4567"],
  ["bullet", "9123•4567"],
  ["newline", "9123\n4567"],
  ["tab", "9123\t4567"],
  ["comma", "9123,4567"],
  ["ideographic comma", "9123、4567"],
  ["underscore", "9123_4567"],
  ["comma and space", "9123, 4567"],
];

for (const [name, input] of SEPARATOR_LEAKS) {
  test(`redactPhoneNumbers removes with separator: ${name}`, () => {
    assert.equal(redactPhoneNumbers(input), "");
  });
}

const LABEL_WINS = [
  ["rent prefix, no marker", "租 91234567", "租"],
  ["sale prefix, no marker", "售 91234567", "售"],
  ["label then 元", "聯絡 9123 4567 元", "元"],
  ["label then 呎", "WhatsApp 9123 4567 呎", "呎"],
  ["label then 呎 without space", "電話 9123 4567呎", "呎"],
  ["label then 萬", "Tel 9123 4567 萬", "萬"],
  ["label after 價", "價 電話 9123 4567", "價"],
  ["label then compact date shape", "致電 20260901", ""],
  ["chat label then 呎", "chat 61234567 呎", "呎"],
];

for (const [name, input, expected] of LABEL_WINS) {
  test(`redactPhoneNumbers label wins: ${name}`, () => {
    assert.equal(redactPhoneNumbers(input), expected);
  });
}

test("redactPhoneNumbers keeps the original punctuation around a removed number", () => {
  assert.equal(redactPhoneNumbers("睇樓，致電 9123 4567，歡迎"), "睇樓，歡迎");
  assert.equal(redactPhoneNumbers("查詢（９１２３ ４５６７）"), "查詢");
});
