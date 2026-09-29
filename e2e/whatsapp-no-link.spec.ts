import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const path = process.env.NO_LINK_BROWSER_FIXTURE;
const fixture = path ? JSON.parse(readFileSync(path, "utf8")) : null;
test.describe("isolated authenticated no-link inbox", () => {
  test.skip(
    !fixture,
    "BLOCKED_EXTERNAL: synthetic app, staff states and 30-message fixture unavailable",
  );
  test("agent navigation, search, query detail and forbidden other-thread deep link", async ({
    browser,
  }) => {
    const a = await browser.newContext({ storageState: fixture.agentAState });
    const b = await browser.newContext({ storageState: fixture.agentBState });
    try {
      const page = await a.newPage();
      await page.goto(fixture.conversationUrl);
      await expect(page.getByRole("link", { name: "WhatsApp 收件匣" })).toBeVisible();
      await page.getByLabel("搜尋 WhatsApp 對話").fill(fixture.externalListingId);
      await expect(page.getByText(fixture.publicListingNo).first()).toBeVisible();
      const other = await b.newPage();
      await other.goto(fixture.otherConversationUrl);
      await expect(other.getByText(fixture.privateMessageText)).toHaveCount(0);
      await expect(other.getByLabel("WhatsApp 回覆")).toHaveCount(0);
    } finally {
      await a.close();
      await b.close();
    }
  });
  test("390px thirty-message pane keeps composer reachable and drafts distinct", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: fixture.agentAState,
      viewport: { width: 390, height: 844 },
    });
    try {
      const page = await context.newPage();
      await page.goto(fixture.conversationUrl);
      await expect(page.getByText(fixture.messageTexts.at(-1))).toBeVisible();
      const input = page.getByLabel("WhatsApp 回覆");
      await expect(input).toBeVisible();
      await input.fill("合成草稿");
      await input.press("Enter");
      await expect(input).toHaveValue("合成草稿\n");
      await expect(page.getByRole("button", { name: "傳送回覆" })).toBeVisible();
      await expect(page.getByRole("button", { name: "傳送回覆" })).toBeInViewport();
      await page.reload();
      await expect(input).toHaveValue("合成草稿\n");
    } finally {
      await context.close();
    }
  });
});
