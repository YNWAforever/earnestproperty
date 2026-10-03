import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";

declare global {
  interface Window {
    propertyFixture: {
      calls: { name: string; input: unknown }[];
      saveMode: string;
      readFailure: boolean;
      uploadMode: string;
      bulkMode: string;
    };
  }
}

// No external base URL is used. The real routes/CSS/components use an owned API model.
let server: Server, origin: string;
const evidence: { name: string; status: string; width: number }[] = [];
test.beforeAll(async () => {
  assert.ok(!process.env.PLAYWRIGHT_BASE_URL, "Unset external browser target for owned tests");
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
  await mkdir(".audit/remediation-20261003", { recursive: true });
  await writeFile(
    ".audit/remediation-20261003/property-browser-summary.json",
    JSON.stringify(
      {
        codeSha: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
        evidenceLayer: "real-routes-synthetic-api-owned-loopback",
        realAuth: false,
        realDatabase: false,
        realMediaProvider: false,
        results: evidence,
      },
      null,
      2,
    ),
  );
});
test.afterEach(async ({ page }, info) =>
  evidence.push({
    name: info.title,
    status: info.status ?? "unknown",
    width: page.viewportSize()!.width,
  }),
);
async function open(page: Page, path = "/admin/listings/A000001") {
  page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin &&
    ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort(),
  );
  await page.goto(origin + path);
  await expect(
    page.getByRole("heading", {
      name: path.includes("A000001") ? "管理物業" : "物業管理",
      exact: true,
    }),
  ).toBeVisible();
}
const saveCalls = (page: Page) =>
  page.evaluate(() => window.propertyFixture.calls.filter((call) => call.name === "save").length);

