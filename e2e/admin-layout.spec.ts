import { test, expect, type Page } from "@playwright/test";
import { useAdminLayoutFixture } from "./admin-layout-fixture";
import { routeCases } from "../scripts/browser-fixtures/admin-layout/route-cases";
const fixture = useAdminLayoutFixture("layout");
const viewports = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];
export async function expectGeometry(page: Page, width: number, variant = "standard") {
  const content = page.locator("[data-admin-content]");
  await expect(content).toBeVisible();
  const bounds = await content.boundingBox();
  expect(bounds).not.toBeNull();
  const gutter = width < 768 ? 16 : width < 1280 ? 24 : 32;
  const rail = width >= 1024 ? 256 : 0;
  expect(Math.abs(bounds!.x - rail - gutter)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      bounds!.width -
        Math.min(
          width - rail - gutter * 2,
          variant === "form" ? 896 : variant === "wide" ? Infinity : 1440,
        ),
    ),
  ).toBeLessThanOrEqual(1);
  for (const selector of ["[data-admin-header]", "[data-admin-body]", "[data-admin-toolbar]"]) {
    for (const el of await page.locator(selector).all()) {
      const box = await el.boundingBox();
      if (!box) continue;
      expect(Math.abs(box.x - bounds!.x), selector + " left").toBeLessThanOrEqual(1);
      expect(Math.abs(box.width - bounds!.width), selector + " width").toBeLessThanOrEqual(1);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await expect(page.getByRole("main")).toHaveCount(1);
}
for (const viewport of viewports)
  for (const item of routeCases) {
    const path = item.path;
    test(`normal ${path} ${viewport.width}`, async ({ page }) => {
      await fixture.open(page, { path, ...viewport });
      await expectGeometry(page, viewport.width, item.variant);
      if (item.route.endsWith("/new") || item.route.includes(":id")) {
        await expect(page.getByRole("navigation", { name: "麵包屑" })).toContainText("後台");
        await expect(page.locator("[data-admin-body] form").first()).toBeVisible();
      }
    });
  }
for (const width of [390, 768])
  test(`long title and wrapped actions ${width}`, async ({ page }) => {
    await fixture.open(page, { path: "/__layout-probe", width });
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    const title = page.getByRole("heading", { level: 1 });
    expect(
      await title.evaluate(
        (el) =>
          el.scrollWidth <= el.clientWidth + 1 && getComputedStyle(el).textOverflow !== "ellipsis",
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "第3個主要工作操作" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-clicked", "3");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  });
test("skip link reaches the focusable page content", async ({ page }) => {
  await fixture.open(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "跳至後台內容" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#admin-content")).toBeFocused();
});

for (const [path, label] of [
  ["/admin/agents/new", "中文名稱"],
  ["/admin/estates/new", "中文名"],
  ["/admin/transactions/new", "成交金額"],
])
  test(`editor draft survives collapse and cancelled breadcrumb ${path}`, async ({ page }) => {
    await fixture.open(page, { path });
    const input = path.includes("transactions")
      ? page.locator('input[name="price"]')
      : page.getByLabel(label, { exact: true });
    await input.fill(path.includes("transactions") ? "8800000" : "未儲存測試內容");
    const draft = await input.inputValue();
    await page.getByRole("button", { name: "收合後台選單" }).click();
    await expect(input).toHaveValue(draft);
    await page
      .getByRole("navigation", { name: "麵包屑" })
      .getByRole("link", { name: "後台", exact: true })
      .click();
    const prompt = page.getByRole("alertdialog", { name: "尚未儲存" });
    await expect(prompt).toBeVisible();
    await prompt.getByRole("button", { name: "取消", exact: true }).click();
    await expect(input).toHaveValue(draft);
  });
