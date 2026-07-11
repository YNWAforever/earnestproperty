import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "src/lib/neon/public-data.server.ts"), "utf8");

test("public estate and FAQ reads only expose published canonical rows", () => {
  assert.match(source, /SELECT slug, name_zh FROM estates WHERE COALESCE/);
  assert.match(source, /FROM estates[\s\S]*?WHERE district_slug = \$1[\s\S]*?to_jsonb\(estates\)/);
  assert.match(source, /SELECT \* FROM estates WHERE slug = \$1[\s\S]*?to_jsonb\(estates\)/);
  assert.match(source, /FROM faqs[\s\S]*?WHERE scope = \$1[\s\S]*?to_jsonb\(faqs\)/);
  assert.doesNotMatch(source, /cms_content_revisions/);
});
