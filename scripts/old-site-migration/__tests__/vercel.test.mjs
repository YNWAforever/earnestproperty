import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("vercel config redirects legacy language query selectors to home", () => {
  const configSource = readFileSync("vercel.ts", "utf8");

  assert.match(configSource, /matchers\.query\("ln",\s*\{\s*inc:\s*\["sc",\s*"tc"\]/);
});
