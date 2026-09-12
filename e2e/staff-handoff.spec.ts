import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
// Operator-prepared synthetic staging fixtures only; no provider calls or auth bypass.
const fixturePath = process.env.STAFF_HANDOFF_BROWSER_FIXTURE;
const f = fixturePath ? JSON.parse(readFileSync(fixturePath, "utf8")) : null;
test.describe("staff handoff actual authenticated application", () => {
  test.skip(
    !f,
    "BLOCKED: approved synthetic fixture and A/B/manager/viewer storageState unavailable",
  );
  test.describe.configure({ mode: "serial" });
  test("Journey A / NT-01/13/14/15: intended recipient acknowledges, B has no action", async ({
    browser,
  }) => {
    const a = await browser.newContext({ storageState: f.agentAState }),
      b = await browser.newContext({ storageState: f.agentBState });
    try {
      const page = await a.newPage();
      await page.goto(f.url);
      const card = page.locator(`[data-notification-id="${f.firstNotificationId}"]`);
      await expect(card).toContainText(f.requestedName);
      await expect(card).toContainText("仍待人手回覆");
      await expect(card.getByRole("button", { name: "確認接手", exact: true })).toBeVisible();
      const other = await b.newPage();
      await other.goto(f.url);
      await expect(other.getByRole("heading", { name: "我的接手工作" })).toBeVisible();
      await expect(other.locator(`[data-notification-id="${f.firstNotificationId}"]`)).toHaveCount(
        0,
      );
      await page.request.get(f.url);
      await page.request.head(f.url);
      await page.reload();
      await expect(card.getByRole("button", { name: "確認接手", exact: true })).toBeVisible();
      await card.getByRole("button", { name: "確認接手", exact: true }).click();
      await page.getByLabel("接手工作狀態").selectOption("all");
      await expect(card).toContainText("已確認接手");
      await expect(card).toContainText("仍待人手回覆");
    } finally {
      await a.close();
      await b.close();
    }
  });
  test("Journey B / NT-07: same-thread second enquiry remains independent after refresh", async ({
    browser,
  }) => {
    const c = await browser.newContext({ storageState: f.agentAState });
    try {
      const p = await c.newPage();
      await p.goto(f.url);
      const e2 = p.locator(`[data-notification-id="${f.secondNotificationId}"]`);
      await expect(e2.getByRole("button", { name: "確認接手", exact: true })).toBeVisible();
      await p.getByRole("button", { name: "更新接手工作" }).click();
      await expect(e2).toBeVisible();
      await e2.getByRole("button", { name: "確認接手", exact: true }).click();
      await p.getByLabel("接手工作狀態").selectOption("all");
      await expect(e2).toContainText("已確認接手");
      await expect(p.locator(`[data-notification-id="${f.firstNotificationId}"]`)).toContainText(
        "已確認接手",
      );
    } finally {
      await c.close();
    }
  });
  test("Journey C / NT-12/14: previously superseded work has no acceptance", async ({
    browser,
  }) => {
    const c = await browser.newContext({ storageState: f.agentAState });
    try {
      const p = await c.newPage();
      await p.goto(f.staleUrl);
      await p.getByLabel("接手工作狀態").selectOption("all");
      const stale = p.locator(`[data-notification-id="${f.staleNotificationId}"]`);
      await expect(stale).toContainText("已轉交");
      await expect(stale.getByRole("button", { name: "確認接手", exact: true })).toHaveCount(0);
    } finally {
      await c.close();
    }
  });
  test("Journey D / NT-13/21: anonymous and viewer deep links do not expose work", async ({
    browser,
  }) => {
    for (const state of [undefined, f.viewerState]) {
      const c = await browser.newContext(state ? { storageState: state } : {});
      try {
        const p = await c.newPage();
        await p.goto(f.url);
        await expect(p.locator(`[data-notification-id="${f.firstNotificationId}"]`)).toHaveCount(0);
        await expect(p.getByRole("button", { name: "確認接手", exact: true })).toHaveCount(0);
      } finally {
        await c.close();
      }
    }
  });
});
