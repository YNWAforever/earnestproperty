import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
declare global {
  interface Window {
    syncFixture: {
      calls: { name: string; actor: string; input: unknown }[];
      readMode: string;
      applyMode: string;
      dispatchMode: string;
      reviewEnabled: boolean;
      releaseRead: null | (() => void);
      changeActor: (id: string, role: string) => Promise<void>;
    };
  }
}
let server: Server, origin: string;
const evidence: { name: string; status: string; width: number }[] = [];
test.beforeAll(async () => {
  assert.ok(!process.env.PLAYWRIGHT_BASE_URL);
  assert.equal(
    spawnSync(process.execPath, ["scripts/browser-fixtures/build-property-sync.mjs"], {
      stdio: "inherit",
    }).status,
    0,
  );
  const root = resolve(".audit/property-sync-browser");
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
    ".audit/remediation-20261003/ep13-20-sync-recovery-browser-summary.json",
    JSON.stringify(
      {
        codeSha: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
        evidenceLayer:
          "actual-property-sync-route-shell-staff-store-synthetic-auth-api-owned-loopback",
        realAuth: false,
        realDatabase: false,
        realProvider: false,
        realWorker: false,
        realSchedule: false,
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
async function open(page: Page, role = "admin", actor = "actor-a") {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin &&
    ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort(),
  );
  await page.addInitScript(
    ({ role, actor }) => {
      sessionStorage.setItem("sync-fixture-role", role);
      sessionStorage.setItem("sync-fixture-actor", actor);
    },
    { role, actor },
  );
  await page.goto(origin + "/admin/property-sync");
  await expect(page.getByRole("heading", { name: "盤源同步", exact: true })).toBeVisible();
  if (["admin", "manager"].includes(role))
    await expect(
      page.getByRole("checkbox", { name: "選取 28Hse 合成候選1", exact: true }),
    ).toBeVisible();
  expect(errors).toEqual([]);
}
const calls = (page: Page, name: string) =>
  page.evaluate((name) => window.syncFixture.calls.filter((c) => c.name === name), name);
const candidate = (page: Page) =>
  page.getByRole("checkbox", { name: "選取 28Hse 合成候選1", exact: true });
async function preview(page: Page) {
  await candidate(page).check();
  await page.getByRole("button", { name: "預覽所選撤盤", exact: true }).click();
  await expect(page.getByRole("heading", { name: "確認撤盤預覽", exact: true })).toBeVisible();
}
async function submit(page: Page) {
  await page
    .getByRole("textbox", { name: "核實原因", exact: true })
    .fill("已核實合成來源及保留租盤");
  await page.getByRole("checkbox", { name: "我已逐盤核實，只套用已選項目。", exact: true }).check();
  await page.getByRole("button", { name: "確認所選撤盤", exact: true }).click();
}
for (const width of [1440, 1280, 768, 390]) {
  test.describe(`${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("stage and held counts do not imply publication or approve conflicting offers", async ({
      page,
    }) => {
      await open(page);
      const history = page
        .locator("article")
        .filter({ has: page.getByRole("heading", { name: /^28Hse ·/ }) });
      await expect(history).toContainText("採集：完成");
      await expect(history).toContainText("匯入：完成");
      await expect(history).toContainText("上架：失敗");
      await expect(history).toContainText("驗證：未開始");
      const count = (label: string) =>
        history.locator("dt").filter({ hasText: label }).locator("..").locator("dd");
      await expect(count("已上架")).toHaveText("0");
      await expect(count("待核實")).toHaveText("74");
      await page.getByRole("button", { name: "重新載入", exact: true }).click();
      await expect(page.getByRole("button", { name: "重新載入", exact: true })).toBeEnabled();
      await expect(count("待核實")).toHaveText("74");
      expect(await calls(page, "dispatch")).toHaveLength(0);
      const card = page
        .locator("article")
        .filter({ has: page.getByRole("heading", { name: "28Hse", exact: true }) });
      const published = card
        .locator("dt")
        .filter({ hasText: "最後上架" })
        .locator("..")
        .locator("dd");
      await expect(published).toHaveText(
        await page.evaluate(() =>
          new Date("2026-10-02T00:50:00Z").toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" }),
        ),
      );
      await candidate(page).check();
      await page.getByRole("checkbox", { name: "選取 28Hse 合成候選2", exact: true }).check();
      await page.getByRole("button", { name: "預覽所選撤盤", exact: true }).click();
      await expect(
        page.getByRole("checkbox", { name: "套用 28Hse 合成候選2", exact: true }),
      ).toBeDisabled();
      await page.getByRole("checkbox", { name: "套用 28Hse 合成候選1", exact: true }).uncheck();
      await expect(page.getByRole("button", { name: "確認所選撤盤", exact: true })).toBeDisabled();
      await page.getByRole("checkbox", { name: "套用 28Hse 合成候選1", exact: true }).check();
      await submit(page);
      const applied = (await calls(page, "apply"))[0].input as { selectedIds: string[] };
      expect(applied.selectedIds).toEqual(["80000000-0000-4000-8000-000000000001"]);
    });
    test("source read failure removes previous source candidates before readback", async ({
      page,
    }) => {
      await open(page);
      await candidate(page).check();
      await page.evaluate(() => (window.syncFixture.readMode = "failure"));
      await page
        .getByRole("combobox", { name: "撤盤來源", exact: true })
        .selectOption("propertyhk");
      await expect(page.getByRole("alert")).toContainText("未能讀取撤盤候選，沒有更改樓盤。");
      await expect(candidate(page)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "預覽所選撤盤", exact: true })).toHaveCount(0);
      expect(await calls(page, "preview")).toHaveLength(0);
      expect(await calls(page, "apply")).toHaveLength(0);
      await page.evaluate(() => (window.syncFixture.readMode = "ok"));
      await page.getByRole("button", { name: "更新撤盤候選", exact: true }).click();
      await expect(
        page.getByRole("checkbox", { name: "選取 Property.hk 合成候選1", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("已選 0 項（上限100，只包含已載入項目）", { exact: true }),
      ).toBeVisible();
    });
    test("pending source read hides stale candidates until its own response", async ({ page }) => {
      await open(page);
      await page.evaluate(() => (window.syncFixture.readMode = "delayed"));
      await page
        .getByRole("combobox", { name: "撤盤來源", exact: true })
        .selectOption("propertyhk");
      await expect
        .poll(() => page.evaluate(() => Boolean(window.syncFixture.releaseRead)))
        .toBe(true);
      await expect(candidate(page)).toHaveCount(0);
      await expect(page.getByRole("combobox", { name: "撤盤來源", exact: true })).toBeDisabled();
      await page.evaluate(() => window.syncFixture.releaseRead!());
      await expect(
        page.getByRole("checkbox", { name: "選取 Property.hk 合成候選1", exact: true }),
      ).toBeVisible();
      expect(await calls(page, "apply")).toHaveLength(0);
    });
    test("confirmed result clears when source changes and cancellation never applies", async ({
      page,
    }) => {
      await open(page);
      await preview(page);
      await page.getByRole("button", { name: "取消預覽", exact: true }).click();
      expect(await calls(page, "apply")).toHaveLength(0);
      await preview(page);
      await submit(page);
      await expect(page.getByText("HSE-1：已核實下架", { exact: true })).toBeVisible();
      await page
        .getByRole("combobox", { name: "撤盤來源", exact: true })
        .selectOption("propertyhk");
      await expect(
        page.getByRole("checkbox", { name: "選取 Property.hk 合成候選1", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: "撤盤結果", exact: true })).toHaveCount(0);
      expect(await calls(page, "apply")).toHaveLength(1);
    });
    test("unknown withdrawal reload reads the original key without reapplying", async ({
      page,
    }) => {
      await open(page);
      await preview(page);
      await page.evaluate(() => (window.syncFixture.applyMode = "unknown"));
      await submit(page);
      await expect(page.getByRole("button", { name: "核對提交結果", exact: true })).toBeVisible();
      const sent = (await calls(page, "apply"))[0].input as { idempotencyKey: string };
      await page.reload();
      await expect(page.getByRole("button", { name: "核對提交結果", exact: true })).toBeVisible();
      await expect(candidate(page)).toBeDisabled();
      await page.getByRole("button", { name: "核對提交結果", exact: true }).click();
      await expect(page.getByText("HSE-1：已核實下架", { exact: true })).toBeVisible();
      expect(await calls(page, "apply")).toHaveLength(0);
      expect((await calls(page, "withdrawal-reconcile"))[0].input).toEqual({
        idempotencyKey: sent.idempotencyKey,
      });
    });
    test("dispatch unknown reload and frozen-stage retry retain their identities", async ({
      page,
    }) => {
      await open(page);
      await page.evaluate(() => (window.syncFixture.dispatchMode = "unknown"));
      await page.getByRole("button", { name: "立即同步", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "核對工作流程結果", exact: true }),
      ).toBeVisible();
      const sent = (await calls(page, "dispatch"))[0].input as { idempotencyKey: string };
      await page.reload();
      await expect(page.getByRole("button", { name: "立即同步", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "核對工作流程結果", exact: true }).click();
      await expect(page.getByRole("button", { name: "重試上架", exact: true })).toBeEnabled();
      expect((await calls(page, "dispatch-reconcile"))[0].input).toEqual({
        idempotencyKey: sent.idempotencyKey,
      });
      expect(await calls(page, "dispatch")).toHaveLength(0);
      await page.getByRole("button", { name: "重試上架", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("已提交工作流程");
      const retry = (await calls(page, "dispatch"))[0].input as {
        operation: string;
        runId: string;
      };
      expect(retry.operation).toBe("publication");
      expect(retry.runId).toBe("70000000-0000-4000-8000-000000000001");
      await page.getByText("支援診斷", { exact: true }).click();
      await expect(page.getByText("owned-request.json", { exact: true })).toBeVisible();
    });
    test("role recheck and actor switch discard preview and late source read", async ({ page }) => {
      await open(page);
      await preview(page);
      await page.evaluate(() => window.syncFixture.changeActor("actor-a", "agent"));
      await expect(page.getByRole("heading", { name: "確認撤盤預覽", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "立即同步", exact: true })).toHaveCount(0);
      await page.evaluate(() => window.syncFixture.changeActor("actor-a", "manager"));
      await expect(candidate(page)).toBeVisible();
      await expect(candidate(page)).not.toBeChecked();
      await page.evaluate(() => (window.syncFixture.readMode = "delayed-failure"));
      await page
        .getByRole("combobox", { name: "撤盤來源", exact: true })
        .selectOption("propertyhk");
      await expect
        .poll(() => page.evaluate(() => Boolean(window.syncFixture.releaseRead)))
        .toBe(true);
      await page.evaluate(() => {
        window.syncFixture.readMode = "ok";
        return window.syncFixture.changeActor("actor-b", "admin");
      });
      await expect(candidate(page)).toBeVisible();
      await page.evaluate(() => window.syncFixture.releaseRead!());
      await expect(page.getByRole("combobox", { name: "撤盤來源", exact: true })).toHaveValue(
        "28hse_agent_540",
      );
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(await calls(page, "apply")).toHaveLength(0);
    });
    test("viewer has no whole-company reads and manager has no dispatch", async ({ page }) => {
      await open(page, "viewer");
      await expect(page.getByText("你沒有權限批量核實全公司撤盤。", { exact: true })).toBeVisible();
      expect(await calls(page, "sync-read")).toHaveLength(0);
      expect(await calls(page, "withdrawal-read")).toHaveLength(0);
      await page.evaluate(() => window.syncFixture.changeActor("actor-a", "manager"));
      await expect(candidate(page)).toBeVisible();
      await expect(page.getByRole("button", { name: "立即同步", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "重試上架", exact: true })).toHaveCount(0);
    });
    test("disabled review exposes its reason without candidates or preview", async ({ page }) => {
      await open(page);
      await page.evaluate(() => (window.syncFixture.reviewEnabled = false));
      await page.getByRole("button", { name: "更新撤盤候選", exact: true }).click();
      await expect(page.getByText("撤盤 review 尚未啟用", { exact: true })).toBeVisible();
      await expect(candidate(page)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "預覽所選撤盤", exact: true })).toHaveCount(0);
      expect(await calls(page, "apply")).toHaveLength(0);
    });
  });
}
