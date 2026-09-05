import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Acceptance is read-only even if a form regression attempts to submit.
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) return route.abort();
    return route.continue();
  });
});
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
for (const width of [390, 1440]) {
  for (const path of ["/mortgage", "/contact", "/listings"]) {
    test(`public accessibility and overflow ${path} ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await page.waitForLoadState("networkidle");
      await noOverflow(page);
      const audit = await new AxeBuilder({ page }).exclude("iframe").analyze();
      expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([]);
    });
  }
}
test("mobile navigation opens with keyboard and Escape restores its trigger", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/mortgage");
  await page.waitForLoadState("networkidle");
  const trigger = page.getByRole("button", { name: "開啟主選單" });
  await trigger.focus();
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name: "主選單" });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Tab");
  await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
test("contact empty submit remains invalid without an application write", async ({ page }) => {
  await page.goto("/contact");
  await page.waitForLoadState("networkidle");
  const name = page.locator("#contact-name");
  await expect(name).toBeVisible();
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).origin === new URL(page.url()).origin)
      writes++;
  });
  await page.getByRole("button", { name: "提交查詢", exact: true }).click();
  await expect(name).toBeFocused();
  expect(await name.evaluate((element: HTMLInputElement) => element.validity.valueMissing)).toBe(
    true,
  );
  expect(writes).toBe(0);
});
test("valuation consent and required fields prevent empty submission", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const name = page.locator("#valuation-name");
  await expect(name).toBeVisible();
  const form = name.locator("xpath=ancestor::form");
  await expect(form.getByRole("button", { name: /估價/ })).toBeDisabled();
  await page.locator("#valuation-consent").click();
  await expect(page.locator("#valuation-consent")).toBeChecked();
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).origin === new URL(page.url()).origin)
      writes++;
  });
  await form.locator('button[type="submit"]').click();
  await expect(name).toBeFocused();
  expect(await name.evaluate((element: HTMLInputElement) => element.validity.valueMissing)).toBe(
    true,
  );
  expect(writes).toBe(0);
});
test("listing filters persist through pagination/back and can be saved locally", async ({
  page,
}) => {
  await page.goto("/listings?deal=sale&page=1");
  await page.waitForLoadState("networkidle");
  const cards = page.locator('a[href^="/property/"]');
  test.skip(
    (await cards.count()) === 0,
    "Disposable fixture has no sale listing cards; paging/search acceptance requires records.",
  );
  const min = page.getByRole("spinbutton", { name: /最低/ });
  await expect(min).toBeVisible();
  await min.fill("1");
  await min.press("Tab");
  await page.getByRole("button", { name: "套用篩選", exact: true }).click();
  await expect(page).toHaveURL(/minPrice=1|min=1|min_price=1/);
  await expect(page.getByRole("button", { name: "儲存呢個搜尋", exact: true })).toBeVisible();
  const filteredUrl = page.url();
  await page.getByRole("button", { name: "儲存呢個搜尋", exact: true }).click();
  await page.getByRole("button", { name: /^已儲存搜尋/ }).click();
  await expect(page.getByRole("heading", { name: "已儲存搜尋" })).toBeVisible();
  await page.keyboard.press("Escape");
  const next = page.getByRole("link", { name: "下一頁", exact: true });
  test.skip(
    (await next.count()) === 0,
    "Disposable fixture lacks a second filtered result page; saved search was exercised.",
  );
  await next.click();
  await expect(page).toHaveURL(/page=2/);
  await page.goBack();
  await expect(page).toHaveURL(filteredUrl);
  await expect(min).toHaveValue("1");
});
test("discovered property gallery advances when fixture has multiple images", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/listings");
  await page.waitForLoadState("networkidle");
  const links = await page
    .locator('a[href^="/property/"]')
    .evaluateAll((nodes) =>
      [...new Set(nodes.map((node) => node.getAttribute("href")!))].slice(0, 8),
    );
  test.skip(links.length === 0, "Disposable fixture has no property detail link.");
  let found = false;
  for (const href of links) {
    await page.goto(href);
    await page.waitForLoadState("networkidle");
    if (await page.getByRole("button", { name: "下一張相片", exact: true }).count()) {
      found = true;
      break;
    }
  }
  test.skip(!found, "First eight discovered properties have fewer than two gallery images.");
  const next = page.getByRole("button", { name: "下一張相片", exact: true });
  const gallery = page.getByRole("group", { name: /相片 .*可用左右方向鍵切換/ });
  const before = await gallery.getAttribute("aria-label");
  await next.focus();
  await next.press("Enter");
  await expect(gallery).not.toHaveAttribute("aria-label", before!);
  await gallery.focus();
  await gallery.press("ArrowLeft");
  await expect(gallery).toHaveAttribute("aria-label", before!);
  await noOverflow(page);
});
