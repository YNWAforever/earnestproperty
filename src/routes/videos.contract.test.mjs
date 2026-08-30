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
