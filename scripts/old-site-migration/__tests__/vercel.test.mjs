import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// FX-13: the old `/?ln=sc|tc` -> `/` rule looped in production, because Vercel keeps
// the request query on a redirect. `/?ln=` now renders the home page, whose canonical
// is the clean `/`. scripts/vercel-config.test.mjs guards every rule against loops.
test("vercel config has no legacy language self-redirect", () => {
  const configSource = readFileSync("vercel.ts", "utf8");

  assert.doesNotMatch(configSource, /key:\s*"ln"/);
  assert.doesNotMatch(configSource, /@vercel\/config/);
});
