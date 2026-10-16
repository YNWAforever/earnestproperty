import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { test as base, expect, type Page } from "@playwright/test";

import {
  cmsFixture,
  nextCmsFixture,
  type VideosFixtureData,
} from "../scripts/browser-fixtures/youtube-videos/data";
import {
  statusCases,
  type StatusCase,
} from "../scripts/browser-fixtures/youtube-videos/status-data";

// Regression targets: created_at replacing upload dates, dropping/duplicating a
// paging slice, ignoring URL sort, retaining yesterday's loader data, eager
// iframe creation, and presenting partial/unknown sync results as success.
// This is synthetic component evidence, never DB, scheduler, provider or UAT evidence.
let server: Server;
let origin: string;
let fixtureData: VideosFixtureData;
const serverViolations: string[] = [];
let renderStatus: (name: StatusCase) => string;

const test = base.extend<{ networkFence: void }>({
  networkFence: [
    async ({ context }, use) => {
      const violations: string[] = [];
      const pageErrors: string[] = [];
      context.on("page", (page) => page.on("pageerror", (error) => pageErrors.push(error.message)));
      await context.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (!["GET", "HEAD"].includes(request.method())) {
          violations.push(`${request.method()} ${url.origin}${url.pathname}`);
          await route.abort("blockedbyclient");
        } else if (url.origin === origin) {
          await route.continue();
        } else {
          // Includes thumbnails, embeds, analytics, fonts, and popup navigation.
          await route.abort("blockedbyclient");
        }
      });
      await context.routeWebSocket("**/*", (socket) => {
        violations.push(`WebSocket ${socket.url()}`);
        socket.close();
      });
      await context.exposeBinding("__youtubeRecordAttempt", (_source, attempt: string) => {
        violations.push(attempt);
      });
      await context.addInitScript(() => {
        const record = (attempt: string) =>
          (
            window as unknown as {
              __youtubeRecordAttempt: (attempt: string) => Promise<void>;
            }
          ).__youtubeRecordAttempt(attempt);
        const nativeFetch = window.fetch.bind(window);
        const guardedFetch = (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(input instanceof Request ? input.url : String(input), location.href);
          const method = (
            init?.method ?? (input instanceof Request ? input.method : "GET")
          ).toUpperCase();
          if (
            url.origin === location.origin &&
            url.pathname === "/__fixture/videos.json" &&
            method === "GET"
          ) {
            return nativeFetch(input, init);
          }
          void record(`fetch ${method} ${url.origin}${url.pathname}`);
          return Promise.reject(new Error("Synthetic fixture forbids unexpected fetch"));
        };
        Object.defineProperty(window, "fetch", { configurable: true, value: guardedFetch });
        XMLHttpRequest.prototype.send = function () {
          void record("XMLHttpRequest.send");
          throw new Error("Synthetic fixture forbids XMLHttpRequest");
        };
        navigator.sendBeacon = () => {
          void record("sendBeacon");
          return false;
        };
      });
      await use();
      expect(violations, "Unexpected fetch/mutation/socket attempts").toEqual([]);
      expect(serverViolations, "Server accepts only loopback GET/HEAD").toEqual([]);
      expect(pageErrors, "Real route/status rendering must not crash").toEqual([]);
    },
    { auto: true },
  ],
});

test.beforeAll(async () => {
  test.setTimeout(120_000);
  assert.ok(!process.env.PLAYWRIGHT_BASE_URL, "Refuse external browser targets");
  assert.equal(
    spawnSync(process.execPath, ["scripts/browser-fixtures/build-youtube-videos.mjs"], {
      stdio: "inherit",
    }).status,
    0,
    "Build the real route with synthetic boundary modules",
  );
  const output = resolve(".audit/youtube-videos-browser");
  ({ renderStatus } = await import(pathToFileURL(resolve(output, "ssr/status.mjs")).href));
  server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(request.method ?? "")) {
      serverViolations.push(`${request.method} ${request.url}`);
      response.writeHead(405).end();
      return;
    }
    try {
      const url = new URL(request.url!, "http://127.0.0.1");
      if (url.pathname === "/__fixture/videos.json") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(fixtureData));
        return;
      }
      if (url.pathname === "/__fixture/status-ssr") {
        const name = url.searchParams.get("case") as StatusCase;
        assert.ok(Object.hasOwn(statusCases, name));
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(
          `<!doctype html><html lang="zh-HK"><body><p>SYNTHETIC FIXTURE ONLY</p>${renderStatus(name)}</body></html>`,
        );
        return;
      }
      const target = url.pathname.startsWith("/assets/")
        ? resolve(output, `.${decodeURIComponent(url.pathname)}`)
        : resolve(output, "index.html");
      assert.ok(target.startsWith(output + sep), "Static file stays inside owned output");
      assert.ok(!target.startsWith(resolve(output, "ssr") + sep));
      response.setHeader(
        "Content-Type",
        (
          {
            ".js": "text/javascript",
            ".css": "text/css",
            ".html": "text/html; charset=utf-8",
          } as Record<string, string>
        )[extname(target)] ?? "application/octet-stream",
      );
      response.end(await readFile(target));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

