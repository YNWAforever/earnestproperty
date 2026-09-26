import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// Fixture points to an isolated synthetic staging DB and an admin storageState.
// It must never contain a production account or request a provider send.
const fixturePath = process.env.WHATSAPP_LINK_BROWSER_FIXTURE;
const fixture = fixturePath ? JSON.parse(readFileSync(fixturePath, "utf8")) : null;
test.describe("WhatsApp link bulk on authenticated staging", () => {
  test.skip(
    !fixture || !process.env.PLAYWRIGHT_BASE_URL,
    "BLOCKED: isolated staging URL and browser fixture unavailable",
  );
  test("60 active offers preview and commit as 50 plus 10, then reload durable result", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: fixture.adminState });
    try {
      await context.addInitScript((offers) => {
        sessionStorage.setItem(
          "earnest:whatsapp-link-seed:v1",
          JSON.stringify({ offers, scope: "synthetic staging" }),
        );
      }, fixture.offers);
      const page = await context.newPage();
      await page.goto("/admin/whatsapp-links");
      await expect(page.getByRole("heading", { name: "建立 WhatsApp 連結" })).toBeVisible();
      await expect(page.getByText("已選 60 筆租售")).toBeVisible();
      await page.getByRole("button", { name: "下一步：來源" }).click();
      await page.getByLabel("已人工核對刊登位置").check();
      await page.getByRole("button", { name: "下一步：跟進" }).click();
      await page.getByRole("button", { name: "預覽核對" }).click();
      await expect(page.getByText(/預計建立 \d+ · 重用 \d+ · 阻止 0/)).toBeVisible();
      await page.getByRole("button", { name: "確認建立 60 筆" }).click();
      await expect(page.getByText("已處理 2/2 批")).toBeVisible();
      await page.reload();
      await expect(page.getByText("已處理 2/2 批")).toBeVisible();
      await page.getByRole("button", { name: "查回伺服器結果" }).click();
      await expect(page.getByText("已處理 2/2 批")).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
