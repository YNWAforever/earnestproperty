import assert from "node:assert/strict";
import test from "node:test";

import { cleanVideoText, summarizeVideoDescription } from "./video-description.js";

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