test.beforeEach(() => {
  fixtureData = { cmsVideos: cmsFixture(), listingVideos: [] };
  serverViolations.length = 0;
});

test.afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
});

const cards = (page: Page) => page.locator("article");
const titles = (page: Page) => cards(page).locator("h3").allTextContents();
const newestTitle = "SYNTHETIC 16 newest Short";
const canonicalShortUrl = "https://www.youtube.com/watch?v=Fixture0016";
const newestTwelve = [
  newestTitle,
  "SYNTHETIC 15 upload",
  "SYNTHETIC 14 upload",
  "SYNTHETIC 13 upload",
  "SYNTHETIC 12 upload",
  "SYNTHETIC 11 upload",
  "SYNTHETIC 10 upload",
  "SYNTHETIC 09 upload",
  "SYNTHETIC 08 upload",
  "SYNTHETIC 07 upload",
  "SYNTHETIC 06 upload",
  "SYNTHETIC 05 upload",
];

async function openVideos(page: Page, search = "") {
  await page.goto(`${origin}/videos${search}`);
  await expect(page.getByText("SYNTHETIC FIXTURE ONLY", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("YouTube");
}

async function sortBy(page: Page, label: string) {
  await page.getByRole("combobox", { name: "排序", exact: true }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

test("newest canonical Short leads 12 cards using upload dates instead of import dates", async ({
  page,
}) => {
  await openVideos(page);
  await expect(cards(page)).toHaveCount(12);
  expect(await titles(page)).toEqual(newestTwelve);
  await expect(
    cards(page).first().getByRole("link", { name: newestTitle, exact: true }),
  ).toHaveAttribute("href", canonicalShortUrl);
  await expect(page.getByText("共 16 條影片", { exact: true })).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("load more reveals every remaining CMS row once and removes the paging control", async ({
  page,
}) => {
  await openVideos(page);
  await page.getByRole("button", { name: "載入更多影片（尚餘 4 條）", exact: true }).click();
  await expect(cards(page)).toHaveCount(16);
  expect(await titles(page)).toEqual([
    ...newestTwelve,
    "SYNTHETIC 04 upload",
    "SYNTHETIC 03 upload",
    "SYNTHETIC 02 upload",
    "SYNTHETIC 01 manual fallback",
  ]);
  const urls = await cards(page)
    .locator("h3 a")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
  expect(new Set(urls).size).toBe(16);
  await expect(page.getByRole("button", { name: /載入更多影片/ })).toHaveCount(0);
});

test("oldest and newest sorting update the URL and reset the loaded page", async ({ page }) => {
  await openVideos(page);
  await page.getByRole("button", { name: /載入更多影片/ }).click();
  await sortBy(page, "最舊");
  await expect(page).toHaveURL(/sort=oldest/);
  await expect(cards(page)).toHaveCount(12);
  expect((await titles(page)).slice(0, 3)).toEqual([
    "SYNTHETIC 01 manual fallback",
    "SYNTHETIC 02 upload",
    "SYNTHETIC 03 upload",
  ]);
  await sortBy(page, "最新");
  await expect(cards(page)).toHaveCount(12);
  expect(await titles(page)).toEqual(newestTwelve);
});

test("featured sorting follows CMS sort_order rather than upload or import time", async ({
  page,
}) => {
  await openVideos(page);
  await sortBy(page, "精選");
  await expect(page).toHaveURL(/sort=featured/);
  expect((await titles(page)).slice(0, 4)).toEqual([
    "SYNTHETIC 04 upload",
    "SYNTHETIC 01 manual fallback",
    "SYNTHETIC 02 upload",
    "SYNTHETIC 03 upload",
  ]);
  await expect(cards(page)).toHaveCount(12);
});

test("shared sort URL is honored on initial render", async ({ page }) => {
  await openVideos(page, "?sort=oldest");
  await expect(cards(page).first()).toContainText("SYNTHETIC 01 manual fallback");
  await expect(page.getByRole("combobox", { name: "排序", exact: true })).toHaveText("最舊");
});

test("reload receives new loader data and exposes the newly synchronized video first", async ({
  page,
}) => {
  await openVideos(page);
  await expect(cards(page).first()).toContainText(newestTitle);
  fixtureData = { cmsVideos: nextCmsFixture(), listingVideos: [] };
  await page.reload();
  await expect(cards(page)).toHaveCount(12);
  await expect(
    cards(page).first().getByRole("link", { name: "SYNTHETIC 17 next sync", exact: true }),
  ).toHaveAttribute("href", "https://www.youtube.com/watch?v=Fixture0017");
  await expect(page.getByText("共 17 條影片", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "載入更多影片（尚餘 5 條）", exact: true }).click();
  await expect(cards(page)).toHaveCount(17);
  expect(new Set(await titles(page)).size).toBe(17);
});

test("search after load more filters the real cards and clearing restores the first page", async ({
  page,
}) => {
  await openVideos(page);
  await page.getByRole("button", { name: /載入更多影片/ }).click();
  await page.getByRole("searchbox", { name: "搜尋影片", exact: true }).fill("newest Short");
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText(newestTitle);
  await page.getByRole("searchbox", { name: "搜尋影片", exact: true }).fill("no synthetic match");
  await expect(page.getByRole("heading", { name: "搵唔到相關影片", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "清除篩選", exact: true }).click();
  await expect(cards(page)).toHaveCount(12);
  expect(await titles(page)).toEqual(newestTwelve);
});

test("Short facade mounts only the selected YouTube player; the request is aborted", async ({
  page,
}) => {
  const blockedPlayer = page.waitForEvent("requestfailed", {
    predicate: (request) =>
      request.url() === "https://www.youtube.com/embed/Fixture0016?autoplay=1",
  });
  await openVideos(page);
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByRole("button", { name: `播放影片：${newestTitle}`, exact: true }).click();
  await blockedPlayer;
  await expect(page.locator("iframe")).toHaveCount(1);
  await expect(page.locator("iframe")).toHaveAttribute(
    "src",
    "https://www.youtube.com/embed/Fixture0016?autoplay=1",
  );
});

test("an empty synthetic CMS response renders the real empty state", async ({ page }) => {
  fixtureData = { cmsVideos: [], listingVideos: [] };
  await openVideos(page);
  await expect(page.getByRole("heading", { name: "暫未有影片", exact: true })).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
});

for (const rendering of ["browser", "ssr"] as const) {
  for (const name of ["failed", "partial", "interrupted", "never"] as const) {
    test(`${rendering} status ${name} preserves safe outcome and unknown counts`, async ({
      page,
    }) => {
      const path = rendering === "ssr" ? "/__fixture/status-ssr" : "/__fixture/status";
      await page.goto(`${origin}${path}?case=${name}`);
      const status = page.getByRole("status");
      const expected = {
        failed: ["同步失敗", "YouTube 配額已用完", "新增 0", "失敗影片 1"],
        partial: ["資料已寫入，但收尾失敗", "先核對再重試", "新增 2", "更新 3"],
        interrupted: ["未完成或結果未能記錄", "先核對再重試", "未能確定"],
        never: ["未有記錄（此版本開始記錄）", "最後成功：未有記錄", "未能確定"],
      }[name];
      for (const text of expected) await expect(status).toContainText(text);
      if (name === "interrupted" || name === "never") {
        await expect(status.locator("p").filter({ hasText: /^新增/ })).toHaveText(
          "新增 未能確定 · 接管既有 未能確定 · 更新 未能確定 · 失敗影片 未能確定",
        );
      }
      await expect(status).not.toContainText("已完成");
      await expect(page.locator("body")).not.toContainText("SYNTHETIC_INTERNAL_SECRET");
      if (name === "failed" || name === "partial") {
        // A failed/latest partial attempt must keep the preceding successful date.
        await expect(status).toContainText("2026");
        await expect(status).toContainText("14/10/2026");
      }
      if (rendering === "ssr") await expect(page.locator("script")).toHaveCount(0);
    });
  }
}

test("status panel read failure is safe and explicit reread recovers without mutations", async ({
  page,
}) => {
  await page.goto(`${origin}/__fixture/status?panel=1&case=read-error`);
  await expect(page.getByRole("alert")).toHaveText("未能讀取同步記錄，請重新讀取或確認權限。");
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("SYNTHETIC_INTERNAL_SECRET");
  await page.evaluate(() => {
    window.history.replaceState({}, "", "/__fixture/status?panel=1&case=partial");
  });
  await page.getByRole("button", { name: "重新讀取記錄", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("資料已寫入，但收尾失敗");
});
