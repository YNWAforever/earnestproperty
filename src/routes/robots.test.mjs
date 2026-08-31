import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("robots.txt disallows staff-only surfaces", () => {
  const source = readFileSync("public/robots.txt", "utf8");
  assert.match(source, /Disallow: \/admin/);
  assert.match(source, /Disallow: \/auth/);
  assert.match(source, /Disallow: \/account/);
  assert.match(source, /Sitemap: https:\/\/earnestproperty\.vercel\.app\/sitemap\.xml/);
});
