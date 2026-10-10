import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";

type Fixture = { saves: unknown[]; editorReads: number };
declare global {
  interface Window {
    leaveGuardFixture: Fixture;
  }
}

// FX-17a G-20: the real TransactionForm and CMS dialogs, mounted on their real routes with
// in-memory ports. A leave guard must fire for unsaved work, must never fire for work that was
// just saved or never touched, and must ask again for an edit made after a save.
let server: Server, origin: string;
test.beforeAll(async () => {
  assert.ok(!process.env.PLAYWRIGHT_BASE_URL);
  assert.equal(
    spawnSync(process.execPath, ["scripts/browser-fixtures/build-admin-leave-guards.mjs"], {
      stdio: "inherit",
    }).status,
    0,
  );
  const root = resolve(".audit/leave-guards-browser");
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
});
test.use({ viewport: { width: 1440, height: 900 } });

const EDIT = "/admin/transactions/70000000-0000-4000-8000-0000000000aa";
const prompt = (page: Page) => page.getByRole("alertdialog", { name: "尚未儲存" });
const arrived = (page: Page) => page.getByRole("heading", { name: "離開後的頁面" });
const sidebarLink = (page: Page) =>
  page.locator('nav[aria-label="後台選單"] a[href="/admin/leads"]');
// With a Radix dialog open the sidebar is inert to the pointer, so a real click cannot reach it:
// fire the link's own click. Used only while a CMS dialog is open.
const clickBehindDialog = (page: Page) =>
  sidebarLink(page).evaluate((link) => (link as HTMLElement).click());
const saveCount = (page: Page) => page.evaluate(() => window.leaveGuardFixture.saves.length);

async function open(page: Page, path: string) {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin &&
    ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort(),
  );
  await page.goto(origin + path);
}

test.describe("transaction form", () => {
  test("a clean form lets staff leave without a prompt", async ({ page }) => {
    await open(page, EDIT);
    await expect(page.locator("#price")).toHaveValue("8500000");
    await sidebarLink(page).click();
    await expect(arrived(page)).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);
  });

  test("an edit asks 尚未儲存; cancelling stays, 離開並放棄修改 leaves", async ({ page }) => {
    await open(page, EDIT);
    await expect(page.locator("#price")).toHaveValue("8500000");
    await page.locator("#price").fill("9000000");
    await sidebarLink(page).click();
    await expect(prompt(page)).toBeVisible();
    await prompt(page).getByRole("button", { name: "取消" }).click();
    await expect(prompt(page)).toHaveCount(0);
    await expect(page.locator("#price")).toHaveValue("9000000");
    await sidebarLink(page).click();
    await prompt(page).getByRole("button", { name: "離開並放棄修改" }).click();
    await expect(arrived(page)).toBeVisible();
  });

  test("browser back from a dirty new transaction asks, and confirming goes back", async ({
    page,
  }) => {
    await open(page, "/admin/leads");
    await page.getByRole("link", { name: "新增成交（測試連結）" }).click();
    await page.locator("#price").fill("123");
    await page.goBack();
    await expect(prompt(page)).toBeVisible();
    await prompt(page).getByRole("button", { name: "離開並放棄修改" }).click();
    await expect(arrived(page)).toBeVisible();
  });

  test("saving a new transaction opens the saved record with no prompt", async ({ page }) => {
    await open(page, "/admin/transactions/new");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "合成屋苑" }).click();
    await page.locator("#price").fill("8000000");
    await page.locator("#saleable_area").fill("500");
    await page.locator("#deal_date").fill("2026-06-01");
    await page.getByRole("button", { name: "建立成交" }).click();
    await expect(page).toHaveURL(/\/admin\/transactions\/70000000-0000-4000-8000-0000000000bb$/);
    await expect(prompt(page)).toHaveCount(0);
    expect(await saveCount(page)).toBe(1);
    // The record that opened is clean: leaving it is free.
    await sidebarLink(page).click();
    await expect(arrived(page)).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);
  });

  test("after a save on the edit page, a later edit is guarded again", async ({ page }) => {
    await open(page, EDIT);
    await expect(page.locator("#price")).toHaveValue("8500000");
    await page.locator("#price").fill("9100000");
    await page.getByRole("button", { name: "更新成交" }).click();
    await expect.poll(() => saveCount(page)).toBe(1);
    await page.locator("#unit").fill("Z9");
    await sidebarLink(page).click();
    await expect(prompt(page)).toBeVisible();
    await prompt(page).getByRole("button", { name: "取消" }).click();
    // Putting the field back to the saved value makes the form clean again.
    await page.locator("#unit").fill("A");
    await sidebarLink(page).click();
    await expect(arrived(page)).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);
  });
});

test.describe("CMS dialogs", () => {
  test("a saved FAQ closes its dialog and leaving the page is not blocked", async ({ page }) => {
    await open(page, "/admin/cms?tab=faqs");
    await page.getByRole("button", { name: "新增 FAQ" }).first().click();
    await page.locator("form").getByLabel("問題", { exact: true }).fill("合成問題");
    await page.locator("form").getByLabel("答案", { exact: true }).fill("合成答案");
    await page.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await saveCount(page)).toBe(1);
    await sidebarLink(page).click();
    await expect(arrived(page)).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);
  });

  test("an unsaved FAQ asks on leaving the page; confirming leaves", async ({ page }) => {
    await open(page, "/admin/cms?tab=faqs");
    await page.getByRole("button", { name: "新增 FAQ" }).first().click();
    await page.locator("form").getByLabel("問題", { exact: true }).fill("寫了一半");
    await clickBehindDialog(page);
    await expect(prompt(page)).toBeVisible();
    await prompt(page).getByRole("button", { name: "離開並放棄修改" }).click();
    await expect(arrived(page)).toBeVisible();
  });

  test("opening an estate and waiting for it to load stays clean", async ({ page }) => {
    await open(page, "/admin/cms?tab=estates");
    await page.getByRole("button", { name: "編輯", exact: true }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.leaveGuardFixture.editorReads))
      .toBeGreaterThan(0);
    await page.waitForTimeout(300);
    await clickBehindDialog(page);
    await expect(arrived(page)).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);
  });
});
