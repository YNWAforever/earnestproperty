import { test, expect } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`chat keyboard focus, Escape and draft recovery at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/live-agent/**", (route) => route.abort());
    const response = await page.goto("/mortgage");
    expect(response?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    const trigger = page.getByRole("button", { name: "問樓助手", exact: true });
    await expect(trigger).toBeEnabled();
    await trigger.focus();
    await trigger.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Earnest 問樓助手" });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
    await dialog.getByRole("textbox", { name: "即時客服訊息" }).fill("未傳送的草稿");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    await expect(dialog.getByRole("textbox", { name: "即時客服訊息" })).toHaveValue("未傳送的草稿");
    await expect(dialog).not.toHaveAttribute("aria-modal", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
