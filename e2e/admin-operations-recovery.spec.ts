import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
declare global {
  interface Window {
    operationsFixture: {
      mode: string;
      crowded: boolean;
      calls: { name: string; id?: string }[];
      releaseOldRead: null | (() => void);
    };
  }
}
let server: Server, origin: string;
const evidence: { name: string; status: string; width: number }[] = [];
const job = "40000000-0000-4000-8000-000000000001";
const timeoutJob = "40000000-0000-4000-8000-000000000002";
const noCodeJob = "40000000-0000-4000-8000-000000000003";
const repairRow = (page: Page) => page.getByRole("row").filter({ hasText: "更新 AI 知識庫" });
// FX-17a G-09: the list opens on 失敗, so a job that is no longer failed needs 所有狀態.
async function showAllStatuses(page: Page) {
  await page.getByRole("combobox", { name: "按狀態篩選背景工作" }).click();
  await page.getByRole("option", { name: "所有狀態", exact: true }).click();
}
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
  await new Promise<void>((done) => server.close(() => done()));
  await writeFile(
    ".audit/remediation-20261003/ep13-20-ci-compat-operations-browser-summary.json",
    JSON.stringify(
      {
        codeSha: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
        evidenceLayer: "real-route-synthetic-control-plane-owned-loopback",
        realAuth: false,
        realDatabase: false,
        realWorker: false,
        realProvider: false,
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
async function open(page: Page, actor = "admin") {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin &&
    ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort(),
  );
  await page.addInitScript(
    (value) => sessionStorage.setItem("property-fixture-actor", value),
    actor,
  );
  await page.goto(origin + "/admin/operations?tab=jobs");
  await expect(page.getByRole("heading", { name: "系統營運", exact: true })).toBeVisible();
  if (actor === "admin" || actor === "manager")
    await expect(page.getByText("更新 AI 知識庫", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
}
for (const width of [1440, 1280, 768, 390]) {
  test.describe(`${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("failed command remains inline with support reference", async ({ page }) => {
      await open(page);
      await page.evaluate(() => (window.operationsFixture.mode = "denied"));
      await page.getByRole("button", { name: `重試工作 ${job}`, exact: true }).click();
      await page.getByRole("button", { name: "重試", exact: true }).click();
      await expect(page.getByRole("tabpanel").getByRole("alert")).toContainText(
        "synthetic-denied-ref",
      );
      await expect(page.getByRole("tabpanel").getByRole("alert")).toContainText("未有執行重試");
      expect(
        await page.evaluate(
          () => window.operationsFixture.calls.filter((call) => call.name === "retry").length,
        ),
      ).toBe(1);
    });
    test("safe retry reads back same job and audit independently", async ({ page }) => {
      await open(page);
      await page.getByRole("button", { name: `重試工作 ${job}`, exact: true }).click();
      await page.getByRole("button", { name: "取消", exact: true }).click();
      expect(
        await page.evaluate(
          () => window.operationsFixture.calls.filter((call) => call.name === "retry").length,
        ),
      ).toBe(0);
      await page.getByRole("button", { name: `重試工作 ${job}`, exact: true }).click();
      await page.getByRole("button", { name: "重試", exact: true }).click();
      // Read back: the job left the 失敗 list, and shows 等候中 under 所有狀態.
      await expect(repairRow(page)).toHaveCount(0);
      await showAllStatuses(page);
      await expect(repairRow(page)).toContainText("等候中");
      await page.reload();
      await showAllStatuses(page);
      await expect(repairRow(page)).toContainText("等候中");
      await page.getByRole("tab", { name: "審計記錄", exact: true }).click();
      await expect(page.getByText("job.retry", { exact: true })).toBeVisible();
      await expect(page.getByText("synthetic-retry-ref", { exact: true })).toBeVisible();
      const saved = await page.evaluate(() => ({
        jobs: JSON.parse(localStorage.getItem("operations-fixture-jobs")!),
        audit: JSON.parse(localStorage.getItem("operations-fixture-audit")!),
      }));
      expect(saved.jobs).toHaveLength(3);
      expect(saved.jobs.filter((row: { status: string }) => row.status === "queued")).toHaveLength(
        1,
      );
      expect(saved.jobs.find((row: { id: string }) => row.id === job).status).toBe("queued");
      expect(saved.audit[0].resource_id).toBe(job);
    });
    test("unknown command reads original job before another attempt", async ({ page }) => {
      await open(page);
      await page.evaluate(() => (window.operationsFixture.mode = "unknown"));
      await page.getByRole("button", { name: `重試工作 ${job}`, exact: true }).click();
      await page.getByRole("button", { name: "重試", exact: true }).click();
      await expect(page.getByRole("tabpanel").getByRole("alert")).toContainText(
        "synthetic-unknown-ref",
      );
      await expect(
        page.getByRole("button", { name: `重試工作 ${job}`, exact: true }),
      ).toBeDisabled();
      await page.evaluate(() => (window.operationsFixture.mode = "read-fail"));
      await page.getByRole("button", { name: "重新載入背景工作", exact: true }).click();
      await expect(page.getByRole("tabpanel").getByRole("alert")).toContainText(
        "synthetic-read-ref",
      );
      await expect(
        page.getByRole("button", { name: `重試工作 ${job}`, exact: true }),
      ).toBeDisabled();
      await page.evaluate(() => (window.operationsFixture.mode = "ok"));
      await page.getByRole("button", { name: "重新載入背景工作", exact: true }).click();
      // The retry did go through, so the job is no longer in the 失敗 list; the read-back
      // still clears the lock because it looks for the job without the filters.
      await expect(repairRow(page)).toHaveCount(0);
      await showAllStatuses(page);
      await expect(repairRow(page)).toContainText("等候中");
      expect(
        await page.evaluate(
          () => window.operationsFixture.calls.filter((call) => call.name === "retry").length,
        ),
      ).toBe(1);
    });
    test("a read started before an unknown command cannot unlock another command", async ({
      page,
    }) => {
      await open(page);
      await page.evaluate(() => (window.operationsFixture.mode = "deferred"));
      await page.getByRole("button", { name: "重新載入背景工作", exact: true }).click();
      await page.waitForFunction(() => Boolean(window.operationsFixture.releaseOldRead));
      await page.evaluate(() => (window.operationsFixture.mode = "unknown"));
      await page.getByRole("button", { name: `重試工作 ${job}`, exact: true }).click();
      await page.getByRole("button", { name: "重試", exact: true }).click();
      await expect(page.getByRole("tabpanel").getByRole("alert")).toContainText(
        "synthetic-unknown-ref",
      );
      await page.evaluate(() => window.operationsFixture.releaseOldRead!());
      await expect(
        page.getByRole("button", { name: `重試工作 ${job}`, exact: true }),
      ).toBeDisabled();
      // The status badge itself, not the 原因 column (which also contains 失敗).
      await expect(repairRow(page).getByText("失敗", { exact: true })).toBeVisible();
      await page.evaluate(() => (window.operationsFixture.mode = "ok"));
      await page.getByRole("button", { name: "重新載入背景工作", exact: true }).click();
      await showAllStatuses(page);
      await expect(repairRow(page)).toContainText("等候中");
      expect(
        await page.evaluate(
          () => window.operationsFixture.calls.filter((call) => call.name === "retry").length,
        ),
      ).toBe(1);
    });
    test("an old retried job is read back by id when newer jobs fill the first page", async ({
      page,
    }) => {
      await open(page);
      await page.evaluate(() => {
        window.operationsFixture.crowded = true;
        window.operationsFixture.mode = "unknown";
      });
      await page.getByRole("button", { name: "重新載入背景工作", exact: true }).click();
      await page.getByRole("button", { name: `重試工作 ${job}`, exact: true }).click();
      await page.getByRole("button", { name: "重試", exact: true }).click();
      await expect(page.getByText("指令結果未明", { exact: false })).toBeVisible();
      await page.evaluate(() => (window.operationsFixture.mode = "ok"));
      await page.getByRole("button", { name: "重新載入背景工作", exact: true }).click();
      // 30 newer jobs fill the page, so only a read by id can find the retried job.
      await expect(page.getByText("指令結果未明", { exact: false })).toHaveCount(0);
      expect(
        await page.evaluate(
          () => window.operationsFixture.calls.filter((call) => call.name === "jobs-by-id").length,
        ),
      ).toBeGreaterThan(0);
    });
    test("read failure preserves visible jobs and restricted actor cannot retry", async ({
      page,
    }) => {
      await open(page);
      await page.evaluate(() => (window.operationsFixture.mode = "read-fail"));
      await page.getByRole("button", { name: "重新載入背景工作", exact: true }).click();
      await expect(page.getByRole("tabpanel").getByRole("alert")).toContainText(
        "synthetic-read-ref",
      );
      await expect(page.getByText("更新 AI 知識庫", { exact: true })).toBeVisible();
      expect(
        await page.evaluate(
          () => window.operationsFixture.calls.filter((call) => call.name === "retry").length,
        ),
      ).toBe(0);
      await open(page, "viewer");
      await expect(page.getByRole("tab", { name: "背景工作", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: `重試工作 ${job}`, exact: true })).toHaveCount(
        0,
      );
    });
    test("the jobs tab opens on 失敗, shows 原因, and the type select narrows the list", async ({
      page,
    }) => {
      await open(page, "manager");
      await expect(page.getByRole("combobox", { name: "按狀態篩選背景工作" })).toContainText(
        "失敗",
      );
      await expect(page.getByRole("columnheader", { name: "原因", exact: true })).toBeVisible();
      const timeout = page.getByRole("row").filter({ hasText: "推廣活動發送" });
      await expect(timeout).toContainText("WhatsApp 服務沒有及時回應。");
      // A code the table does not know, and a failed job with no stored code.
      await expect(repairRow(page)).toContainText("處理失敗（未分類原因）。");
      await expect(page.getByRole("row").filter({ hasText: "回覆期限檢查" })).toContainText(
        "失敗，未有記錄原因。",
      );
      // Neither the raw type, the raw code nor the job id is on screen for a manager.
      await expect(page.getByText("woztell.campaign.deliver")).toHaveCount(0);
      await expect(page.getByText("WOZTELL_PROVIDER_TIMEOUT")).toHaveCount(0);
      await expect(page.getByText(timeoutJob)).toHaveCount(0);
      await page.getByRole("combobox", { name: "按工作類型篩選" }).click();
      await page.getByRole("option", { name: "推廣活動發送", exact: true }).click();
      await expect(timeout).toHaveCount(1);
      await expect(repairRow(page)).toHaveCount(0);
      await expect(page.getByRole("row").filter({ hasText: "回覆期限檢查" })).toHaveCount(0);
      await page.screenshot({
        path: `.audit/fx-17a-admin/jobs-manager-${width}.png`,
        fullPage: true,
      });
    });
    test("a manager sees no 技術資料; an admin sees the job id inside it", async ({ page }) => {
      await open(page, "manager");
      await expect(page.getByRole("button", { name: "技術資料" })).toHaveCount(0);
      await open(page, "admin");
      await expect(page.getByRole("button", { name: "技術資料" })).toHaveCount(3);
      await expect(page.getByText(`工作編號：${timeoutJob}`)).toHaveCount(0);
      await page
        .getByRole("row")
        .filter({ hasText: "推廣活動發送" })
        .getByRole("button", { name: "技術資料" })
        .click();
      await expect(page.getByText(`工作編號：${timeoutJob}`)).toBeVisible();
      await expect(page.getByText("工作類型代碼：woztell.campaign.deliver")).toBeVisible();
      await expect(page.getByText("錯誤代碼：WOZTELL_PROVIDER_TIMEOUT")).toBeVisible();
      await page.screenshot({
        path: `.audit/fx-17a-admin/jobs-admin-${width}.png`,
        fullPage: true,
      });
    });
    test("retrying a delivery job warns that it may send again", async ({ page }) => {
      await open(page);
      const warning = "重試可能會再次發送 WhatsApp 訊息。請先核對客戶或同事是否已收到，才重試。";
      await page.getByRole("button", { name: `重試工作 ${timeoutJob}`, exact: true }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toContainText("推廣活動發送：WhatsApp 服務沒有及時回應。");
      await expect(dialog).toContainText(warning);
      await expect(dialog).not.toContainText(timeoutJob);
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      // A job that sends nothing gets no warning.
      await page.getByRole("button", { name: `重試工作 ${noCodeJob}`, exact: true }).click();
      await expect(page.getByRole("alertdialog")).toContainText(
        "回覆期限檢查：失敗，未有記錄原因。",
      );
      await expect(page.getByRole("alertdialog")).not.toContainText(warning);
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "取消", exact: true })
        .click();
      expect(
        await page.evaluate(
          () => window.operationsFixture.calls.filter((call) => call.name === "retry").length,
        ),
      ).toBe(0);
    });
  });
}
const receipt = "60000000-0000-4000-8000-000000000001";
const receiptButton = `重試收件 ${receipt.slice(0, 8)}`;
for (const width of [1440, 375]) {
  test.describe(`receipts ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("receipt retry confirms, reads back and shows 已補錄這則來訊", async ({ page }) => {
      await open(page);
      const panel = page.getByRole("region", { name: "WhatsApp 來訊收件" });
      await expect(panel).toBeVisible();
      await expect(panel.getByText("等候重試", { exact: true })).toBeVisible();
      // C-09 row: labelled, linked to the conversation, and has no retry button.
      const routing = panel.getByRole("row").filter({ hasText: "需要分派" });
      await expect(routing).toContainText("請開啟對話並手動分派");
      await expect(routing.getByRole("link", { name: "開啟對話" })).toHaveAttribute(
        "href",
        /^\/admin\/whatsapp\?conversation=/,
      );
      await expect(routing.getByRole("button")).toHaveCount(0);
      await page.screenshot({
        path: `.audit/fx-07-jobs-drain/receipts-before-${width}.png`,
        fullPage: true,
      });

      await panel.getByRole("button", { name: receiptButton, exact: true }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toContainText("重試這則來訊？");
      await expect(dialog).toContainText(
        "系統會再嘗試把這則訊息寫入收件匣（只作記錄）。不會回覆客戶，亦不會通知或分派同事。",
      );
      await dialog.getByRole("button", { name: "取消", exact: true }).click();

      await panel.getByRole("button", { name: receiptButton, exact: true }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "重試", exact: true })
        .click();
      await expect(page.getByText("已補錄這則來訊。", { exact: true })).toBeVisible();
      // Read back from the (synthetic) server: the row is gone, the C-09 row remains.
      await expect(panel.getByRole("button", { name: receiptButton, exact: true })).toHaveCount(0);
      await expect(panel.getByText("需要分派", { exact: true })).toBeVisible();
      await page.screenshot({
        path: `.audit/fx-07-jobs-drain/receipts-after-${width}.png`,
        fullPage: true,
      });
      await page.reload();
      await expect(
        page.getByRole("region", { name: "WhatsApp 來訊收件" }).getByRole("button", {
          name: receiptButton,
          exact: true,
        }),
      ).toHaveCount(0);
      const audit = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("operations-fixture-audit")!),
      );
      expect(audit[0].action).toBe("whatsapp.receipt.retry");
      expect(audit[0].resource_id).toBe(receipt);
    });
    test("a conflicting receipt retry reloads and says the state changed", async ({ page }) => {
      await open(page);
      await page.evaluate(() => (window.operationsFixture.mode = "receipt-conflict"));
      await page.getByRole("button", { name: receiptButton, exact: true }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "重試", exact: true })
        .click();
      await expect(
        page.getByText("此收件的狀態已改變，未有重試。已重新載入最新狀態。", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: receiptButton, exact: true })).toBeVisible();
    });
    test("restricted actors see no receipt retry button", async ({ page }) => {
      await open(page, "viewer");
      await expect(page.getByRole("button", { name: receiptButton, exact: true })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "WhatsApp 來訊收件" })).toHaveCount(0);
    });
  });
}
