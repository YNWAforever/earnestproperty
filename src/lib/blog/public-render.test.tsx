import { beforeEach, expect, mock, spyOn, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { load } from "cheerio";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { BlogRepositoryError } from "./errors";
import { blogNoStoreHeaders } from "./public";
import { resolveBlogHeading } from "./presentation";

const record = {
  id: "public-id",
  slug: "saved-article",
  title: "公開標題 <script>字面</script>",
  excerpt: "摘要",
  categoryId: "cat",
  category: "成交分析",
  categoryName: "成交新名稱",
  published: true,
  publishedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: null,
  coverImage: "/cover.jpg",
  coverAlt: "封面說明",
  readingMinutes: 8,
  seoTitle: "已儲存SEO",
  seoDescription: "已儲存描述 <script>字面</script>",
  body: {
    format: "editor-json-v1",
    document: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "第一節" }] },
        { type: "paragraph", content: [{ type: "text", text: "<img src=x onerror=alert(1)>" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "第二節" }] },
        { type: "image", attrs: { src: "/body.jpg", alt: "正文圖片" } },
      ],
    },
  },
  links: [{ href: "https://example.com/source?a=1&b=2#facts", label: "來源連結" }],
  editorial: {
    author: "作者甲",
    reviewer: "審閱乙",
    sourcesNote: "官方數據",
    answerSummary: "重點摘要原文",
    compareEstateSlugs: ["bellagio"],
  },
};
let unavailable = false;
let absent = false;
let estatePsf = 12345;
let comparisonSlugs = ["bellagio"];
let missingEstates: string[] = [];
let requested: unknown;
const settings = {
  scope: { kind: "main" },
  heading: "獨立主標題",
  introduction: "獨立簡介",
  seoTitle: "主頁SEO",
  seoDescription: "主頁描述",
  version: 1,
  featuredIds: [record.id],
};
mock.module("../neon/blog-public", () => ({
  getPublicBlogPage: async (input: { categoryKey?: string; page: number }) => {
    requested = input;
    if (unavailable) throw new BlogRepositoryError("BLOG_UNAVAILABLE", 503);
    if (absent) return null;
    return {
      settings,
      categories: [{ id: "cat", key: "成交分析", name: "成交分析", hidden: false }],
      featured: input.page === 1 ? [record] : [],
      articles: { items: [], total: 25, page: input.page, pageSize: 12 },
    };
  },
  getPublicBlogArticle: async () => {
    if (unavailable) throw new BlogRepositoryError("BLOG_UNAVAILABLE", 503);
    return absent
      ? null
      : {
          ...structuredClone(record),
          editorial: { ...record.editorial, compareEstateSlugs: comparisonSlugs },
        };
  },
}));
mock.module("../queries", () => ({
  fetchEstateBySlug: async (slug: string) =>
    missingEstates.includes(slug)
      ? null
      : {
          slug,
          name_zh: slug === "cms-only-estate" ? "資料庫新增屋苑" : "資料庫最新屋苑名",
          avg_saleable_psf: estatePsf,
          total_units: 3000,
          year_completed: 2004,
          developer: "發展商",
          verified_at: "2026-01-01",
        },
}));
mock.module("../analytics/events", () => ({
  buildContext: () => ({}),
  useTrackPageView: () => {},
}));
const expectedConfigWarning =
  "[site.ts] VITE_CONTACT_WHATSAPP_PHONE is not set -- every WhatsApp CTA will fall back to /contact instead of opening WhatsApp. See .env.example.";
const importWarnings: unknown[][] = [];
const originalWarn = console.warn.bind(console);
const warnSpy = spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
  importWarnings.push(args);
  if (args.length !== 1 || args[0] !== expectedConfigWarning) originalWarn(...args);
});
const [hubModule, detailModule, config] = await (async () => {
  try {
    return await Promise.all([
      import("../../routes/blog"),
      import("../../routes/blog_.$slug"),
      import("../../config/site"),
    ]);
  } finally {
    warnSpy.mockRestore();
  }
})();
const { Route: hub } = hubModule;
const { Route: detail } = detailModule;
test("route imports emit only the expected missing WhatsApp configuration diagnostic", () => {
  expect(importWarnings).toEqual(config.hasWhatsAppPhone ? [] : [[expectedConfigWarning]]);
});
beforeEach(() => {
  unavailable = false;
  absent = false;
  estatePsf = 12345;
  comparisonSlugs = ["bellagio"];
  missingEstates = [];
});

