import assert from "node:assert/strict";
import test from "node:test";

import { deriveEstateTag } from "./video-tags.js";

// Real titles from the production channel. The full-width ＃ is what this
// channel actually types; the ASCII # appears occasionally.
test("the estate token is read from the ＃ marker", () => {
  assert.equal(
    deriveEstateTag("💚＃黃金海灣.珀岸💚 《417呎 580萬》2房高層遊艇會海+沙灘海景！優質單位！")?.tag,
    "黃金海灣",
  );
  assert.equal(
    deriveEstateTag("💚＃NAPA 💚 《484呎+132呎花園 550萬》 兩房梗廚！特高樓底！")?.tag,
    "NAPA",
  );
  assert.equal(deriveEstateTag("#豪景花園 三房套 靚裝")?.tag, "豪景花園");
});

// 3 of 97 production titles carry no marker at all -- market-commentary videos
// titled 【北部都會區】... These must not become a tag.
test("titles without a marker yield no tag", () => {
  assert.equal(
    deriveEstateTag("【北部都會區】古洞新盤大戰！買邊個潛力更大？｜晉誠地產《樓市當面講》"),
    null,
  );
  assert.equal(deriveEstateTag(""), null);
  assert.equal(deriveEstateTag(null), null);
  assert.equal(deriveEstateTag(undefined), null);
});
