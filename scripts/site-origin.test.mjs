import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeOrigin, resolveSiteOrigin } from "./site-origin.mjs";

test("normalizeOrigin accepts bare hosts and origins, strips paths and slashes", () => {
  assert.equal(normalizeOrigin("earnestproperty.vercel.app"), "https://earnestproperty.vercel.app");
  assert.equal(
    normalizeOrigin("https://www.earnestproperty.com/"),
    "https://www.earnestproperty.com",
  );
  assert.equal(normalizeOrigin("https://x.example/path?q=1"), "https://x.example");
  assert.equal(normalizeOrigin(""), null);
  assert.equal(normalizeOrigin(undefined), null);
  assert.equal(normalizeOrigin("ftp://x.example"), null);
});

test("resolveSiteOrigin prefers VITE_SITE_URL, then Vercel's production URL, else null", () => {
  assert.equal(
    resolveSiteOrigin({
      VITE_SITE_URL: "https://www.earnestproperty.com",
      VERCEL_PROJECT_PRODUCTION_URL: "earnestproperty.vercel.app",
    }),
    "https://www.earnestproperty.com",
  );
  assert.equal(
    resolveSiteOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "earnestproperty.vercel.app" }),
    "https://earnestproperty.vercel.app",
  );
  assert.equal(resolveSiteOrigin({}), null);
});
