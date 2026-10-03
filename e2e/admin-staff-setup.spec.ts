import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
declare global {
  interface Window {
    staffFixture: {
      calls: { name: string; input?: unknown }[];
      directory: string;
      review: string;
      submit: string;
      read: string;
      result: string;
      endpointVersion: number;
      savedVersion: number;
    };
  }
}
let server: Server, origin: string;
const staffId = "60000000-0000-4000-8000-000000000001";
const evidence: { name: string; status: string; width: number }[] = [];
test.beforeAll(async () => {
  assert.ok(!process.env.PLAYWRIGHT_BASE_URL);
  assert.equal(
    spawnSync(process.execPath, ["scripts/browser-fixtures/build-property-maintenance.mjs"], {
      stdio: "inherit",
    }).status,
    0,
  );
  const root = resolve(".audit/property-maintenance-browser");
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
    ".audit/remediation-20261003/staff-browser-summary.json",
    JSON.stringify(
      {
        codeSha: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
        evidenceLayer: "actual-staff-settings-route-synthetic-auth-api-owned-loopback",
        realAuth: false,
        realDatabase: false,
        realProvider: false,
        realWorker: false,
        results: evidence,
      },
      null,
      2,
    ),
  );
});
test.afterEach(async ({ page }, info) => {
  evidence.push({
    name: info.title,
    status: info.status ?? "unknown",
    width: page.viewportSize()!.width,
  });
});
async function open(page: Page, step = 1, folderMode = "ok") {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin &&
    ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort(),
  );
  await page.addInitScript((mode) => {
    sessionStorage.setItem("property-fixture-actor", "manager");
    sessionStorage.setItem("staff-folder-mode", mode);
  }, folderMode);
  await page.goto(origin + `/admin/whatsapp-settings?staffId=${staffId}&step=${step}`);
  await expect(page.getByRole("heading", { name: "同事接收設定", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
}
const calls = (page: Page, name: string) =>
  page.evaluate((n) => window.staffFixture.calls.filter((c) => c.name === n), name);
const folderSelect = (page: Page) =>
  page
    .locator("label")
    .filter({ hasText: /^Folder 名稱/ })
    .locator("select");
async function chooseAccount(page: Page) {
  await folderSelect(page).selectOption("owned-sales");
  await page.getByRole("button", { name: "搜尋公司 Inbox 帳戶", exact: true }).click();
  await page.getByRole("radio").first().check();
}
async function preview(page: Page) {
  await page.getByRole("button", { name: "測試 Inbox 私有備註", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "同事通知試送" })).toContainText("合成接單群組");
  expect(await calls(page, "enqueue")).toHaveLength(0);
}
for (const width of [1440, 1280, 768, 390]) {
  test.describe(`${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("duplicate names pagination denied and expired review cannot save", async ({ page }) => {
      await open(page);
      await chooseAccount(page);
      await expect(page.getByRole("button", { name: "儲存已核實映射" })).toBeDisabled();
      await page.getByRole("button", { name: "載入下一頁帳戶" }).click();
      await expect(page.getByRole("radio")).toHaveCount(2);
      await expect(page.getByRole("group", { name: "選擇 Inbox 帳戶" })).toContainText(
        "haze.eps@synthetic.invalid",
      );
      await expect(page.getByRole("group", { name: "選擇 Inbox 帳戶" })).toContainText(
        "haze.ept@synthetic.invalid",
      );
      await page.evaluate(() => (window.staffFixture.review = "denied"));
      await page.getByRole("button", { name: "檢查連接", exact: true }).click();
      await expect(page.getByRole("alert").first()).toBeFocused();
      await expect(page.getByRole("button", { name: "儲存已核實映射" })).toBeDisabled();
      await page.evaluate(() => (window.staffFixture.review = "expired"));
      await page.getByRole("button", { name: "檢查連接", exact: true }).click();
      await expect(page.getByRole("region", { name: "Inbox 連接摘要" })).toContainText(
        "本次連接檢查：已核實",
      );
      await expect(page.getByRole("button", { name: "儲存已核實映射" })).toBeDisabled();
      expect(await calls(page, "mapping-save")).toHaveLength(0);
    });
    for (const mode of ["empty", "denied", "outage"]) {
      test(`folder ${mode} remains distinct and recoverable`, async ({ page }) => {
        await open(page, 1, mode);
        await expect(folderSelect(page)).toBeDisabled();
        await expect(page.getByRole("button", { name: "儲存已核實映射" })).toBeDisabled();
        if (mode === "empty")
          await expect(
            page.getByText("尚未設定已核實 Folder；請由管理員依供應商資料完成一次性設定。"),
          ).toBeVisible();
        else {
          await expect(
            page.getByRole("alert").filter({
              hasText: mode === "denied" ? "沒有權限讀取公司 Folder" : "暫時無法載入 Folder",
            }),
          ).toBeVisible();
          await page.evaluate(() => {
            window.staffFixture.directory = "ok";
            sessionStorage.setItem("staff-folder-mode", "ok");
          });
          await page.getByRole("button", { name: "重新載入 Folder" }).click();
          await expect(folderSelect(page)).toBeEnabled();
        }
        expect(await calls(page, "enqueue")).toHaveLength(0);
      });
    }
    test("four steps save no send and fresh mapping readback keeps phone separate", async ({
      page,
    }) => {
      await open(page, 0);
      const select = page.getByLabel("同事姓名／工作電郵／分行");
      await expect(select.locator("option")).toHaveCount(3);
      await expect(select).not.toContainText("離職同事");
      await page.getByRole("button", { name: "下一步", exact: true }).click();
      await chooseAccount(page);
      await page.getByRole("button", { name: "檢查連接", exact: true }).click();
      await page.getByRole("button", { name: "儲存已核實映射" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Inbox 映射已儲存" })).toBeVisible();
      await expect(page.getByRole("checkbox").filter({ visible: true })).toHaveCount(0);
      expect(await calls(page, "enqueue")).toHaveLength(0);
      await page.getByRole("button", { name: "下一步", exact: true }).click();
      await expect(page.getByText("手機通知尚未獲授權")).toBeVisible();
      await expect(page.getByRole("button", { name: "測試同事 WhatsApp" })).toBeDisabled();
      await preview(page);
      await page.getByRole("button", { name: "關閉", exact: true }).click();
      expect(await calls(page, "enqueue")).toHaveLength(0);
      await page.goto(origin + `/admin/whatsapp-settings?staffId=${staffId}&step=1`);
      await expect(page.getByRole("region", { name: "Inbox 連接摘要" })).toContainText(
        "已核實，可接單 · 版本 1",
      );
    });
    test("unknown submission retains request and blocks new preview until original readback", async ({
      page,
    }) => {
      await open(page, 3);
      await preview(page);
      await page.evaluate(() => {
        window.staffFixture.submit = "unknown";
        window.staffFixture.read = "outage";
      });
      await page.getByRole("button", { name: "明確提交試送" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      const originalId = await page.evaluate(
        (id) => sessionStorage.getItem(`staff-test:${id}:inbox_private_note`),
        staffId,
      );
      expect(originalId).toBeTruthy();
      await page.getByRole("button", { name: "關閉", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "測試 Inbox 私有備註", exact: true }),
      ).toBeDisabled();
      expect(
        await page.evaluate(
          (id) => sessionStorage.getItem(`staff-test:${id}:inbox_private_note`),
          staffId,
        ),
      ).toBe(originalId);
      await page.getByRole("button", { name: "查閱原試送結果", exact: true }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await page.evaluate(() => (window.staffFixture.read = "ok"));
      await page.getByRole("button", { name: "查閱原試送結果", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("供應商已接納，尚未核實送達");
      expect(await calls(page, "enqueue")).toHaveLength(1);
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("staff-fixture-attempts")!).length,
        ),
      ).toBe(1);
      await expect(page.getByRole("dialog")).toContainText(originalId!);
    });
    test("reload recovery and accepted status never imply delivery or acknowledgement", async ({
      page,
    }) => {
      await open(page, 3);
      await preview(page);
      await page.evaluate(() => (window.staffFixture.submit = "unknown"));
      await page.getByRole("button", { name: "明確提交試送" }).click();
      await page.reload();
      await expect(page.getByRole("status")).toContainText("供應商已接納，尚未核實送達");
      await expect(page.getByRole("status")).toContainText(
        "供應商送達：未核實；同事收件確認：未核實；接手確認：未核實",
      );
      expect(await calls(page, "enqueue")).toHaveLength(0);
      await page.getByLabel("收件確認證據編號", { exact: true }).fill("owned-human-receipt");
      await page.getByRole("button", { name: "記錄同事收件確認" }).click();
      await expect(page.getByRole("status")).toContainText("同事已確認收件（人工紀錄）");
      await expect(page.getByRole("status")).toContainText("供應商送達：未核實");
      await expect(page.getByRole("status")).toContainText("接手確認：未核實");
      expect(await calls(page, "enqueue")).toHaveLength(0);
    });
    test("failed original lookup after reload retains journal and can recover without enqueue", async ({
      page,
    }) => {
      await open(page, 3);
      await preview(page);
      await page.evaluate(() => {
        window.staffFixture.submit = "unknown";
        sessionStorage.setItem("staff-read-mode", "outage");
      });
      await page.getByRole("button", { name: "明確提交試送" }).click();
      const id = await page.evaluate(
        (s) => sessionStorage.getItem(`staff-test:${s}:inbox_private_note`),
        staffId,
      );
      await page.reload();
      await expect(page.getByRole("alert")).toContainText("未能查閱先前試送");
      await expect(
        page.getByRole("button", { name: "測試 Inbox 私有備註", exact: true }),
      ).toBeDisabled();
      expect(
        await page.evaluate(
          (s) => sessionStorage.getItem(`staff-test:${s}:inbox_private_note`),
          staffId,
        ),
      ).toBe(id);
      await page.evaluate(() => (window.staffFixture.read = "ok"));
      await page.getByRole("button", { name: "查閱原試送結果", exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText(id!);
      await expect(page.getByRole("status")).toContainText("尚未核實送達");
      expect(await calls(page, "enqueue")).toHaveLength(0);
    });
    test("worker unknown result stays read-only after fresh lookup", async ({ page }) => {
      await open(page, 3);
      await preview(page);
      await page.evaluate(() => (window.staffFixture.result = "unknown"));
      await page.getByRole("button", { name: "明確提交試送" }).click();
      await expect(page.getByRole("status")).toContainText("結果不明");
      await page.getByRole("button", { name: "關閉", exact: true }).click();
      await page.getByRole("button", { name: "查閱原試送結果", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "測試 Inbox 私有備註", exact: true }),
      ).toBeDisabled();
      await expect(page.getByRole("button", { name: "明確提交試送" })).toBeDisabled();
      expect(await calls(page, "preview")).toHaveLength(1);
      expect(await calls(page, "enqueue")).toHaveLength(1);
    });
    test("endpoint changed after preview requires new version and no implicit send", async ({
      page,
    }) => {
      await open(page, 3);
      await preview(page);
      await page.evaluate(() => (window.staffFixture.endpointVersion = 2));
      await page.getByRole("button", { name: "重新核對能力與端點版本" }).click();
      await expect(page.getByRole("dialog")).toContainText("端點版本已變更");
      await expect(page.getByRole("dialog").locator("dl")).toContainText("端點版本：v1");
      await expect(page.getByRole("button", { name: "明確提交試送" })).toBeDisabled();
      expect(await calls(page, "enqueue")).toHaveLength(0);
      await page.getByRole("button", { name: "關閉", exact: true }).click();
      await preview(page);
      await expect(page.getByRole("dialog").locator("dl")).toContainText("端點版本：v2");
      await expect(page.getByRole("button", { name: "明確提交試送" })).toBeEnabled();
      expect(await calls(page, "enqueue")).toHaveLength(0);
    });
  });
}
