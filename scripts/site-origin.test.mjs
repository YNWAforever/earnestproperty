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

// The host redirect is generated only by production builds whose origin is a
// custom (non-vercel.app) https host. Previews never get it.
test("custom-domain redirect follows the production origin, never a vercel.app origin", async () => {
  const { execFileSync } = await import("node:child_process");
  function redirects(VERCEL_ENV, VITE_SITE_URL = "https://www.earnestproperty.com") {
    const env = { PATH: process.env.PATH, VERCEL_ENV, VITE_SITE_URL };
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
    return JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "--no-warnings",
          "--input-type=module",
          "-e",
          "import {config} from './vercel.ts'; console.log(JSON.stringify(config.redirects.filter(r=>r.has?.some(h=>h.type==='host'))));",
        ],
        { cwd: process.cwd(), encoding: "utf8", env },
      ),
    );
  }
  const production = redirects("production");
  assert.equal(production.length, 1);
  assert.equal(production[0].destination, "https://www.earnestproperty.com/$1");
  assert.deepEqual(redirects("production", "https://earnestproperty.vercel.app"), []);
  assert.deepEqual(redirects("preview"), []);
});
