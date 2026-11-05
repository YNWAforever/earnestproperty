import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

const routeUrl = new URL("./llms[.]txt.ts", import.meta.url);
let caseId = 0;

// Only the router registration and external reads are replaced. The actual
// route handler and real estate SEO registry run under Node's TS stripping.
async function getLlms({
  estates = {},
  transactions = [],
  failEstates = false,
  failTransactions = false,
  suppressed = [],
  failVisibility = false,
  publishedArticles = [
    { slug: "sham-tseng-buying-guide-2026" },
    { slug: "bellagio-vs-sea-crest-villa-vs-hong-kong-garden" },
  ],
} = {}) {
  assert.ok(existsSync(routeUrl), "llms.txt needs an app route");
  const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const replacements = {
        "@/lib/blog/public": moduleUrl(
          'export const blogNoStoreHeaders = () => ({"Cache-Control":"no-store","CDN-Cache-Control":"no-store","Vercel-CDN-Cache-Control":"no-store"});',
        ),
        "@tanstack/react-router": moduleUrl(
          "export const createFileRoute = id => options => ({ id, ...options });",
        ),
        "@/content/seo": new URL("../content/seo.ts", import.meta.url).href,
        "@/content/blog-articles": moduleUrl(`export function publishedBlogArticles() {
          return ${JSON.stringify(publishedArticles)};
        }`),
        "@/lib/neon/public-data.server": moduleUrl(`export async function fetchSitemapTimestamps() {
          ${failEstates || failVisibility ? 'throw new Error("unavailable");' : `return ${JSON.stringify({ estates, articles: Object.fromEntries(publishedArticles.filter((a) => !suppressed.includes(a.slug)).map((a) => [a.slug, null])) })};`}
        }`),
        "@/lib/queries": moduleUrl(`export async function fetchRecentTransactions(options) {
          if (options.limit !== 1) throw new Error("expected sitemap data-exists probe");
          ${failTransactions ? 'throw new Error("unavailable");' : `return ${JSON.stringify(transactions)};`}
        }`),
      };
      return replacements[specifier]
        ? { url: replacements[specifier], shortCircuit: true }
        : nextResolve(specifier, context);
    },
  });
  try {
    const { Route } = await import(`${routeUrl.href}?case=${caseId++}`);
    assert.equal(Route.id, "/llms.txt");
    return await Route.server.handlers.GET();
  } finally {
    hooks.deregister();
  }
}

test("llms.txt is an app route using SITE_URL, never a shadowing public file", () => {
  assert.equal(existsSync("public/llms.txt"), false);
  assert.ok(existsSync(routeUrl), "llms.txt needs an app route");
  const source = readFileSync(routeUrl, "utf8");
  assert.match(source, /import.*SITE_URL.*from "@\/content\/seo"/);
  assert.doesNotMatch(source, /vercel\.app/);
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(pkg.scripts["test:seo"].includes("src/routes/llms.test.mjs"));
});

test("GET returns Chinese-first bilingual navigation as fresh plain text", async () => {
  const response = await getLlms();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.text();
  assert.match(body, /^# 晉誠地產 Earnest Property/);
  assert.match(body, /C-018613/);
  for (const area of ["深井", "青山公路", "汀九", "青龍頭"]) assert.ok(body.includes(area));
  const { SITE_URL } = await import("../content/seo.ts");
  const urls = [...body.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map((match) => new URL(match[1]));
  assert.ok(urls.length > 0);
  for (const url of urls) assert.equal(url.origin, SITE_URL);
  for (const path of [
    "/",
    "/castle-peak-road",
    "/castle-peak-road/ting-kau",
    "/castle-peak-road/sham-tseng",
    "/district/sham-tseng",
    "/listings",
    "/blog",
    "/about",
    "/blog/sham-tseng-buying-guide-2026",
    "/blog/bellagio-vs-sea-crest-villa-vs-hong-kong-garden",
    "/estate-reviews",
    "/agents",
    "/contact",
  ]) {
    assert.ok(
      urls.some((url) => url.pathname === path),
      `${path} must be discoverable`,
    );
  }
  assert.doesNotMatch(body, /\/(?:admin|api|w\/|district\/tsuen-wan|district\/ting-kau)/);
  assert.ok(!urls.some((url) => url.pathname.startsWith("/estate/")));
  assert.ok(!urls.some((url) => url.pathname === "/transactions"));
});

test("featured guides are linked only while the database marks them published", async () => {
  const body = await (await getLlms({ publishedArticles: [] })).text();
  assert.doesNotMatch(
    body,
    /sham-tseng-buying-guide-2026|bellagio-vs-sea-crest-villa-vs-hong-kong-garden/,
  );
  assert.match(body, /\/about\)/);
});

test("only currently published curated estates and populated transactions are linked", async () => {
  const response = await getLlms({
    estates: { bellagio: null, "not-a-curated-estate": null },
    transactions: [{ id: "synthetic" }],
  });
  const body = await response.text();
  assert.match(body, /\/estate\/bellagio\)/);
  assert.doesNotMatch(body, /\/estate\/sea-crest-villa|not-a-curated-estate/);
  assert.match(body, /\/transactions\)/);
  // A subsequent request must not freeze the earlier published set.
  const empty = await (await getLlms()).text();
  assert.doesNotMatch(empty, /\/estate\/bellagio|\/transactions\)/);
});

test("failed publication reads return explicit unavailable; unrelated transaction probe can degrade", async () => {
  const failed = await getLlms({ failEstates: true });
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get("cache-control"), "no-store");
  assert.equal(await failed.text(), "BLOG_UNAVAILABLE");
  const response = await getLlms({ failTransactions: true });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(await response.text(), /\/transactions\)/);
});

test("withdrawn or future registry guides do not leak through llms.txt", async () => {
  const body = await (await getLlms({ suppressed: ["sham-tseng-buying-guide-2026"] })).text();
  assert.doesNotMatch(body, /\/blog\/sham-tseng-buying-guide-2026/);
  assert.match(body, /bellagio-vs-sea-crest-villa-vs-hong-kong-garden/);
});
test("failed publication eligibility read omits guide URLs and disables caching", async () => {
  const response = await getLlms({ failVisibility: true });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "BLOG_UNAVAILABLE");
});
