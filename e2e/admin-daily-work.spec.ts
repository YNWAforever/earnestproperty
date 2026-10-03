import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
declare global {
  interface Window {
    dailyWorkFixture: {
      calls: { name: string; actor: string; role: string; binding: string; input: unknown }[];
      overviewMode: string;
      teamMode: string;
      empty: boolean;
      pending: { release: () => void; actor: string; role: string }[];
      changeContext: (
        actor: string,
        role: string,
        binding?: string,
        denied?: boolean,
      ) => Promise<void>;
    };
  }
}
let server: Server, origin: string;
const evidence: { name: string; status: string; width: number }[] = [];
test.beforeAll(async () => {
  assert.ok(!process.env.PLAYWRIGHT_BASE_URL);
  assert.equal(
    spawnSync(process.execPath, ["scripts/browser-fixtures/build-admin-daily-work.mjs"], {
      stdio: "inherit",
    }).status,
    0,
  );
  const root = resolve(".audit/daily-work-browser");
  server = createServer(async (request, response) => {
    try {
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
    ".audit/remediation-20261003/daily-work-browser-summary.json",
    JSON.stringify(
      {
        codeSha: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
        evidenceLayer: "actual-overview-leads-shell-staff-store-synthetic-auth-api-owned-loopback",
        realAuth: false,
        realDatabase: false,
        realProvider: false,
        results: evidence,
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
  evidence.push({
    name: info.title,
    status: fits ? (info.status ?? "unknown") : "failed",
    width: page.viewportSize()!.width,
  });
  expect(fits).toBe(true);
});
const card = (page: Page, label: string) =>
  page.getByRole("link").filter({ has: page.getByText(label, { exact: true }) });
const calls = (page: Page, name: string) =>
  page.evaluate((n) => window.dailyWorkFixture.calls.filter((c) => c.name === n), name);
async function open(page: Page, role = "manager") {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin &&
    ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort(),
  );
  await page.addInitScript((role) => {
    sessionStorage.setItem("daily-work-actor", "actor-a");
    sessionStorage.setItem("daily-work-role", role);
  }, role);
  await page.goto(origin + "/admin");
  await expect(page.getByRole("heading", { name: "總覽", exact: true })).toBeVisible();
  await expect(card(page, "開放查詢")).toContainText(role === "manager" ? "7" : "2");
  expect(errors).toEqual([]);
}
for (const width of [1440, 1280, 768, 390]) {
  test.describe(`${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("same-user role downgrade clears whole-company values and restricted team history", async ({
      page,
    }) => {
      await open(page);
      await expect(page.getByText("受限合成團隊成員", { exact: true })).toBeVisible();
      await page.evaluate(() => window.dailyWorkFixture.changeContext("actor-a", "agent"));
      await expect(card(page, "開放查詢")).toContainText("2");
      await expect(page.getByText("受限合成團隊成員", { exact: true })).toHaveCount(0);
      await expect(page.getByText("已更新團隊角色", { exact: true })).toHaveCount(0);
      await expect(page.getByText(/客戶資料範圍：我負責的查詢與對話/)).toBeVisible();
      expect((await calls(page, "overview")).map((c) => c.role)).toEqual(["manager", "agent"]);
    });
    test("same-user staff relink refreshes scope even when role is unchanged", async ({ page }) => {
      await open(page, "agent");
      await page.evaluate(() =>
        window.dailyWorkFixture.changeContext("actor-a", "agent", "staff-b"),
      );
      await expect(card(page, "開放查詢")).toContainText("3");
      expect((await calls(page, "overview")).map((c) => c.binding)).toEqual(["staff-a", "staff-b"]);
    });
    test("late manager success cannot replace fresh agent scope", async ({ page }) => {
      await open(page);
      await page.evaluate(() => (window.dailyWorkFixture.overviewMode = "delayed-success"));
      await page.getByRole("button", { name: "重新整理", exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.dailyWorkFixture.pending.length)).toBe(1);
      await page.evaluate(() => {
        window.dailyWorkFixture.overviewMode = "ok";
        return window.dailyWorkFixture.changeContext("actor-a", "agent");
      });
      await expect(card(page, "開放查詢")).toContainText("2");
      await page.evaluate(() => window.dailyWorkFixture.pending[0].release());
      await expect(card(page, "開放查詢")).toContainText("2");
      await expect(card(page, "開放查詢").getByRole("alert")).toHaveCount(0);
    });
    test("late denied old read cannot erase the new actor's result", async ({ page }) => {
      await open(page);
      await page.evaluate(() => (window.dailyWorkFixture.overviewMode = "delayed-denied"));
      await page.getByRole("button", { name: "重新整理", exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.dailyWorkFixture.pending.length)).toBe(1);
      await page.evaluate(() => {
        window.dailyWorkFixture.overviewMode = "ok";
        return window.dailyWorkFixture.changeContext("actor-b", "agent", "staff-b");
      });
      await expect(card(page, "開放查詢")).toContainText("3");
      await page.evaluate(() => window.dailyWorkFixture.pending[0].release());
      await expect(card(page, "開放查詢")).toContainText("3");
      await expect(card(page, "開放查詢").getByRole("alert")).toHaveCount(0);
    });
    test("partial directory failure preserves other success and current count", async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date("2026-10-03T01:00:00Z"));
      await open(page);
      await page.clock.setFixedTime(new Date("2026-10-03T01:05:00Z"));
      await page.evaluate(() => (window.dailyWorkFixture.teamMode = "failure"));
      await page.getByRole("button", { name: "重新整理", exact: true }).click();
      await expect(card(page, "啟用團隊").getByRole("alert")).toBeVisible();
      await expect(card(page, "啟用團隊")).toContainText("7");
      await expect(card(page, "開放查詢")).toContainText("7");
      await expect(card(page, "開放查詢").getByRole("alert")).toHaveCount(0);
      await expect(page.getByText(/資料截至.*香港時間/)).toBeVisible();
      const lastRead = await page.evaluate(
        () =>
          "最後成功讀取 " +
          new Date("2026-10-03T01:00:00Z").toLocaleString("zh-HK", {
            timeZone: "Asia/Hong_Kong",
          }) +
          "（香港時間）。",
      );
      await expect(card(page, "啟用團隊").getByRole("alert")).toContainText(lastRead);
      await expect(
        page.locator('[aria-labelledby="overview-attention"]').getByRole("alert"),
      ).toContainText(lastRead);
    });
    test("true empty differs from read failure and denied data is cleared", async ({ page }) => {
      await open(page, "agent");
      await page.evaluate(() => (window.dailyWorkFixture.empty = true));
      await page.getByRole("button", { name: "重新整理", exact: true }).click();
      await expect(card(page, "開放查詢")).toContainText("0");
      await page.evaluate(() => (window.dailyWorkFixture.overviewMode = "failure"));
      await page.getByRole("button", { name: "重新整理", exact: true }).click();
      await expect(card(page, "開放查詢").getByRole("alert")).toBeVisible();
      await expect(card(page, "開放查詢")).toContainText("0");
      await page.evaluate(() => (window.dailyWorkFixture.overviewMode = "denied"));
      await page.getByRole("button", { name: "重新整理", exact: true }).click();
      await expect(card(page, "開放查詢")).toContainText("—");
    });
    test("revoked membership stops reads and restored same-user scope starts fresh", async ({
      page,
    }) => {
      await open(page);
      const before = (await calls(page, "overview")).length;
      await page.evaluate(() =>
        window.dailyWorkFixture.changeContext("actor-a", "agent", "staff-a", true),
      );
      await expect(page.getByText("此帳戶不是職員帳戶", { exact: true })).toBeVisible();
      expect(await calls(page, "overview")).toHaveLength(before);
      await page.evaluate(() => window.dailyWorkFixture.changeContext("actor-a", "agent"));
      await expect(card(page, "開放查詢")).toContainText("2");
      await expect(page.getByText("受限合成團隊成員", { exact: true })).toHaveCount(0);
    });
    test("keyboard card opens the same filtered list and reload retains filter", async ({
      page,
    }) => {
      await open(page, "agent");
      const link = card(page, "開放查詢");
      await link.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/admin\/leads\?stage=open$/);
      await expect(page.getByText("每日工作合成查詢0", { exact: true })).toBeVisible();
      await expect(page.getByText("每日工作合成查詢1", { exact: true })).toBeVisible();
      expect((await calls(page, "leads"))[0].input).toMatchObject({ stage: "open" });
      await page.reload();
      await expect(page).toHaveURL(/\/admin\/leads\?stage=open$/);
      await expect(page.getByText("每日工作合成查詢1", { exact: true })).toBeVisible();
    });
  });
}
