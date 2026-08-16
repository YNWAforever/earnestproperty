import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "src/lib/neon/public-data.server.ts"), "utf8");

test("public CMS reads tolerate databases before published columns are migrated", () => {
  assert.match(source, /COALESCE\(\(to_jsonb\(estates\)->>'published'\)::boolean, true\)/);
  assert.match(source, /COALESCE\(\(to_jsonb\(faqs\)->>'published'\)::boolean, true\)/);
  assert.doesNotMatch(source, /estates\.published\s*=\s*true/);
  assert.doesNotMatch(source, /faqs\.published\s*=\s*true/);
});
