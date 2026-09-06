import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");

// Old-site URLs (/property-detail/6621030.html) used to hit a blanket vercel.ts
// redirect to /listings -- a many-to-one redirect Google scores as a soft 404,
// discarding every legacy listing's equity. They now resolve in the app
// against properties.legacy_detail_id and 301 to the unit's canonical page.
test("legacy /property-detail/:id.html URLs resolve per listing, not to a blanket /listings", () => {
  const vercel = read("vercel.ts");
  assert.doesNotMatch(
    vercel,
    /redirectEntry\("\/property-detail\/:oldId\.html", "\/listings"/,
    "the blanket many-to-one redirect must not return",
  );
  // The English mirror still funnels into the app route.
  assert.match(vercel, /"\/eng\/property-detail\/:oldId\.html", "\/property-detail\/:oldId\.html"/);

  const route = read("src/routes/property-detail.$file.ts");
  assert.match(route, /createFileRoute\("\/property-detail\/\$file"\)/);
  assert.match(route, /fetchPropertyByLegacyDetailId\(\{ oldId \}\)/);
  assert.match(route, /statusCode: 301/);
  assert.match(route, /LEGACY_DETAIL_FALLBACK = "\/listings"/);
});

test("parseLegacyDetailId accepts only the old site's numeric .html file names", () => {
  const route = read("src/routes/property-detail.$file.ts");
  const match = route.match(/const LEGACY_FILE = (\/.*\/i);/);
  assert.ok(match, "expected the LEGACY_FILE pattern");
  const pattern = new Function(`return ${match[1]};`)();
  assert.equal(pattern.exec("6621030.html")?.[1], "6621030");
  assert.equal(pattern.exec("6621030.HTM")?.[1], "6621030");
  assert.equal(pattern.exec("../admin"), null);
  assert.equal(pattern.exec("6621030"), null);
});

// P0-1: the production origin must not be a hardcoded deployment host.
test("SITE_URL is env-driven with the vercel.app origin only as a fallback", () => {
  const seo = read("src/content/seo.ts");
  assert.match(seo, /VITE_SITE_URL/);
  assert.match(seo, /FALLBACK_SITE_URL = "https:\/\/earnestproperty\.vercel\.app"/);
  assert.match(read("scripts/check-required-env.mjs"), /VITE_SITE_URL/);
  assert.match(read("vercel.ts"), /type: "host", value: FALLBACK_HOST/);
  assert.match(read(".env.example"), /VITE_SITE_URL=/);
});

// P0-4: listing detail pages belong in the sitemap.
test("sitemap lists active listing detail pages with a real lastmod", () => {
  const sitemap = read("src/routes/sitemap[.]xml.ts");
  assert.match(sitemap, /fetchSitemapListings\(\)/);
  assert.match(sitemap, /\.\.\.listingPaths,/);
  assert.match(
    read("src/lib/neon/public-data.server.ts"),
    /WHERE p\.status = 'active'\s+GROUP BY ppm\.public_listing_no/,
  );
});
