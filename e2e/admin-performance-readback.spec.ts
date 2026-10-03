import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
import type { state } from "../scripts/browser-fixtures/performance-readback/synthetic-analytics";
declare global {
  interface Window {
    performanceReadbackFixture: typeof state;
  }
}
let server: Server, origin: string;
const results: { name: string; status: string; width: number }[] = [];
test.beforeAll(async () => {
  assert.ok(!process.env.PLAYWRIGHT_BASE_URL);
  assert.equal(
    spawnSync(process.execPath, ["scripts/browser-fixtures/build-admin-performance-readback.mjs"], {
      stdio: "inherit",
    }).status,
    0,
  );
  const root = resolve(".audit/performance-readback-browser");
  server = createServer(async (request, response) => {
    try {
      assert.ok(["GET", "HEAD"].includes(request.method!));
      const path = new URL(request.url!, "http://127.0.0.1").pathname;
      const target = path.startsWith("/assets/")
        ? resolve(root, `.${decodeURIComponent(path)}`)
        : resolve(root, "index.html");
      assert.ok(target.startsWith(root + sep));
      response.setHeader(
        "Content-Type",
        (
          { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" } as Record<
            string,
            string
          >
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
test.afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
  await writeFile(
    ".audit/remediation-20261003/performance-readback-browser-summary.json",
    JSON.stringify(
      {
        codeSha: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
        evidenceLayer:
          "actual-analytics-route-dashboard-table-shell-staff-store-synthetic-auth-api-owned-loopback",
        realAuth: false,
        realDatabase: false,
        realProvider: false,
        results,
      },
      null,
      2,
    ),
  );
});
test.afterEach(async ({ page }, info) => {
  const fits =
    info.status !== "passed" ||
    (await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  results.push({
    name: info.title,
    status: fits ? (info.status ?? "unknown") : "failed",
    width: page.viewportSize()!.width,
  });
  if (!fits)
    console.log(
      "Performance overflow",
      await page.evaluate(() => ({
        width: innerWidth,
        pageWidth: document.documentElement.scrollWidth,
      })),
    );
  expect(fits).toBe(true);
  if (info.status === "passed" && info.title.startsWith("totals"))
    await page.screenshot({
      path: `.audit/remediation-20261003/performance-green-${page.viewportSize()!.width}.png`,
    });
});
const id = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const metric = (page: Page, label: string) =>
  page.getByRole("heading", { name: label, exact: true }).locator("..").locator("..");
const records = (page: Page) => page.getByRole("region", { name: "對應記錄", exact: true });
async function open(page: Page, enabled = true, ready = true, extra = "") {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin &&
    ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort(),
  );
  await page.addInitScript((enabled) => {
    sessionStorage.setItem("no-link-fixture-actor", "manager");
    sessionStorage.setItem("performance-readback-actor", "actor-a");
    sessionStorage.setItem("analytics-fixture-enabled", String(enabled));
  }, enabled);
  await page.goto(
    origin + "/admin/analytics?start=2026-09-30&end=2026-09-30&cohortWindowDays=90" + extra,
  );
  await expect(page.getByRole("heading", { name: "營運及轉換統計", exact: true })).toBeVisible();
  if (enabled && ready) await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("4");
}
async function drill(page: Page, label = "有效查詢") {
  await metric(page, label).getByRole("button", { name: "可查看記錄", exact: true }).click();
  await expect(records(page).getByRole("table")).toBeVisible();
}
for (const width of [1440, 1280, 768, 390])
  test.describe(`${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("actor switch clears old report records and export before new scoped read", async ({
      page,
    }) => {
      await open(page);
      await drill(page);
      await page.evaluate(() => window.performanceReadbackFixture.changeContext("actor-b"));
      await expect(page.getByRole("button", { name: "匯出本頁 CSV", exact: true })).toHaveCount(0);
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("1");
      await expect(page.locator("#performance-branch")).toContainText("合成分行乙");
      await expect(page.locator("#performance-branch")).not.toContainText("合成分行甲");
      await drill(page);
      await expect(records(page).getByRole("row")).toHaveCount(2);
      await expect(records(page)).toContainText(id(91));
      await expect(records(page)).not.toContainText(id(1));
    });
    test("same-user staff binding change refetches report and options", async ({ page }) => {
      await open(page);
      await page.evaluate(() =>
        window.performanceReadbackFixture.changeContext("actor-a", "staff-b"),
      );
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("1");
      await expect(page.locator("#performance-staff")).toContainText("合成同事乙");
      expect(
        await page.evaluate(
          () =>
            window.performanceReadbackFixture.calls.filter(
              (c) => c.name === "report" && c.binding === "staff-b",
            ).length,
        ),
      ).toBeGreaterThan(0);
    });
    test("late old-actor report cannot restore old company metrics", async ({ page }) => {
      await page.addInitScript(() => sessionStorage.setItem("performance-delayed-initial", "true"));
      await open(page, true, false);
      await expect
        .poll(() => page.evaluate(() => window.performanceReadbackFixture.pending.length))
        .toBe(1);
      await page.evaluate(() => {
        window.performanceReadbackFixture.reportMode = "ok";
        return window.performanceReadbackFixture.changeContext("actor-b");
      });
      await page.evaluate(() => window.performanceReadbackFixture.pending.shift()!.release());
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("1");
    });
    test("late old-actor record reply cannot restore old rows or export", async ({ page }) => {
      await open(page);
      await page.evaluate(() => {
        window.performanceReadbackFixture.recordsMode = "delayed";
      });
      await metric(page, "有效查詢")
        .getByRole("button", { name: "可查看記錄", exact: true })
        .click();
      await expect
        .poll(() => page.evaluate(() => window.performanceReadbackFixture.pending.length))
        .toBe(1);
      await page.evaluate(() => {
        window.performanceReadbackFixture.recordsMode = "ok";
        return window.performanceReadbackFixture.changeContext("actor-b");
      });
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("1");
      await page.evaluate(() => window.performanceReadbackFixture.pending.shift()!.release());
      await expect(records(page)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "匯出本頁 CSV", exact: true })).toHaveCount(0);
      await drill(page);
      await expect(records(page)).toContainText(id(91));
      await expect(records(page)).not.toContainText(id(1));
    });
    test("same-user role downgrade clears report and makes no denied performance reads", async ({
      page,
    }) => {
      await open(page);
      await drill(page);
      const count = await page.evaluate(
        () =>
          window.performanceReadbackFixture.calls.filter((c) =>
            ["report", "options", "records"].includes(c.name),
          ).length,
      );
      await page.evaluate(() =>
        window.performanceReadbackFixture.changeContext("actor-a", "staff-a", "agent"),
      );
      await expect(
        page.getByRole("alert").filter({ hasText: "需要管理員或主管權限" }),
      ).toBeVisible();
      await expect(metric(page, "有效查詢")).toHaveCount(0);
      await expect(records(page)).toHaveCount(0);
      expect(
        await page.evaluate(
          () =>
            window.performanceReadbackFixture.calls.filter((c) =>
              ["report", "options", "records"].includes(c.name),
            ).length,
        ),
      ).toBe(count);
      await page.evaluate(() => window.performanceReadbackFixture.changeContext("actor-a"));
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("4");
    });
    test("invalid URL filters block report reads until explicit reset", async ({ page }) => {
      await open(page, true, false, "&branchId=invalid-scope");
      await expect(
        page.getByRole("alert").filter({ hasText: "網址中的績效篩選無效" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => window.performanceReadbackFixture.calls.filter((c) => c.name === "report").length,
        ),
      ).toBe(0);
      await page.getByRole("button", { name: "清除網址篩選", exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(
            () => window.performanceReadbackFixture.calls.filter((c) => c.name === "report").length,
          ),
        )
        .toBeGreaterThan(0);
      await expect(page.getByRole("alert").filter({ hasText: "網址中的績效篩選無效" })).toHaveCount(
        0,
      );
    });
    test("totals drilldown and visible CSV reconcile quality duplicate and HK day", async ({
      page,
    }) => {
      await open(page);
      await expect(metric(page, "唯一客戶").locator("p").first()).toHaveText("未有足夠資料");
      await expect(metric(page, "30／90 日成交轉換")).toContainText("25%");
      await expect(metric(page, "30／90 日成交轉換")).toContainText("分母 4");
      await expect(page.getByText(/更新於.*9:00/)).toBeVisible();
      await expect(metric(page, "有效查詢")).toHaveAttribute("title", /production/);
      await drill(page);
      await expect(records(page).getByRole("row")).toHaveCount(5);
      for (const n of [1, 2, 3, 4]) await expect(records(page)).toContainText(id(n));
      for (const n of [5, 6, 7, 8]) await expect(records(page)).not.toContainText(id(n));
      const download = page.waitForEvent("download");
      await records(page).getByRole("button", { name: "匯出本頁 CSV", exact: true }).click();
      const saved = await download,
        csv = await readFile((await saved.path())!, "utf8");
      expect(csv.replace(/^\uFEFF/, "").split(/\r?\n/)).toHaveLength(5);
      for (const n of [1, 2, 3, 4]) expect(csv).toContain(id(n));
      for (const n of [5, 6, 7, 8]) expect(csv).not.toContain(id(n));
      expect(saved.suggestedFilename()).toBe("performance-visible-page.csv");
    });
    test("unknown click denominator stays unknown and assignments do not count as human replies", async ({
      page,
    }) => {
      await open(page);
      await page.getByRole("tab", { name: "來源證據", exact: true }).click();
      await expect(metric(page, "28Hse 訊息來源").locator("p").first()).toHaveText("1");
      await expect(metric(page, "有追蹤開啟證據的查詢").locator("p").first()).toHaveText("1");
      await expect(metric(page, "來源未核實").locator("p").first()).toHaveText("2");
      await expect(metric(page, "點擊至查詢比率")).toContainText("未有足夠資料");
      await expect(metric(page, "點擊至查詢比率")).not.toContainText("0%");
      await expect(metric(page, "點擊至查詢比率").getByRole("button")).toHaveCount(0);
      await page.getByRole("tab", { name: "回覆及跟進", exact: true }).click();
      await expect(metric(page, "已確認分配").locator("p").first()).toHaveText("1");
      await expect(metric(page, "首回覆中位數").locator("p").first()).toHaveText("15 分鐘");
      await expect(metric(page, "未回覆").locator("p").first()).toHaveText("3");
      await drill(page, "首回覆中位數");
      await expect(records(page).getByRole("row")).toHaveCount(2);
      await expect(records(page)).toContainText(id(2));
    });
    test("source and rent filters retain same scope across reload and sales stay distinct", async ({
      page,
    }) => {
      await open(page);
      await page.getByRole("tab", { name: "成交及佣金", exact: true }).click();
      await expect(metric(page, "已核實成交").locator("p").first()).toHaveText("2");
      await expect(metric(page, "買賣成交額").locator("p").first()).toHaveText("HK$10,000,000.00");
      await page.getByRole("tab", { name: "新增與轉換", exact: true }).click();
      await page.locator("#performance-source").selectOption("28hse");
      await page.getByRole("button", { name: "套用篩選", exact: true }).click();
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("1");
      await page.reload();
      await expect(page.locator("#performance-source")).toHaveValue("28hse");
      await drill(page);
      await expect(records(page).getByRole("row")).toHaveCount(2);
      await expect(records(page)).toContainText(id(1));
      await page.locator("#performance-source").selectOption("whatsapp");
      await page.locator("#performance-deal").selectOption("rent");
      await page.getByRole("button", { name: "套用篩選", exact: true }).click();
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("1");
      await drill(page);
      await expect(records(page)).toContainText(id(2));
      await expect(records(page)).not.toContainText(id(1));
    });
    test("failed filtered report and drilldown never export previous rows or invent zero", async ({
      page,
    }) => {
      await open(page);
      await drill(page);
      await page.evaluate(() => {
        window.performanceReadbackFixture.reportMode = "failure";
      });
      await page.locator("#performance-source").selectOption("28hse");
      await page.getByRole("button", { name: "套用篩選", exact: true }).click();
      await expect(page.getByRole("alert").filter({ hasText: "未能載入績效" })).toBeVisible();
      await expect(metric(page, "有效查詢")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "匯出本頁 CSV", exact: true })).toHaveCount(0);
      await page.evaluate(() => {
        window.performanceReadbackFixture.reportMode = "ok";
      });
      await page.locator("#performance-source").selectOption("whatsapp");
      await page.getByRole("button", { name: "套用篩選", exact: true }).click();
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("3");
      await drill(page);
      await page.evaluate(() => {
        window.performanceReadbackFixture.recordsMode = "failure";
      });
      await metric(page, "有效查詢")
        .getByRole("button", { name: "可查看記錄", exact: true })
        .click();
      await expect(records(page).getByRole("alert")).toBeVisible();
      await expect(records(page).getByRole("table")).toHaveCount(0);
      await expect(
        records(page).getByRole("button", { name: "匯出本頁 CSV", exact: true }),
      ).toHaveCount(0);
    });
    test("disabled flag explains unavailable report and makes no performance reads", async ({
      page,
    }) => {
      await open(page, false);
      await expect(
        page.getByRole("heading", { name: "銷售及代理績效暫未啟用", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            window.performanceReadbackFixture.calls.filter((c) =>
              ["report", "options", "records"].includes(c.name),
            ).length,
        ),
      ).toBe(0);
      await expect(
        page.getByRole("heading", { name: "期間建立的查詢及跟進", exact: true }),
      ).toBeVisible();
    });
  });
