import assert from "node:assert/strict";
import test from "node:test";
import { toHomeVideos } from "./home-videos.js";

const walk = (id, ytId) => ({
  key: `listing-${id}`,
  title: `Listing ${id}`,
  url: `https://www.youtube.com/watch?v=${ytId}`,
  eyebrow: "深井 · 出售",
  listingNo: `T${id}`,
});
const cms = (id, ytId, extra = {}) => ({
  id,
  title: `Channel ${id}`,
  video_url: `https://youtu.be/${ytId}`,
  ...extra,
});

test("listing walkthroughs come first, then channel videos", () => {
  const out = toHomeVideos([walk(1, "aaaaaaaaaaa")], [cms("c1", "bbbbbbbbbbb")], 3);
  assert.deepEqual(
    out.map((v) => v.key),
    ["listing-1", "cms-c1"],
  );
  assert.equal(out[1].eyebrow, "官方頻道");
  assert.equal(out[1].listingNo, null);
});

test("duplicate YouTube ids are dropped", () => {
  const out = toHomeVideos(
    [walk(1, "aaaaaaaaaaa")],
    [cms("c1", "aaaaaaaaaaa"), cms("c2", "bbbbbbbbbbb")],
    3,
  );
  assert.deepEqual(
    out.map((v) => v.key),
    ["listing-1", "cms-c2"],
  );
});

test("capped at three", () => {
  const out = toHomeVideos(
    [walk(1, "aaaaaaaaaaa"), walk(2, "bbbbbbbbbbb")],
    [cms("c1", "ccccccccccc"), cms("c2", "ddddddddddd")],
    3,
  );
  assert.equal(out.length, 3);
});

test("each item carries only key, title, url, eyebrow and listingNo", () => {
  const out = toHomeVideos(
    [{ ...walk(1, "aaaaaaaaaaa"), description: "long" }],
    [cms("c1", "bbbbbbbbbbb", { description: "x".repeat(5000) })],
    3,
  );
  for (const item of out) {
    assert.deepEqual(Object.keys(item).sort(), ["eyebrow", "key", "listingNo", "title", "url"]);
  }
});
