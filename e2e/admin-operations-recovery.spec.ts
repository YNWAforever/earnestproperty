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
      calls: { name: string; id?: string }[];
      releaseOldRead: null | (() => void);
    };
  }
}
let server: Server, origin: string;
const evidence: { name: string; status: string; width: number }[] = [];
const job = "40000000-0000-4000-8000-000000000001";
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
    await expect(page.getByText("ai.knowledge.repair", { exact: true })).toBeVisible();
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
      await expect(page.getByRole("row").filter({ hasText: "ai.knowledge.repair" })).toContainText(
        "等候中",
      );
      await page.reload();
      await expect(page.getByRole("row").filter({ hasText: "ai.knowledge.repair" })).toContainText(
        "等候中",
      );
      await page.getByRole("tab", { name: "審計記錄", exact: true }).click();
      await expect(page.getByText("job.retry", { exact: true })).toBeVisible();
      await expect(page.getByText("synthetic-retry-ref", { exact: true })).toBeVisible();
      const saved = await page.evaluate(() => ({
        jobs: JSON.parse(localStorage.getItem("operations-fixture-jobs")!),
        audit: JSON.parse(localStorage.getItem("operations-fixture-audit")!),
      }));
      expect(saved.jobs).toHaveLength(1);
      expect(saved.jobs[0].id).toBe(job);
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
      await expect(page.getByRole("row").filter({ hasText: "ai.knowledge.repair" })).toContainText(
        "等候中",
      );
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
      await expect(page.getByRole("row").filter({ hasText: "ai.knowledge.repair" })).toContainText(
        "失敗",
      );
      await page.evaluate(() => (window.operationsFixture.mode = "ok"));
      await page.getByRole("button", { name: "重新載入背景工作", exact: true }).click();
      await expect(page.getByRole("row").filter({ hasText: "ai.knowledge.repair" })).toContainText(
        "等候中",
      );
      expect(
        await page.evaluate(
          () => window.operationsFixture.calls.filter((call) => call.name === "retry").length,
        ),
      ).toBe(1);
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
      await expect(page.getByText("ai.knowledge.repair", { exact: true })).toBeVisible();
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
