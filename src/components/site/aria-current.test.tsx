import { expect, test } from "bun:test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { load, type CheerioAPI } from "cheerio";
import { createElement, Fragment } from "react";
import { renderToString } from "react-dom/server";

import { publishedBlogArticles } from "@/content/blog-articles";
import { Route as BlogPostRoute } from "@/routes/blog_.$slug";

import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

// FX-16 F-09 / I-1. TanStack Router sets aria-current="page" on any <Link> whose
// destination is a prefix of the current path, after (and over) the caller's own
// aria-current. A source scan cannot see that, so this renders real pages through
// a real router: the shared chrome (header, footer) plus the actual blog post route.

function buildRouter(url: string) {
  const rootRoute = createRootRoute({
    component: () =>
      createElement(
        Fragment,
        null,
        createElement(SiteHeader),
        createElement("main", null, createElement(Outlet)),
        createElement(SiteFooter),
      ),
  });
  // Mirrors routeTree.gen.ts, under a minimal root (the real __root renders the
  // document shell). The loader's DB read rejects outside Start and falls back to
  // the bundled article, as it does when the database is unreachable.
  const blogPost = BlogPostRoute.update({
    id: "/blog_/$slug",
    path: "/blog/$slug",
    getParentRoute: () => rootRoute,
  } as never);
  const stub = (path: string) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => null });
  const routeTree = rootRoute.addChildren([
    blogPost as never,
    stub("/agents"),
    stub("/property/$listingNo"),
  ]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [url] }),
  });
}

async function renderAt(url: string): Promise<CheerioAPI> {
  const router = buildRouter(url);
  await router.load();
  return load(renderToString(createElement(RouterProvider, { router } as never)));
}

const pathnameOf = (href: string | undefined) => new URL(href ?? "", "https://x.test").pathname;

function currentLinks($: CheerioAPI, value: string) {
  return $(`a[aria-current="${value}"]`)
    .map((_, el) => pathnameOf($(el).attr("href")))
    .get();
}

const article = publishedBlogArticles()[0];
const postPath = `/blog/${article.slug}`;

test("a blog post: section-root links (header menu, breadcrumb, footer) are not the current page", async () => {
  const $ = await renderAt(postPath);

  // The article itself rendered, so this is the real route and not a 404 shell.
  expect($("main h1").text()).toContain(article.title);

  // Nothing claims to be the current page except a link to this exact URL.
  for (const pathname of currentLinks($, "page")) expect(pathname).toBe(postPath);

  // The header still marks the 市場資訊 section the post belongs to with "true".
  const section = $('header [aria-current="true"]');
  expect(section.length).toBeGreaterThan(0);
  expect(section.text()).toContain("市場資訊");

  // Every /blog link -- header menu, breadcrumb, footer -- carries no aria-current.
  const blogLinks = $('a[href="/blog"]');
  expect($('nav[aria-label="頁面路徑"] a[href="/blog"]').length).toBe(1);
  expect($('footer a[href="/blog"]').length).toBe(1);
  expect($('header a[href="/blog"]').length).toBeGreaterThan(0);
  blogLinks.each((_, el) => expect($(el).attr("aria-current")).toBeUndefined());
  expect($('footer a[href="/"]').attr("aria-current")).toBeUndefined();
});

test('a header section link keeps aria-current="true" under the router', async () => {
  const $ = await renderAt("/property/B059390");
  const listings = $('header nav[aria-label="主選單"] a')
    .filter((_, el) => $(el).text().trim() === "搜尋放盤")
    .first();
  expect(pathnameOf(listings.attr("href"))).toBe("/listings");
  expect(listings.attr("aria-current")).toBe("true");
  expect(currentLinks($, "page")).toEqual([]);
});

test('only links to the exact current URL say aria-current="page"', async () => {
  const $ = await renderAt("/agents");
  const current = currentLinks($, "page");
  expect(current.length).toBeGreaterThan(0);
  for (const pathname of current) expect(pathname).toBe("/agents");
  expect($('footer a[href="/agents"][aria-current="page"]').length).toBeGreaterThan(0);
});