async function render(url: string, which: typeof hub | typeof detail) {
  const root = createRootRoute({ component: Outlet });
  const route = which.update({
    id: which === hub ? "/blog" : "/blog_/$slug",
    path: which === hub ? "/blog" : "/blog/$slug",
    getParentRoute: () => root,
  } as never);
  const router = createRouter({
    routeTree: root.addChildren([
      route as never,
      createRoute({ getParentRoute: () => root, path: "/estate/$slug", component: () => null }),
    ]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await router.load();
  const html = renderToString(createElement(RouterProvider, { router } as never));
  return { $: load(html), html, match: router.state.matches.at(-1)! };
}

test("actual main/category routes use independent copy, exact decoded key, canonical and single featured card", async () => {
  const { $, match } = await render("/blog?category=%E6%88%90%E4%BA%A4%E5%88%86%E6%9E%90", hub);
  expect(match.status).toBe("success");
  expect(requested).toEqual({ categoryKey: "成交分析", page: 1 });
  expect($("h1").text()).toBe(settings.heading);
  expect($("body").text()).toContain(settings.introduction);
  expect($('a[href="/blog/saved-article"]')).toHaveLength(1);
  expect(match.links?.find((l) => l?.rel === "canonical")?.href).toMatch(/\/blog$/);
  expect(match.meta).toContainEqual({ title: "主頁SEO" });
  expect(
    $("a")
      .filter((_, a) => $(a).text().includes("下一頁"))
      .attr("href"),
  ).toContain("page=2");
  const next = await render("/blog?category=%E6%88%90%E4%BA%A4%E5%88%86%E6%9E%90&page=2", hub);
  expect(next.match.status).toBe("success");
  expect(next.$('a[href="/blog/saved-article"]')).toHaveLength(0);
  expect((await render("/blog", hub)).match.status).toBe("success");
});

test("blank category override renders the current display name safely", async () => {
  const previous = settings.heading;
  try {
    for (const name of ["首次名稱", "改名 <script>字面</script>"]) {
      settings.heading = resolveBlogHeading({ kind: "category", categoryId: "cat" }, "", name);
      const { $, html } = await render("/blog?category=成交分析", hub);
      expect($("h1").text()).toBe(name);
      expect(html).not.toContain("<script>字面</script>");
    }
  } finally {
    settings.heading = previous;
  }
});

test("actual detail preserves editorial metadata, live estate values, rich media, safe text and anchors", async () => {
  const { $, html, match } = await render("/blog/saved-article", detail);
  for (const text of ["作者甲", "審閱乙", "官方數據", "重點摘要原文", "12,345"])
    expect($("body").text()).toContain(text);
  expect($('img[src="/cover.jpg"]').attr("alt")).toBe("封面說明");
  expect($('img[src="/body.jpg"]').attr("alt")).toBe("正文圖片");
  expect($('img[onerror],script:not([type="application/ld+json"])')).toHaveLength(0);
  expect($('a[href="https://example.com/source?a=1&b=2#facts"]')).toHaveLength(1);
  const toc = $('nav[aria-label="目錄"] a');
  expect(toc).toHaveLength(2);
  toc.each((_, a) => expect($($(a).attr("href")!)).toHaveLength(1));
  expect(match.meta).toContainEqual({ title: "已儲存SEO｜晉誠地產" });
  expect(match.links?.find((l) => l?.rel === "canonical")?.href).toMatch(/\/blog\/saved-article$/);
  expect(html).not.toContain("<script>字面</script>");
  estatePsf = 23456;
  expect((await render("/blog/saved-article", detail)).$("body").text()).toContain("23,456");
});

test("article detail displays the renamed category without changing its stable key", async () => {
  const { $, match } = await render("/blog/saved-article", detail);
  expect(match.status).toBe("success");
  expect($("body").text()).toContain("成交新名稱");
  expect($("span").filter((_, element) => $(element).text() === "成交新名稱")).toHaveLength(1);
  expect(record.category).toBe("成交分析");
});

test("actual article loader renders live CMS-only estates and keeps body for missing comparison references", async () => {
  comparisonSlugs = ["cms-only-estate", "missing-estate", "bellagio"];
  missingEstates = ["missing-estate", "bellagio"];
  const { $, match } = await render("/blog/saved-article", detail);
  expect(match.status).toBe("success");
  expect($("[data-article-body]").text()).toContain("第一節");
  expect($('table a[href="/estate/cms-only-estate"]').text()).toBe("資料庫新增屋苑");
  expect($("table").text()).toContain("12,345");
  expect($("table").text()).toContain("missing-estate");
  expect($("table").text()).toContain("碧堤半島");
  expect(
    $('table a[href="/estate/missing-estate"], table a[href="/estate/bellagio"]'),
  ).toHaveLength(0);
  comparisonSlugs = ["missing-estate"];
  const again = await render("/blog/saved-article", detail);
  expect(again.match.status).toBe("success");
  expect(again.$("[data-article-body]").text()).toContain("第一節");
  expect(again.$("table a")).toHaveLength(0);
});

test("comparison names prefer the live estate record over static registry labels", async () => {
  const { $, match } = await render("/blog/saved-article", detail);
  expect(match.status).toBe("success");
  expect($('table a[href="/estate/bellagio"]').text()).toBe("資料庫最新屋苑名");
});

test("missing category/article is not-found; database outage renders unavailable, never the empty state", async () => {
  for (const [url, route] of [
    ["/blog?category=unknown", hub],
    ["/blog/withdrawn", detail],
  ] as const) {
    absent = true;
    const missing = await render(url, route);
    expect(missing.match.status).toBe("notFound");
    expect(missing.match.links ?? []).toHaveLength(0);
    absent = false;
    unavailable = true;
    const failed = await render(url, route);
    expect(failed.match.status).toBe("error");
    expect((failed.match.error as BlogRepositoryError).code).toBe("BLOG_UNAVAILABLE");
    expect(failed.html).not.toContain("未有符合條件的文章");
    expect(failed.$('[role="alert"] h1').text()).toBe("文章暫時未能載入");
    expect(failed.$('[role="alert"] button[type="button"]').text()).toBe("重試");
    unavailable = false;
  }
});

test("public route successes, failures and router re-navigation opt out of publication caching", () => {
  for (const route of [hub, detail]) {
    expect(route.options.headers!({} as never)).toEqual(blogNoStoreHeaders());
    expect(route.options.staleTime).toBe(0);
    expect(route.options.gcTime).toBe(0);
    expect(route.options.preload).toBe(false);
    expect(route.options.shouldReload).toBe(true);
  }
});
