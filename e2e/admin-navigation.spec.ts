import { test, expect } from "@playwright/test";
import { useAdminLayoutFixture } from "./admin-layout-fixture";

const fixture = useAdminLayoutFixture("navigation");

test("NAV-01 desktop collapse persists only the preference and keeps named links and attention", async ({
  page,
}) => {
  await fixture.open(page);
  const sidebar = page.locator("aside:visible");
  expect((await sidebar.boundingBox())!.width).toBe(256);
  await page.getByRole("button", { name: "收合後台選單", exact: true }).click();
  expect((await sidebar.boundingBox())!.width).toBe(72);
  await expect(page.getByRole("button", { name: "展開後台選單", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  const leads = sidebar.getByRole("link", { name: "客戶查詢", exact: true });
  await leads.focus();
  await expect(page.getByRole("tooltip")).toContainText("客戶查詢");
  await expect(leads.locator("[data-attention-badge]")).toBeVisible();
  await leads.press("Enter");
  await expect(page).toHaveURL(/\/admin\/leads$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("客戶查詢");
  await page.reload();
  await expect(page.getByRole("button", { name: "展開後台選單", exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("earnest:admin-nav-collapsed"))).toBe(
    "true",
  );
  await page.getByRole("button", { name: "展開後台選單", exact: true }).click();
  expect((await sidebar.boundingBox())!.width).toBe(256);
});

test("NAV-02/03 role-filtered groups retain seventeen, six and one destinations", async ({
  page,
}) => {
  await fixture.open(page);
  const nav = page.locator("aside").getByRole("navigation", { name: "後台選單", exact: true });
  await expect(nav.getByRole("link")).toHaveCount(17);
  await expect(nav.locator("[data-admin-nav-group-label]")).toHaveText([
    "日常工作",
    "管理與推廣",
    "設定與處理問題",
  ]);
  await page.evaluate(() => window.dailyWorkFixture.changeContext("actor-a", "agent"));
  await expect(nav.getByRole("link")).toHaveCount(6);
  expect(
    await nav
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
  ).toEqual([
    "/admin",
    "/admin/leads",
    "/admin/whatsapp",
    "/admin/listings",
    "/admin/transactions",
    "/admin/operations",
  ]);
  await page.evaluate(() => window.dailyWorkFixture.changeContext("actor-a", "viewer"));
  await expect(nav.getByRole("link")).toHaveCount(1);
  await expect(nav.getByRole("link", { name: "系統營運" })).toBeVisible();
});

test("NAV-04 query does not clear the active destination and browser history retains it", async ({
  page,
}) => {
  await fixture.open(page, { path: "/admin/leads?stage=open" });
  const nav = page.locator("aside").getByRole("navigation");
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute("href", "/admin/leads");
  await nav.getByRole("link", { name: "總覽", exact: true }).click();
  await page.goBack();
  await expect(page).toHaveURL(/stage=open/);
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute("href", "/admin/leads");
});

for (const width of [390, 768]) {
  test(`NAV-06 mobile drawer traps focus, closes on Escape and navigation (${width})`, async ({
    page,
  }) => {
    await fixture.open(page, { width });
    const trigger = page.getByRole("button", { name: "開啟後台選單", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "後台選單", exact: true });
    await expect(dialog).toBeVisible();
    for (let index = 0; index < 24; index++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await dialog.getByRole("link", { name: "客戶查詢", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("客戶查詢");
    await expect(page.getByRole("button", { name: "收合後台選單", exact: true })).not.toBeVisible();
  });
}

test("NAV-07 denied storage still allows collapse and expansion", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await fixture.open(page, { storageFailure: true });
  await page.getByRole("button", { name: "收合後台選單", exact: true }).click();
  await page.getByRole("button", { name: "展開後台選單", exact: true }).click();
  expect(errors).toEqual([]);
});

test("NAV-08 a short screen keeps account and sign-out reachable while the menu scrolls", async ({
  page,
}) => {
  await fixture.open(page, { height: 600 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const sidebar = page.locator("aside");
  await sidebar.getByRole("link", { name: "系統營運", exact: true }).scrollIntoViewIfNeeded();
  const signOut = sidebar.getByRole("button", { name: "登出", exact: true });
  const box = await signOut.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(600);
  await signOut.click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("總覽");
});

test("agent daily page offers no manager-only command-center shortcut", async ({ page }) => {
  await fixture.open(page, { role: "agent", path: "/admin/leads" });
  await expect(page.locator('a[href="/admin/leads/command-center"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "記錄人工轉交" })).toBeVisible();
});
