import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

// robots.txt is a server route (src/routes/robots[.]txt.ts) so its Sitemap
// line follows SITE_URL rather than a hardcoded host. A static
// public/robots.txt would shadow the route on Vercel, so it must not return.
test("robots.txt is served by the app, not a static file", () => {
  assert.equal(existsSync("public/robots.txt"), false);
});

test("robots.txt disallows staff-only surfaces and points at the sitemap on SITE_URL", () => {
  const source = readFileSync("src/routes/robots[.]txt.ts", "utf8");
  assert.match(source, /Disallow: \/admin/);
  assert.match(source, /Disallow: \/auth/);
  assert.match(source, /Disallow: \/account/);
  assert.match(source, /Disallow: \/api/);
  assert.match(source, /Sitemap: \$\{SITE_URL\}\/sitemap\.xml/);
  assert.doesNotMatch(source, /earnestproperty\.vercel\.app/);
});
