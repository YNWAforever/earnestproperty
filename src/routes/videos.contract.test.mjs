import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/routes/videos.tsx", "utf8");

// listings.tsx established this pattern. fallback() is what makes a stale link
// from WhatsApp render the unfiltered page instead of erroring.
test("search params are Zod-validated with fallbacks", () => {
  assert.match(source, /zodValidator\(searchSchema\)/);
  assert.match(source, /from "@tanstack\/zod-adapter"/);
  assert.match(source, /fallback\(/);
});

// The sort vocabulary is English and decoupled from the Chinese labels, so
// rewording 最新 never invalidates a shared link.
test("sort accepts exactly the three documented values", () => {
  assert.match(source, /z\.enum\(\["newest", "oldest", "featured"\]\)/);
});

test("estate and q are optional free text", () => {
  assert.match(source, /estate:\s*fallback\(/);
  assert.match(source, /q:\s*fallback\(/);
});

// P5e2: category is a real admin-assigned column (video-categories.ts), not a
// title-derived heuristic like the estate tag above, so it needs its own
// search-schema field and filter guard on both video arrays.
test("category is a URL search param sourced from the shared taxonomy", () => {
  assert.match(source, /category:\s*fallback\(/);
  assert.match(source, /import \{ VIDEO_CATEGORIES \} from "@\/content\/video-categories"/);
});

test("category filters cmsVideos by the exact stored value", () => {
  assert.match(source, /if \(category && video\.category !== category\) return false;/);
});

test("listing videos are scoped to 樓盤實拍 when any other category is active", () => {
  assert.match(source, /if \(category && category !== "樓盤實拍"\) return \[\];/);
});

test("category chip row renders every named category with a live count", () => {
  assert.match(source, /categoryCounts\.map\(\(entry\) =>/);
  assert.match(source, /VIDEO_CATEGORIES\.map\(\(cat\) => \(\{ category: cat, count:/);
});

// DR-6: VideoObject JSON-LD used to be emitted for every video in the raw
// loader data, regardless of paging or the active search/category filter --
// structured data for content the page doesn't render is misleading to
// crawlers. It must be capped to the rendered/filtered subsets instead.
test("AllVideoSchemas receives the rendered subset, not the full loader data", () => {
  assert.doesNotMatch(
    source,
    /<AllVideoSchemas\s+cmsVideos=\{cmsVideos\}\s+listingVideos=\{listingVideos\}/,
  );
  assert.match(source, /<AllVideoSchemas\s+cmsVideos=\{visibleCmsVideos\}/);
  assert.match(source, /listingVideos=\{matchingListingVideos\}/);
});
