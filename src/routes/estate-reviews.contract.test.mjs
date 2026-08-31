import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");

// Master plan DR-7: the article cover was marked alt="", a real content image
// (not decorative) with no accessible description.
test('estate-reviews article cards use a real alt, never alt=""', () => {
  const source = read("src/routes/estate-reviews.tsx");
  assert.doesNotMatch(source, /alt=""/);
  assert.match(source, /alt=\{article\.title\}/);
});

// P5e2: the district filter reuses estate-registry.ts's existing
// homepageDistrict field (the homepage's own display grouping) rather than a
// second, hand-maintained district map.
test("estate-reviews district filter sources its grouping from the registry, not a guessed map", () => {
  const source = read("src/routes/estate-reviews.tsx");
  assert.match(source, /import \{ getEstateEntry \} from "@\/content\/estate-registry"/);
  assert.match(source, /getEstateEntry\(estate\.slug\)\.homepageDistrict/);
  assert.match(source, /DISTRICT_FILTERS = \["全部", "深井", "青山公路", "汀九"\]/);
});
