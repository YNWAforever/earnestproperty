// FX-12 Task 4: the 「可能重複客戶」 list in /admin/leads. Actual leads route, shell and staff
// store; synthetic auth and API (scripts/browser-fixtures/daily-work/identity-review-api.ts)
// on an owned loopback server. No real database, provider or WhatsApp send.
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Browser, type Page } from "@playwright/test";

const ALREADY = "此項目已由其他同事處理，請重新載入。";
let server: Server, origin: string;

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
});

type ReviewFixture = { calls: { name: string; role: string; input: unknown }[] };
async function openLeads(page: Page, role = "manager", search = "") {
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
  await page.goto(`${origin}/admin/leads${search}`);
  // The quick filters stay in review mode; the lead search is hidden there.
  await expect(page.getByRole("button", { name: "新查詢", exact: true })).toBeVisible();
  return errors;
}
const reviewCalls = (page: Page, name: string) =>
  page.evaluate(
    (n) =>
      (window as unknown as { identityReviewFixture: ReviewFixture }).identityReviewFixture.calls
        .filter((call) => call.name === n)
        .map((call) => call.input),
    name,
  );
const quickFilter = (page: Page) => page.getByRole("button", { name: /^可能重複客戶（\d+）$/ });
const conflictRow = (page: Page) =>
  page.getByRole("row").filter({ hasText: "此 WhatsApp 訊息的帳戶與電話分屬不同客戶記錄" });
// Dialog and sheet open with CSS animations; capture evidence only once they have finished.
const settle = (page: Page) =>
  page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => null))),
  );
const fits = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const [width, height] of [
  [1440, 900],
  [375, 812],
] as const) {
  test(`a manager filters 可能重複客戶, resolves a conflict and sees it leave the open list (${width})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const errors = await openLeads(page);
    await expect(quickFilter(page)).toHaveText("可能重複客戶（2）");
    await quickFilter(page).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("review")).toBe("identity");
    await expect(page.getByRole("heading", { name: "可能重複客戶", exact: true })).toBeVisible();
    await expect(
      page.getByText("系統發現以下客戶記錄可能屬於同一人，請逐一核對。系統不會自動合併。"),
    ).toBeVisible();
    await expect(conflictRow(page)).toHaveCount(1);
    await expect(page.getByText("電話格式重複", { exact: true })).toBeVisible();
    // Masked phones only.
    expect(await page.locator("body").innerText()).not.toMatch(/\d{8}/);
    // Review mode hides the lead-only search and counter, and reads no lead page after the switch.
    await expect(page.getByRole("textbox", { name: "搜尋客戶查詢", exact: true })).toHaveCount(0);
    await expect(page.getByText(/^顯示 \d+ 筆/)).toHaveCount(0);
    expect(await fits(page)).toBe(true);
    await settle(page);
    await page.screenshot({
      path: `.audit/remediation-20261003/fx12-identity-review-list-${width}.png`,
      fullPage: true,
    });

    await conflictRow(page).getByRole("button", { name: "連結到「合成乙」" }).click();
    const dialog = page.getByRole("dialog", { name: "確認處理？" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("備註（可選）").fill("已致電核對");
    await settle(page);
    await page.screenshot({
      path: `.audit/remediation-20261003/fx12-identity-review-confirm-${width}.png`,
    });
    await dialog.getByRole("button", { name: "確認", exact: true }).click();
    await expect(page.getByText("已處理。", { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(conflictRow(page)).toHaveCount(0);
    await expect(quickFilter(page)).toHaveText("可能重複客戶（1）");
    expect(await reviewCalls(page, "resolve")).toEqual([
      { id: "7c000000-0000-4000-8000-00000000c001", action: "link_b", note: "已致電核對" },
    ]);
    expect(await fits(page)).toBe(true);
    expect(errors).toEqual([]);
  });
}

async function twoTabs(browser: Browser) {
  const context = await browser.newContext();
  const a = await context.newPage();
  const b = await context.newPage();
  await openLeads(a, "manager", "?review=identity");
  await openLeads(b, "manager", "?review=identity");
  return { context, a, b };
}

test("a second tab's resolve shows 此項目已由其他同事處理，請重新載入。", async ({ browser }) => {
  const { context, a, b } = await twoTabs(browser);
  await expect(conflictRow(a)).toHaveCount(1);
  await expect(conflictRow(b)).toHaveCount(1);
  await conflictRow(a).getByRole("button", { name: "建立新客戶" }).click();
  await a.getByRole("dialog").getByRole("button", { name: "確認", exact: true }).click();
  await expect(a.getByText("已處理。", { exact: true })).toBeVisible();

  await conflictRow(b).getByRole("button", { name: "連結到「合成乙」" }).click();
  const dialog = b.getByRole("dialog", { name: "確認處理？" });
  await dialog.getByRole("button", { name: "確認", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(new RegExp(ALREADY));
  for (const [width, height] of [
    [375, 812],
    [1440, 900],
  ]) {
    await b.setViewportSize({ width, height });
    await settle(b);
    await b.screenshot({
      path: `.audit/remediation-20261003/fx12-identity-review-already-resolved-${width}.png`,
    });
  }
  await dialog.getByRole("button", { name: "重新載入", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(conflictRow(b)).toHaveCount(0);
  await context.close();
});

test("two unnamed sides: each link and the confirm dialog name the side and the masked digits", async ({
  page,
}) => {
  await page.addInitScript(() => sessionStorage.setItem("identity-review-unnamed", "true"));
  const errors = await openLeads(page, "manager", "?review=identity");
  const row = page.locator('[data-review-id="7c000000-0000-4000-8000-00000000c003"]');
  await expect(row.getByRole("button", { name: /客戶 A · •••• 0201/ })).toBeVisible();
  await row.getByRole("button", { name: /客戶 B · •••• 0202/ }).click();
  const dialog = page.getByRole("dialog", { name: "確認處理？" });
  await expect(dialog).toContainText("連結到「未命名客戶」");
  await expect(dialog).toContainText("客戶 B");
  await expect(dialog).toContainText("•••• 0202");
  await expect(dialog).not.toContainText("•••• 0201");
  await dialog.getByRole("button", { name: "確認", exact: true }).click();
  await expect(page.getByText("已處理。", { exact: true })).toBeVisible();
  expect(await reviewCalls(page, "resolve")).toEqual([
    { id: "7c000000-0000-4000-8000-00000000c003", action: "link_b", note: null },
  ]);
  for (const [width, height] of [
    [375, 812],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await settle(page);
    await page.screenshot({
      path: `.audit/remediation-20261003/fx12-identity-review-unnamed-sides-${width}.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});

