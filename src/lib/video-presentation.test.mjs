import assert from "node:assert/strict";
import test from "node:test";

import { summarizeVideoDescription } from "./video-description.js";
import { getYouTubeThumbnailUrl } from "./youtube-video-url.js";

test("thumbnail URLs are derived from the same video id as the embed", () => {
  assert.equal(
    getYouTubeThumbnailUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  );
  assert.equal(
    getYouTubeThumbnailUrl("https://youtu.be/dQw4w9WgXcQ"),
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  );
  assert.equal(getYouTubeThumbnailUrl("https://example.com/video"), null);
  assert.equal(getYouTubeThumbnailUrl(null), null);
});

// The channel's descriptions repeat the listing's agency boilerplate: licence
// numbers, listing ids, and an agent's personal mobile. Rendering the raw field
// republished those on /videos, and at up to 987 characters it also stretched
// grid cards from 456px to 1047px tall.
test("agency boilerplate is cut from the summary", () => {
  const raw =
    "黃金海灣 珀岸 417呎 580萬 2房高層海景\n\n" +
    "樓盤編號 : B072564 刊登日期 : 21/07/2026 公司牌照 : C-018613 " +
    "地產代理 : MON 劉小姐 61713023 (E-265278)";
  const summary = summarizeVideoDescription(raw);

  assert.equal(summary, "黃金海灣 珀岸 417呎 580萬 2房高層海景");
  assert.doesNotMatch(summary, /61713023/, "an agent's mobile must not survive");
  assert.doesNotMatch(summary, /C-018613|E-265278/, "licence numbers must not survive");
  assert.doesNotMatch(summary, /樓盤編號|刊登日期/);
});

test("long prose is truncated with an ellipsis", () => {
  const summary = summarizeVideoDescription("あ".repeat(200), 120);
  assert.equal(summary.length, 121, "120 characters plus the ellipsis");
  assert.ok(summary.endsWith("…"));
});

test("short descriptions are returned unchanged", () => {
  assert.equal(summarizeVideoDescription("深井 睇樓影片"), "深井 睇樓影片");
});

test("whitespace is collapsed so cards stay even", () => {
  assert.equal(summarizeVideoDescription("深井\n\n\n  睇樓   影片  "), "深井 睇樓 影片");
});

// A card whose description reduces to nothing must render no paragraph at all,
// rather than an empty one that still occupies vertical space in the grid.
test("empty and metadata-only descriptions collapse to null", () => {
  assert.equal(summarizeVideoDescription("樓盤編號 : B072564 公司牌照 : C-018613"), null);
  assert.equal(summarizeVideoDescription("   \n  "), null);
  assert.equal(summarizeVideoDescription(""), null);
  assert.equal(summarizeVideoDescription(null), null);
  assert.equal(summarizeVideoDescription(undefined), null);
});
