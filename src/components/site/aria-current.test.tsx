import { beforeEach, expect, mock, test } from "bun:test";
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
import { BlogRepositoryError } from "@/lib/blog/errors";
import type { PublicBlogArticle } from "@/lib/neon/blog-public.server";

import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

const registryArticle = publishedBlogArticles()[0];
const article: PublicBlogArticle = {
  id: "aria-current-article",
  slug: registryArticle.slug,
  title: "CMS 公開文章導覽測試",
  excerpt: "公開文章摘要",
  categoryId: "market",
  category: "晉誠成交",
  categoryName: "晉誠成交",
  published: true,
  publishedAt: "2026-01-01T00:00:00Z",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: null,
  coverImage: null,
  coverAlt: null,
  readingMinutes: 1,
  seoTitle: null,
  seoDescription: null,
  body: { format: "legacy-text", text: "已儲存的公開文章內容。" },
  links: [],
  editorial: {
    author: "測試編輯",
    reviewer: null,
    sourcesNote: null,
    answerSummary: null,
    compareEstateSlugs: [],
  },
  version: 0,
  slugLocked: true,
  editState: {
    resourceId: "aria-current-article",
    draftRevisionId: null,
    draftVersion: null,
    draftEditVersion: null,
    currentPublishedVersion: null,
    basePublishedVersion: null,
    restoredFromRevisionId: null,
  },
};
let unavailable = false;
mock.module("@/lib/neon/blog-public", () => ({
  // queries.ts imports this for legacy article reads; this route must not use it.
  publicCall: async () => {
    throw new Error("Unexpected legacy blog read in the aria-current harness");
  },
  getPublicBlogArticle: async (slug: string) => {
    if (slug !== article.slug) throw new Error(`Unexpected article slug: ${slug}`);
    if (unavailable) throw new BlogRepositoryError("BLOG_UNAVAILABLE", 503);
    return structuredClone(article);
  },
}));
const { Route: BlogPostRoute } = await import("@/routes/blog_.$slug");
beforeEach(() => {
  unavailable = false;
});

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
  // document shell). The real loader receives the CMS fixture through the public
  // read boundary; an unavailable read must render the route's error component.
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

const postPath = `/blog/${article.slug}`;

test("market menu features 晉誠最新成交 before YouTube and preserves its blog category", async () => {
  const $ = await renderAt("/agents");
  const links = $("#mega-menu-market a");
  const labels = links.map((_, el) => $(el).find("span").first().text()).get();
  expect(labels.slice(0, 2)).toEqual(["晉誠最新成交", "YouTube影片"]);

  const destination = new URL(links.first().attr("href")!, "https://x.test");
  expect(destination.pathname).toBe("/blog");
  expect(destination.searchParams.get("category")).toBe("晉誠成交");
});

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

  // The post's trail names its category, so the breadcrumb links the category page
  // (and never claims to be the current page).
  const breadcrumb = $('nav[aria-label="頁面路徑"] a[href^="/blog?category="]');
  expect(breadcrumb.length).toBe(1);
  expect(new URL(breadcrumb.attr("href")!, "https://x.test").searchParams.get("category")).toBe(
    "晉誠成交",
  );
  expect($('footer a[href="/blog"]').length).toBe(1);
  expect($('header a[href="/blog"]').length).toBeGreaterThan(0);
  // Every /blog link -- header menu, footer -- carries no aria-current.
  const blogLinks = $('a[href="/blog"]');
  blogLinks.each((_, el) => expect($(el).attr("aria-current")).toBeUndefined());
  expect($('footer a[href="/"]').attr("aria-current")).toBeUndefined();
});

test("a blog outage renders unavailable instead of the bundled article", async () => {
  unavailable = true;
  const $ = await renderAt(postPath);
  expect($('main [role="alert"] h1').text()).toBe("文章暫時未能載入");
  expect($('main [role="alert"] button[type="button"]').text()).toBe("重試");
  expect($("main").text()).not.toContain(article.title);
  expect($("main").text()).not.toContain(registryArticle.title);
  expect($("[data-article-body]").length).toBe(0);
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
