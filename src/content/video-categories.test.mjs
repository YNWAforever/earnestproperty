import assert from "node:assert/strict";
import test from "node:test";

import { isVideoCategory, VIDEO_CATEGORIES } from "./video-categories.ts";

test("VIDEO_CATEGORIES has exactly the 4 master-plan categories, in order", () => {
  assert.deepEqual(VIDEO_CATEGORIES, ["樓盤實拍", "屋苑開箱", "市場評論", "社區生活"]);
});

test("isVideoCategory accepts only the named 4 categories", () => {
  for (const category of VIDEO_CATEGORIES) {
    assert.equal(isVideoCategory(category), true);
  }
  assert.equal(isVideoCategory("其他"), false);
  assert.equal(isVideoCategory(""), false);
});
