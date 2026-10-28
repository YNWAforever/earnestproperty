import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import { load } from "cheerio";
import ts from "typescript";
import {
  Link,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  stripSearchParams,
} from "@tanstack/react-router";
import { LISTINGS_SEARCH_DEFAULTS } from "../lib/public-search-defaults.ts";

// Render the actual estate listings-header JSX with a real TanStack router.
// This verifies the generated URLs rather than mirroring JSX in an assertion.
const source = readFileSync(new URL("./estate.$slug.tsx", import.meta.url), "utf8");
const heading = source.indexOf("最新放盤</h2>");
const container = source.lastIndexOf('<Container className="py-8">', heading);
const start = source.indexOf("<div", container);
const end = source.indexOf("\n        {latestListings.length === 0", heading);
assert.ok(container >= 0 && start > container && end > heading);
const markup = source.slice(start, end);
const { outputText } = ts.transpileModule(
  `function ListingLinks({ estate, estateName }) { return (${markup}); } exports.ListingLinks = ListingLinks;`,
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } },
);
const exports = {};
new Function("exports", "React", "Link", outputText)(exports, React, Link);

async function renderEstate(slug, name) {
  const root = createRootRoute({
    component: () => createElement(exports.ListingLinks, { estate: { slug }, estateName: name }),
  });
  const estateRoute = createRoute({ getParentRoute: () => root, path: "/estate/$slug" });
  const listingsRoute = createRoute({
    getParentRoute: () => root,
    path: "/listings",
    search: { middlewares: [stripSearchParams(LISTINGS_SEARCH_DEFAULTS)] },
  });
  const router = createRouter({
    routeTree: root.addChildren([estateRoute, listingsRoute]),
    history: createMemoryHistory({ initialEntries: [`/estate/${slug}`] }),
    isServer: true,
  });
  await router.load();
  return load(renderToString(createElement(RouterProvider, { router })));
}

test("estate pages link to their own all, sale and rental result pages", async () => {
  for (const [slug, name] of [
    ["bellagio", "碧堤半島"],
    ["sea-crest-villa", "浪翠園"],
  ]) {
    const $ = await renderEstate(slug, name);
    const links = $("a")
      .toArray()
      .map((element) => ({
        text: $(element).text().trim(),
        label: $(element).attr("aria-label"),
        url: new URL($(element).attr("href"), "https://example.test"),
      }));
    assert.deepEqual(
      links.map((link) => link.text),
      ["查看全部", "查看售盤", "查看租盤"],
    );
    for (const [index, deal] of [undefined, "sale", "rent"].entries()) {
      assert.equal(links[index].url.pathname, "/listings");
      assert.equal(links[index].url.searchParams.get("estate"), slug);
      assert.equal(links[index].url.searchParams.get("deal"), deal ?? null);
      assert.equal(links[index].url.searchParams.has("page"), false);
      assert.equal(
        links[index].url.search,
        deal ? `?deal=${deal}&estate=${slug}` : `?estate=${slug}`,
      );
    }
    assert.equal(links[1].label, `查看${name}售盤`);
    assert.equal(links[2].label, `查看${name}租盤`);
  }
});
