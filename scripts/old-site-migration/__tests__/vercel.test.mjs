import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("vercel config redirects legacy language query selectors to home", () => {
  const configSource = readFileSync("vercel.ts", "utf8");

  assert.match(configSource, /type:\s*"query"/);
  assert.match(configSource, /key:\s*"ln"/);
  assert.match(configSource, /value:\s*"\^\(sc\|tc\)\$"/);
  assert.doesNotMatch(configSource, /@vercel\/config/);
});
