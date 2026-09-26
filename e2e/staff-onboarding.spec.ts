import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const fixturePath = process.env.STAFF_ONBOARDING_BROWSER_FIXTURE;
const fixture = fixturePath ? JSON.parse(readFileSync(fixturePath, "utf8")) : null;
test.describe("synthetic staff onboarding on authenticated staging", () => {
  test.skip(
    !fixture || !process.env.PLAYWRIGHT_BASE_URL,
    "BLOCKED: isolated staging URL and onboarding fixture unavailable",
  );

  test("sign-in has a compact staff shell and no public marketing footer", async ({ page }) => {
    await page.goto("/auth/sign-in");
    await expect(page.getByText("職員登入 · 只供已授權團隊使用")).toBeVisible();
    await expect(page.locator("footer")).toHaveCount(0);
  });

  test("unverified account cannot be linked, viewer cannot change roles", async ({ browser }) => {
    const admin = await browser.newContext({ storageState: fixture.adminState });
    const viewer = await browser.newContext({ storageState: fixture.viewerState });
    try {
      const adminPage = await admin.newPage();
      await adminPage.goto(`/admin/team?member=${fixture.unverifiedStaffId}`);
      await expect(adminPage.getByText("電郵尚未驗證")).toBeVisible();
      await expect(adminPage.getByRole("button", { name: "連結帳戶" })).toHaveCount(0);
      await expect(adminPage.getByRole("button", { name: "複製職員註冊連結" })).toBeVisible();
      const viewerPage = await viewer.newPage();
      await viewerPage.goto("/admin/team");
      await expect(viewerPage.getByRole("button", { name: "變更角色" })).toHaveCount(0);
    } finally {
      await admin.close();
      await viewer.close();
    }
  });
});
