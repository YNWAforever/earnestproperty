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

// A canonical SEO URL is not proof that DNS/the custom host serves this app.
test("custom-domain redirect is opt-in independently of the SEO origin", async () => {
  const { execFileSync } = await import("node:child_process");
  function redirects(flag, origin = "https://www.earnestproperty.com") {
    return JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "--input-type=module",
          "-e",
          "import {config} from './vercel.ts'; console.log(JSON.stringify(config.redirects.filter(r=>r.has?.some(h=>h.type==='host'))));",
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: { ...process.env, VITE_SITE_URL: origin, CANONICAL_HOST_REDIRECT_ENABLED: flag },
        },
      ),
    );
  }
  assert.deepEqual(redirects(""), []);
  assert.deepEqual(redirects("false"), []);
  assert.equal(redirects("true")[0].destination, "https://www.earnestproperty.com/:path*");
  assert.deepEqual(redirects("true", "https://earnestproperty.vercel.app"), []);
});