test("an agent sees no 可能重複客戶 button", async ({ page }) => {
  const errors = await openLeads(page, "agent", "?review=identity");
  await expect(page.getByRole("button", { name: "新查詢", exact: true })).toBeVisible();
  await expect(quickFilter(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "可能重複客戶" })).toHaveCount(0);
  expect(await reviewCalls(page, "list")).toEqual([]);
  expect(errors).toEqual([]);
});

// The inbox side: the actual WhatsApp route on the no-link fixture, with 甲 under 身分待核對.
test.describe("inbox", () => {
  let inbox: Server, inboxOrigin: string;
  test.beforeAll(async () => {
    assert.equal(
      spawnSync(
        process.execPath,
        ["scripts/browser-fixtures/build-whatsapp-no-link.mjs", "mobile-ai"],
        { stdio: "inherit" },
      ).status,
      0,
    );
    const root = resolve(".audit/no-link-browser-mobile-ai");
    inbox = createServer(async (request, response) => {
      try {
        const path = new URL(request.url!, "http://127.0.0.1").pathname;
        const target = path.startsWith("/assets/")
          ? resolve(root, `.${decodeURIComponent(path)}`)
          : resolve(root, "index.html");
        assert.ok(target.startsWith(root + sep));
        response.setHeader(
          "Content-Type",
          (
            {
              ".js": "text/javascript",
              ".css": "text/css",
              ".html": "text/html",
              ".woff2": "font/woff2",
            } as Record<string, string>
          )[extname(target)] ?? "application/octet-stream",
        );
        response.end(await readFile(target));
      } catch {
        response.writeHead(404).end();
      }
    });
    await new Promise<void>((done) => inbox.listen(0, "127.0.0.1", done));
    inboxOrigin = `http://127.0.0.1:${(inbox.address() as { port: number }).port}`;
  });
  test.afterAll(async () => {
    if (inbox) await new Promise<void>((done) => inbox.close(() => done()));
  });
  const CONVERSATION = "10000000-0000-4000-8000-000000000001";
  async function openInbox(page: Page, actor: "manager" | "agent-a") {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === inboxOrigin &&
      ["GET", "HEAD"].includes(route.request().method())
        ? route.continue()
        : route.abort(),
    );
    await page.addInitScript((actor) => {
      sessionStorage.setItem("no-link-fixture-actor", actor);
      sessionStorage.setItem("no-link-fixture-identity-review", "true");
    }, actor);
    await page.goto(`${inboxOrigin}/admin/whatsapp?conversation=${CONVERSATION}`);
    return errors;
  }
  const alert = (page: Page) =>
    page
      .getByRole("alert")
      .filter({ hasText: "此對話身分待核對：訊息已保存，但未連結客戶，暫時不能回覆。" })
      .filter({ visible: true });

  for (const [width, height] of [
    [1440, 900],
    [375, 812],
  ] as const) {
    test(`a manager sees 身分待核對, the reason, no composer and 前往核對 (${width})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      const errors = await openInbox(page, "manager");
      await expect(alert(page)).toBeVisible();
      const link = alert(page).getByRole("link", { name: "前往核對", exact: true });
      await expect(link).toHaveAttribute(
        "href",
        "/admin/leads?review=identity&item=7c000000-0000-4000-8000-00000000c001",
      );
      await expect(
        page.getByText("此對話身分待核對，請先確認客戶身分再回覆。").filter({ visible: true }),
      ).toBeVisible();
      await expect(page.getByLabel("WhatsApp 回覆")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "傳送回覆" })).toHaveCount(0);
      if (width >= 1024)
        await expect(
          page
            .getByRole("button")
            .filter({ hasText: "合成客戶甲" })
            .getByText("身分待核對", { exact: true }),
        ).toBeVisible();
      expect(await fits(page)).toBe(true);
      await settle(page);
      await page.screenshot({
        path: `.audit/remediation-20261003/fx12-inbox-identity-review-${width}.png`,
      });
      expect(errors).toEqual([]);
    });
  }

  test("the assigned agent sees the badge and alert but no 前往核對 and no composer", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors = await openInbox(page, "agent-a");
    await expect(alert(page)).toBeVisible();
    await expect(page.getByRole("link", { name: "前往核對" })).toHaveCount(0);
    await expect(page.getByLabel("WhatsApp 回覆")).toHaveCount(0);
    await expect(
      page
        .getByRole("button")
        .filter({ hasText: "合成客戶甲" })
        .getByText("身分待核對", { exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});