for (const width of [1440, 1280, 768, 390]) {
  test.describe(`${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("publication requires a frozen preview before saving", async ({ page }) => {
      await open(page);
      await page.getByText("1 項資料有差異，請核實", { exact: true }).click();
      await expect(page.getByText("來源差異（出售）：物業介紹", { exact: true })).toBeVisible();
      await expect(page.getByText(/管理：人工保護原文/)).toBeVisible();
      await page.getByText("來源及歷史記錄（1）", { exact: true }).click();
      await expect(page.getByText(/來源更新：.*04:17/)).toBeVisible();
      await page.getByRole("button", { name: "出售設定", exact: true }).click();
      await page.getByRole("combobox", { name: /^出售狀態/ }).selectOption("active");
      await page.getByLabel("售價（港元）", { exact: true }).fill("6200000");
      await page.getByRole("button", { name: "儲存出售設定", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      expect(await saveCalls(page)).toBe(0);
      await expect(page.getByRole("alertdialog")).toContainText("6,200,000");
      await page.getByRole("button", { name: "取消", exact: true }).click();
      await expect(page.getByLabel("售價（港元）", { exact: true })).toHaveValue("6200000");
      await page.getByRole("button", { name: "儲存出售設定", exact: true }).click();
      await page.getByRole("button", { name: "確認公開", exact: true }).click();
      await expect(page.getByText("所有修改已儲存", { exact: true })).toBeVisible();
      expect(await saveCalls(page)).toBe(1);
      await page.reload();
      await page.getByRole("button", { name: "出售設定", exact: true }).click();
      await expect(page.getByLabel("售價（港元）", { exact: true })).toHaveValue("6200000");
      await page.getByRole("button", { name: "出租設定", exact: true }).click();
      await expect(page.getByLabel("月租（港元）", { exact: true })).toHaveValue("18000");
    });
    test("validation retains input and focuses the first invalid field", async ({ page }) => {
      await open(page);
      await page.getByLabel("實用面積（平方呎）", { exact: true }).fill("800.5");
      await page.getByRole("textbox", { name: /^物業介紹/ }).fill("未儲存人工文字");
      await page.getByRole("button", { name: "儲存共用資料", exact: true }).click();
      await expect(page.getByLabel("實用面積（平方呎）", { exact: true })).toBeFocused();
      await expect(page.getByLabel("實用面積（平方呎）", { exact: true })).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await expect(page.getByRole("textbox", { name: /^物業介紹/ })).toHaveValue("未儲存人工文字");
      expect(await saveCalls(page)).toBe(0);
    });
    test("invalid offer amount focuses the amount and dirty scope cancel keeps text", async ({
      page,
    }) => {
      await open(page);
      await page.getByRole("button", { name: "出售設定", exact: true }).click();
      await page.getByLabel("售價（港元）", { exact: true }).fill("-1");
      await page.getByRole("textbox", { name: /^出售補充說明/ }).fill("保留未儲存售盤文字");
      await page.getByRole("button", { name: "儲存出售設定", exact: true }).click();
      await expect(page.getByLabel("售價（港元）", { exact: true })).toBeFocused();
      await expect(page.getByLabel("售價（港元）", { exact: true })).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(await saveCalls(page)).toBe(0);
      await page.getByRole("button", { name: "出租設定", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toContainText("尚未儲存修改");
      await page.getByRole("button", { name: "取消", exact: true }).click();
      await expect(page.getByRole("textbox", { name: /^出售補充說明/ })).toHaveValue(
        "保留未儲存售盤文字",
      );
      await expect(page.getByLabel("售價（港元）", { exact: true })).toHaveValue("-1");
    });
    test("failed upload retains text and photo order survives a fresh page", async ({ page }) => {
      await open(page);
      await page.getByRole("textbox", { name: /^物業介紹/ }).fill("上載失敗後保留文字");
      await page.evaluate(() => (window.propertyFixture.uploadMode = "fail"));
      await page.locator("#property-images").setInputFiles({
        name: "failed.png",
        mimeType: "image/png",
        buffer: Buffer.from("owned fixture"),
      });
      await expect(page.getByText("failed.png：合成媒體服務失敗", { exact: true })).toBeVisible();
      await expect(page.getByRole("textbox", { name: /^物業介紹/ })).toHaveValue(
        "上載失敗後保留文字",
      );
      const second = await page
        .getByRole("img", { name: "相片 2", exact: true })
        .getAttribute("src");
      await page.getByRole("button", { name: "將相片 2 上移", exact: true }).click();
      await page.getByRole("button", { name: "儲存共用資料", exact: true }).click();
      await expect(page.getByText("所有修改已儲存", { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("textbox", { name: /^物業介紹/ })).toHaveValue(
        "上載失敗後保留文字",
      );
      await expect(page.getByRole("img", { name: "相片 1", exact: true })).toHaveAttribute(
        "src",
        second!,
      );
    });
    test("CAS conflict and failed readback retain draft until confirmed reload", async ({
      page,
    }) => {
      await open(page);
      await page.getByRole("textbox", { name: /^物業介紹/ }).fill("衝突未儲存文字");
      await page.evaluate(() => (window.propertyFixture.saveMode = "conflict"));
      await page.getByRole("button", { name: "儲存共用資料", exact: true }).click();
      await expect(
        page.getByText("物業資料已被更新。請重新載入並核對後再提交。", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("textbox", { name: /^物業介紹/ })).toHaveValue("衝突未儲存文字");
      await page.evaluate(() => (window.propertyFixture.saveMode = "read-fail"));
      await page.getByRole("button", { name: "儲存共用資料", exact: true }).click();
      await expect(
        page.getByText("修改已儲存，但畫面未能更新。請重新載入後繼續。", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "儲存共用資料", exact: true })).toBeDisabled();
      await page.evaluate(() => (window.propertyFixture.readFailure = false));
      await page.getByRole("button", { name: "重新載入最新資料", exact: true }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "重新載入", exact: true })
        .click();
      await expect(page.getByText("所有修改已儲存", { exact: true })).toBeVisible();
      await expect(page.getByRole("textbox", { name: /^物業介紹/ })).toHaveValue("衝突未儲存文字");
    });
    test("50 selected properties keep sale-only scope and per-row partial results", async ({
      page,
    }) => {
      await open(page, "/admin/listings?pageSize=50&status=all");
      await page.getByRole("checkbox", { name: "選擇本頁全部可管理物業", exact: true }).check();
      await page.evaluate(() => (window.propertyFixture.bulkMode = "partial"));
      await page.getByRole("button", { name: "核對修改（50）", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toContainText("50 個物業");
      await page.getByRole("button", { name: "確認修改 50 個物業", exact: true }).click();
      await expect(page.getByText("已成功 48 個；未成功或未提交 2 個")).toBeVisible();
      await expect(
        page.getByText("#A000049：物業資料已被更新，請重新載入。", { exact: true }),
      ).toBeVisible();
      const result = await page.evaluate(() => ({
        calls: window.propertyFixture.calls.filter((call) => call.name === "bulk"),
        rows: JSON.parse(localStorage.getItem("property-fixture-store")!),
      }));
      expect(result.calls).toHaveLength(10);
      expect(result.calls.every((call) => (call.input as { scope: string }).scope === "sale")).toBe(
        true,
      );
      expect(
        result.rows.filter(
          (row: { offerings: { sale: { status: string } } }) =>
            row.offerings.sale.status === "offline",
        ),
      ).toHaveLength(48);
      expect(
        result.rows.every(
          (row: { offerings: { rent: { status: string } } }) =>
            row.offerings.rent.status === "active",
        ),
      ).toBe(true);
    });
    test("unknown bulk outcome stops remaining chunks and requires readback", async ({ page }) => {
      await open(page, "/admin/listings?pageSize=50&status=all");
      await page.getByRole("checkbox", { name: "選擇本頁全部可管理物業", exact: true }).check();
      await page.evaluate(() => (window.propertyFixture.bulkMode = "unknown"));
      await page.getByRole("button", { name: "核對修改（50）", exact: true }).click();
      await page.getByRole("button", { name: "確認修改 50 個物業", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "重新載入並核對結果", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => window.propertyFixture.calls.filter((call) => call.name === "bulk").length,
        ),
      ).toBe(1);
      await expect(page.getByRole("button", { name: /^核對修改/ })).toBeDisabled();
      await page.getByRole("button", { name: "重新載入並核對結果", exact: true }).click();
      await expect(page.getByText("已選 0 個物業", { exact: true })).toBeVisible();
      expect(
        await page.evaluate(
          () => window.propertyFixture.calls.filter((call) => call.name === "bulk").length,
        ),
      ).toBe(1);
    });
  });
}
