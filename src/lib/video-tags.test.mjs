import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { deriveEstateTag, ESTATE_DISTRICTS } from "./video-tags.js";

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

// 浪翠園一期 and 浪翠園三期 are one estate. Left raw they become two chips,
// which reads as broken to anyone who knows the area.
test("phases fold into their parent estate", () => {
  assert.equal(deriveEstateTag("💚＃浪翠園一期💚 《800呎》3房海景")?.tag, "浪翠園");
  assert.equal(deriveEstateTag("💚＃浪翠園三期💚 《900呎》4房")?.tag, "浪翠園");
  assert.equal(deriveEstateTag("💚＃黃金海灣意嵐 💚 《306呎 345萬》1房高層開揚")?.tag, "黃金海灣");
  assert.equal(deriveEstateTag("💚＃黃金海灣.珀岸💚 《417呎》2房")?.tag, "黃金海灣");
});

// 晉誠地產 is the agency's own market-commentary tag, not a place. A 晉誠地產
// chip on an estate filter is a category error.
test("non-estate tokens are dropped", () => {
  assert.equal(deriveEstateTag("＃晉誠地產 樓市分析 2026"), null);
});

// An estate nobody has curated still filters -- this is the degradation path.
test("unknown estates still produce a tag", () => {
  assert.equal(deriveEstateTag("💚＃漣山💚 《650呎》2房")?.tag, "漣山");
  assert.equal(deriveEstateTag("💚＃愛琴海岸💚 《700呎》3房")?.tag, "愛琴海岸");
});

// core-estates.ts deliberately leaves district null where the client has not
// said, rather than putting a false location on a real estate. Tags inherit that
// discipline: an estate the curated list does not know gets null, never a guess.
test("district comes from the curated list, and is null when unknown", () => {
  assert.equal(deriveEstateTag("💚＃豪景花園💚 《700呎》3房")?.district, "青山公路");
  assert.equal(deriveEstateTag("💚＃碧堤半島💚 《900呎》4房")?.district, "深井");
  // 帝華軒 is in the curated list but its district is deliberately null there.
  assert.equal(deriveEstateTag("💚＃帝華軒💚 《500呎》2房")?.district, null);
  // 漣山 is not in the curated list at all.
  assert.equal(deriveEstateTag("💚＃漣山💚 《650呎》2房")?.district, null);
});

// ESTATE_DISTRICTS is hand-duplicated from src/content/core-estates.ts (see the
// comment on ESTATE_DISTRICTS for why it isn't imported). Without this guard, a
// district edited in one file and not the other would fail silently -- the site
// would just show a video under the wrong district with no test to catch it.
test("ESTATE_DISTRICTS agrees with src/content/core-estates.ts", () => {
  const coreEstatesPath = fileURLToPath(new URL("../content/core-estates.ts", import.meta.url));
  const source = readFileSync(coreEstatesPath, "utf8");

  for (const [name, expectedDistrict] of ESTATE_DISTRICTS) {
    const nameIndex = source.indexOf(`name: "${name}"`);
    assert.notEqual(nameIndex, -1, `${name} is no longer in core-estates.ts`);

    const entry = source.slice(nameIndex);
    const districtMatch = entry.match(/district:\s*("(?:[^"\\]|\\.)*"|null)/);
    assert.ok(districtMatch, `${name}'s entry in core-estates.ts has no district field`);

    const declaredDistrict = districtMatch[1] === "null" ? null : JSON.parse(districtMatch[1]);
    assert.equal(
      declaredDistrict,
      expectedDistrict,
      `ESTATE_DISTRICTS says ${name} -> ${JSON.stringify(expectedDistrict)}, ` +
        `but core-estates.ts declares ${JSON.stringify(declaredDistrict)}`,
    );
  }
});
