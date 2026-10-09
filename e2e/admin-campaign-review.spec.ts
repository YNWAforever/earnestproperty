import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Locator, type Page } from "@playwright/test";
declare global {
  interface Window {
    noLinkBlastFixture: {
      queueMode: string;
      readFailure: boolean;
      releaseQueue: null | (() => void);
      cancelMode: string;
      releaseCancel: null | (() => void);
      retryMode: "ok" | "refused" | "previewFailure" | "lost" | "forbidden";
      retryRefusal: string;
      audienceEligible: number;
    };
    campaignReviewFixture: {
      changeActor: (id: string) => Promise<void>;
      changeMembership: (role?: string, binding?: string) => Promise<void>;
    };
  }
}
let server: Server, origin: string;
const results: { name: string; status: string; width: number }[] = [];
test.beforeAll(async () => {
  assert.ok(!process.env.PLAYWRIGHT_BASE_URL);
  assert.equal(
    spawnSync(process.execPath, ["scripts/browser-fixtures/build-admin-campaign-review.mjs"], {
      stdio: "inherit",
    }).status,
    0,
  );
  const root = resolve(".audit/campaign-review-browser");
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
  await writeFile(
    ".audit/remediation-20261003/ep13-20-ci-compat-campaign-browser-summary.json",
    JSON.stringify(
      {
        codeSha: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
        evidenceLayer: "actual-campaign-route-shell-staff-store-synthetic-auth-api-owned-loopback",
        realAuth: false,
        realDatabase: false,
        realProvider: false,
        results,
      },
      null,
      2,
    ),
  );
});
test.afterEach(async ({ page }, info) => {
  const fits =
    info.status !== "passed" ||
    (await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  results.push({
    name: info.title,
    status: fits ? (info.status ?? "unknown") : "failed",
    width: page.viewportSize()!.width,
  });
  if (!fits) {
    console.log(
      "Campaign overflow",
      await page.evaluate(() => ({
        width: innerWidth,
        pageWidth: document.documentElement.scrollWidth,
        elements: [
          ...document.querySelectorAll("main, main > *, main table, main [class*=overflow-x]"),
        ].map((el) => ({
          tag: el.tagName,
          class: el.className,
          right: el.getBoundingClientRect().right,
          width: el.getBoundingClientRect().width,
        })),
      })),
    );
    await page.screenshot({
      path: `.audit/remediation-20261003/ep13-20-campaign-overflow-${page.viewportSize()!.width}.png`,
    });
  }
  expect(fits).toBe(true);
  if (info.status === "passed" && info.title.startsWith("lost queue response")) {
    await page.screenshot({
      path: `.audit/remediation-20261003/ep13-20-ci-compat-campaign-cancel-green-${page.viewportSize()!.width}.png`,
    });
  }
});
const row = (page: Page) => page.getByRole("row").filter({ hasText: "合成租務推廣" });
const recovery = (page: Page) =>
  page.getByRole("alert").filter({ hasText: "加入佇列結果未能確認" });
async function open(page: Page) {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin &&
    ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort(),
  );
  await page.addInitScript(() => sessionStorage.setItem("no-link-fixture-actor", "manager"));
  await page.goto(origin + "/admin/blasts");
  await expect(row(page)).toBeVisible();
}
async function confirm(page: Page) {
  await row(page).getByRole("button", { name: "預覽收件人", exact: true }).click();
  await row(page).getByRole("button", { name: "發送…", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "確認發送 WhatsApp 群發？" });
  await dialog.getByRole("checkbox").check();
  return dialog;
}
const queueCalls = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { noLinkFixture: { calls: { name: string; input?: unknown }[] } }
    ).noLinkFixture.calls.filter((c) => c.name === "syntheticCampaignQueue"),
  );
const cancelCalls = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { noLinkFixture: { calls: { name: string; input?: unknown }[] } }
    ).noLinkFixture.calls.filter((c) => c.name === "syntheticCampaignCancel"),
  );
const cancelRecovery = (page: Page) =>
  page.getByRole("alert").filter({ hasText: "取消結果待核對" });
const cancelJournal = (page: Page) =>
  page.evaluate(() =>
    Object.entries(sessionStorage).filter(([k]) => k.startsWith("earnest-campaign-cancel:")),
  );
async function openCancel(page: Page) {
  await row(page).getByRole("button", { name: "取消 Campaign", exact: true }).click();
  return page.getByRole("alertdialog", { name: "取消整個 Campaign？" });
}
const fixtureCalls = (page: Page, name: string) =>
  page.evaluate(
    (name) =>
      (
        window as unknown as { noLinkFixture: { calls: { name: string; input?: unknown }[] } }
      ).noLinkFixture.calls.filter((c) => c.name === name),
    name,
  );
const savedCampaign = (page: Page) =>
  page.evaluate(() => JSON.parse(sessionStorage.getItem("no-link-fixture-campaigns")!)[0]);
/** Seeds the synthetic campaign row once per tab, before the route reads it. */
async function seedCampaign(page: Page, fields: Record<string, unknown>) {
  await page.addInitScript((fields) => {
    if (sessionStorage.getItem("no-link-fixture-campaigns")) return;
    sessionStorage.setItem(
      "no-link-fixture-campaigns",
      JSON.stringify([
        {
          id: "60000000-0000-4000-8000-000000000001",
          name: "合成租務推廣",
          template_id: "60000000-0000-4000-8000-000000000002",
          audience_id: "60000000-0000-4000-8000-000000000003",
          status: "review",
          scheduled_at: null,
          element_name: "synthetic_rental",
          language_code: "zh_HK",
          audience_name: "合成群組",
          recipients: 0,
          sent: 0,
          failed: 0,
          blocked: 0,
          pending: 0,
          unknown: 0,
          dispatching: 0,
          cancelled: 0,
          retryable_failed: 0,
          paused: 0,
          delivery_started: false,
          queueWrites: 0,
          cancelWrites: 0,
          requeueWrites: 0,
          ...fields,
        },
      ]),
    );
  }, fields);
}
/** The value cell of one ConfirmRow, matched by its exact label. */
const confirmValue = (page: Page, dialog: Locator, label: string) =>
  dialog
    .locator("dl > div")
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator("dd");
const retryButton = (page: Page) => row(page).getByRole("button", { name: /^重新發送失敗收件人/ });
const retryDialog = (page: Page) => page.getByRole("alertdialog", { name: "重新發送失敗收件人？" });
/** FX-10b screenshots at 1440 and 375, taken once the target is in view and
 * every animation (dialog open, toast) has settled. */
async function evidence(page: Page, name: string, focus: Locator) {
  const width = page.viewportSize()!.width;
  if (width !== 1440 && width !== 375) return;
  await focus.scrollIntoViewIfNeeded();
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  await page.screenshot({ path: `.audit/remediation-20261003/fx10b-${name}-${width}.png` });
}
// Recipient builders for the fixture's FX-10b model. Every count the screen
// shows is derived by the fixture from these, with the server's rules.
const sentTo = () => ({ status: "sent", dispatched: true });
const refusedBy = (extra: Record<string, unknown> = {}) => ({
  status: "failed",
  error: "WOZTELL_PROVIDER_REJECTED",
  ...extra,
});
const unknownFor = (name: string | null) => ({
  status: "failed",
  error: "WOZTELL_DELIVERY_UNKNOWN",
  dispatched: true,
  name,
});
const pausedFor = () => ({ status: "queued", error: "WOZTELL_CAMPAIGN_PAUSED" });
/** Changes one seeded recipient in place, as a server-side change would. */
const patchRecipient = (page: Page, index: number, patch: Record<string, unknown>) =>
  page.evaluate(
    ({ index, patch }) => {
      const rows = JSON.parse(sessionStorage.getItem("no-link-fixture-campaigns")!);
      Object.assign(rows[0].synthetic_recipients[index], patch);
      sessionStorage.setItem("no-link-fixture-campaigns", JSON.stringify(rows));
    },
    { index, patch },
  );
const toast = (page: Page) => page.locator("[data-sonner-toast]");
/** Exactly one toast with this text (others, such as the preview's, may stack). */
const toastWith = (page: Page, text: string) => toast(page).filter({ hasText: text });
const finishButton = (page: Page) =>
  row(page).getByRole("button", { name: "結束 Campaign…", exact: true });
const finishDialog = (page: Page) =>
  page.getByRole("alertdialog", { name: "結束 Campaign（沒有尚待發送收件人）" });
/** A refused row that a requeue put back in the queue. */
const requeuedFor = (extra: Record<string, unknown> = {}) => ({
  status: "queued",
  attempted: true,
  ...extra,
});
function retryTests() {
  test("結束 Campaign… appears only when the server says nothing is left to send", async ({
    page,
  }) => {
    await seedCampaign(page, {
      status: "review",
      synthetic_recipients: [sentTo(), requeuedFor(), refusedBy()],
    });
    await open(page);
    // Still one sendable recipient: no finish, 發送… is the way forward.
    await expect(finishButton(page)).toHaveCount(0);
    // The waiting contact opts out; the server now counts nothing sendable.
    await patchRecipient(page, 1, { consent: false });
    await page.reload();
    await expect(finishButton(page)).toBeVisible();
    await finishButton(page).click();
    const dialog = finishDialog(page);
    await expect(dialog).toContainText("不會標示為「已取消」");
    await expect(confirmValue(page, dialog, "已發送")).toHaveText("1 人");
    await expect(confirmValue(page, dialog, "仍在等候（不會發送）")).toHaveText("1 人");
    await evidence(page, "finish-confirm", dialog);
    await dialog.getByRole("button", { name: "結束 Campaign", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(
      toastWith(page, "已結束 Campaign，狀態為「已完成」。未有發出任何訊息。"),
    ).toHaveCount(1);
    expect(await savedCampaign(page)).toMatchObject({ status: "completed", finishWrites: 1 });
    expect((await fixtureCalls(page, "syntheticCampaignFinish")).map((c) => c.input)).toEqual([
      { campaignId: "60000000-0000-4000-8000-000000000001" },
    ]);
    expect(await queueCalls(page)).toHaveLength(0);
    await expect(row(page).getByText("已完成", { exact: true })).toBeVisible();
    await expect(finishButton(page)).toHaveCount(0);
  });
  test("發送… with nothing left to send offers to finish instead of a dead end", async ({
    page,
  }) => {
    // The only waiting row has left the audience: the list cannot tell, the
    // server's send preview can.
    await seedCampaign(page, {
      status: "review",
      synthetic_recipients: [sentTo(), requeuedFor({ outOfAudience: true })],
    });
    await open(page);
    await expect(finishButton(page)).toHaveCount(0);
    await row(page).getByRole("button", { name: "預覽收件人", exact: true }).click();
    await row(page).getByRole("button", { name: "發送…", exact: true }).click();
    const dialog = finishDialog(page);
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("alertdialog", { name: "確認發送 WhatsApp 群發？" })).toHaveCount(
      0,
    );
    await dialog.getByRole("button", { name: "結束 Campaign", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(await savedCampaign(page)).toMatchObject({ status: "completed" });
    expect(await queueCalls(page)).toHaveLength(0);
  });
  test("a changed send count queues nothing and shows the server's number first", async ({
    page,
  }) => {
    await seedCampaign(page, {
      status: "review",
      synthetic_recipients: [sentTo(), requeuedFor(), requeuedFor()],
    });
    await open(page);
    const dialog = await confirm(page);
    await expect(confirmValue(page, dialog, "尚待發送收件人")).toHaveText("2 人");
    // Another change lands while the confirmation is open.
    await patchRecipient(page, 2, { consent: false });
    await dialog.getByRole("button", { name: "確認發送給 2 人", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("尚待發送人數已改變，未有加入發送佇列");
    await expect(confirmValue(page, dialog, "尚待發送收件人")).toHaveText("1 人");
    expect(await savedCampaign(page)).toMatchObject({ status: "review", queueWrites: 0 });
    await expect(recovery(page)).toHaveCount(0);
    await evidence(page, "send-count-changed", dialog);
    await dialog.getByRole("button", { name: "確認發送給 1 人", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(toastWith(page, "已加入發送佇列：1 位合資格收件人")).toHaveCount(1);
    expect(
      (await queueCalls(page)).map((c) => (c.input as { expectedCount: number }).expectedCount),
    ).toEqual([2, 1]);
  });
  test("retry shows the exact count, lists unknown recipients by name only, and re-queues once", async ({
    page,
  }) => {
    await seedCampaign(page, {
      status: "failed",
      synthetic_recipients: [
        sentTo(),
        sentTo(),
        sentTo(),
        refusedBy(),
        refusedBy(),
        unknownFor("合成未明客戶"),
      ],
    });
    await open(page);
    await expect(retryButton(page)).toHaveText("重新發送失敗收件人（2）");
    await retryButton(page).click();
    const dialog = retryDialog(page);
    await expect(confirmValue(page, dialog, "將重新排入")).toHaveText("2 人");
    await expect(confirmValue(page, dialog, "結果未明（請先核實，勿重發）")).toHaveText("1 人");
    await expect(dialog).toContainText("以下收件人結果未明，不會重新發送：");
    await expect(dialog.getByRole("listitem")).toHaveCount(1);
    await expect(dialog.getByRole("listitem")).toContainText("合成未明客戶");
    expect(await dialog.textContent()).not.toMatch(/\d{8,}/);
    await evidence(page, "retry-confirm", dialog);
    const confirmButton = dialog.getByRole("button", { name: "重新排入 2 人", exact: true });
    await expect(confirmButton).toBeEnabled();
    // Two clicks in the same task, before React can render the pending state.
    await confirmButton.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect(dialog).not.toBeVisible();
    const calls = await fixtureCalls(page, "syntheticCampaignRequeue");
    expect(calls).toHaveLength(1);
    // The server is told the count the user confirmed.
    expect(calls[0].input).toEqual({
      campaignId: "60000000-0000-4000-8000-000000000001",
      expectedCount: 2,
    });
    expect(await savedCampaign(page)).toMatchObject({ requeueWrites: 1, status: "review" });
    await expect(row(page).getByText("待審核", { exact: true })).toBeVisible();
    await expect(toastWith(page, "請預覽收件人後按「發送…」確認發送")).toHaveCount(1);
    // Re-queue sends nothing: approval still goes through 發送….
    expect(await queueCalls(page)).toHaveLength(0);
    await expect(retryButton(page)).toHaveCount(0);
  });
  test("paused campaign shows 已暫停 and needs 發送… again", async ({ page }) => {
    await seedCampaign(page, {
      status: "review",
      synthetic_recipients: [sentTo(), sentTo(), pausedFor(), pausedFor(), pausedFor()],
    });
    await open(page);
    await expect(row(page).getByText("已暫停", { exact: true })).toBeVisible();
    await expect(row(page)).toContainText("已暫停，未發送 3");
    await expect(row(page)).not.toContainText("待發送");
    await expect(retryButton(page)).toHaveCount(0);
    await evidence(page, "paused-row", row(page).getByText("已暫停", { exact: true }));
    // The audience grew since the first send; the re-send must not promise it.
    await page.evaluate(() => {
      window.noLinkBlastFixture.audienceEligible = 9;
    });
    const dialog = await confirm(page);
    await expect(confirmValue(page, dialog, "已發送（不會重發）")).toHaveText("2 人");
    await expect(confirmValue(page, dialog, "尚待發送收件人")).toHaveText("3 人");
    await expect(dialog).toContainText(
      "此 Campaign 曾經發送。這次只會發送給尚待發送的收件人，不會加入新符合條件的客戶。",
    );
    await evidence(
      page,
      "paused-send-confirm",
      dialog.getByText("此 Campaign 曾經發送", { exact: false }),
    );
    expect(await fixtureCalls(page, "syntheticCampaignSendPreview")).toHaveLength(1);
    await dialog.getByRole("button", { name: "確認發送給 3 人", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    // The toast is the server's queued count, not the audience's 9.
    await expect(toastWith(page, "已加入發送佇列：3 位合資格收件人")).toHaveCount(1);
    expect(await queueCalls(page)).toHaveLength(1);
  });
  test("retry preview failure blocks confirmation and sends no requeue", async ({ page }) => {
    await seedCampaign(page, {
      status: "failed",
      synthetic_recipients: [sentTo(), sentTo(), refusedBy(), refusedBy()],
    });
    await open(page);
    await page.evaluate(() => {
      window.noLinkBlastFixture.retryMode = "previewFailure";
    });
    await retryButton(page).click();
    const dialog = retryDialog(page);
    await expect(dialog.getByRole("alert")).toContainText("未能讀取重新發送資料，請稍後再試。");
    await expect(dialog.getByRole("button", { name: /^重新排入/ })).toBeDisabled();
    expect(await fixtureCalls(page, "syntheticCampaignRetryPreview")).toHaveLength(1);
    expect(await fixtureCalls(page, "syntheticCampaignRequeue")).toHaveLength(0);
  });
  test("the row label and the dialog show the same count, with each exclusion counted", async ({
    page,
  }) => {
    await seedCampaign(page, {
      status: "review",
      synthetic_recipients: [
        sentTo(),
        sentTo(),
        pausedFor(),
        pausedFor(),
        refusedBy(),
        refusedBy({ consent: false }),
        refusedBy({ duplicatePhone: true }),
        refusedBy({ contactChanged: true }),
      ],
    });
    await open(page);
    // Four refusals, one of which the re-queue would move: the label says 1.
    await expect(retryButton(page)).toHaveText("重新發送失敗收件人（1）");
    await retryButton(page).click();
    const dialog = retryDialog(page);
    await expect(confirmValue(page, dialog, "將重新排入")).toHaveText("1 人");
    await expect(confirmValue(page, dialog, "已在佇列（暫停時未發送）")).toHaveText("2 人");
    await expect(confirmValue(page, dialog, "按「發送…」確認後最多發送")).toHaveText("3 人");
    await expect(confirmValue(page, dialog, "已拒收或身份未核實（不會重發）")).toHaveText("1 人");
    await expect(confirmValue(page, dialog, "同一電話已有記錄（不會重發）")).toHaveText("1 人");
    await expect(confirmValue(page, dialog, "聯絡資料在上次發送後曾更改（不會重發）")).toHaveText(
      "1 人",
    );
    await expect(dialog.getByRole("listitem")).toHaveCount(0);
    expect(await dialog.textContent()).not.toMatch(/\d{8,}/);
    await evidence(page, "retry-exclusions", dialog);
    await dialog.getByRole("button", { name: "重新排入 1 人", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(toastWith(page, "已重新排入 1 人")).toHaveCount(1);
    expect(await queueCalls(page)).toHaveLength(0);
  });
  test("after a retry, 發送… sends exactly retryable + alreadyQueued and drops when consent lapses", async ({
    page,
  }) => {
    await seedCampaign(page, {
      status: "failed",
      synthetic_recipients: [sentTo(), pausedFor(), pausedFor(), refusedBy(), refusedBy()],
    });
    await open(page);
    await retryButton(page).click();
    const dialog = retryDialog(page);
    await expect(confirmValue(page, dialog, "將重新排入")).toHaveText("2 人");
    await expect(confirmValue(page, dialog, "按「發送…」確認後最多發送")).toHaveText("4 人");
    await dialog.getByRole("button", { name: "重新排入 2 人", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    let sending = await confirm(page);
    await expect(confirmValue(page, sending, "尚待發送收件人")).toHaveText("4 人");
    await expect(
      sending.getByRole("button", { name: "確認發送給 4 人", exact: true }),
    ).toBeVisible();
    await sending.getByRole("button", { name: "取消", exact: true }).click();
    // One queued contact's consent lapses before the approval.
    await patchRecipient(page, 1, { consent: false });
    sending = await confirm(page);
    await expect(confirmValue(page, sending, "尚待發送收件人")).toHaveText("3 人");
    await sending.getByRole("button", { name: "確認發送給 3 人", exact: true }).click();
    await expect(sending).not.toBeVisible();
    await expect(toastWith(page, "已加入發送佇列：3 位合資格收件人")).toHaveCount(1);
  });
  test("a changed count moves nothing and shows the new number before another confirmation", async ({
    page,
  }) => {
    await seedCampaign(page, {
      status: "failed",
      synthetic_recipients: [sentTo(), refusedBy(), refusedBy()],
    });
    await open(page);
    await retryButton(page).click();
    const dialog = retryDialog(page);
    await expect(confirmValue(page, dialog, "將重新排入")).toHaveText("2 人");
    // Another manager's change lands while the dialog is open.
    await patchRecipient(page, 2, { consent: false });
    await dialog.getByRole("button", { name: "重新排入 2 人", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "可重新發送的人數已改變，未有重新排入任何人",
    );
    await expect(confirmValue(page, dialog, "將重新排入")).toHaveText("1 人");
    expect(await savedCampaign(page)).toMatchObject({ status: "failed", requeueWrites: 0 });
    await evidence(page, "retry-count-changed", dialog);
    await dialog.getByRole("button", { name: "重新排入 1 人", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(toastWith(page, "已重新排入 1 人")).toHaveCount(1);
    const calls = await fixtureCalls(page, "syntheticCampaignRequeue");
    expect(calls.map((c) => (c.input as { expectedCount: number }).expectedCount)).toEqual([2, 1]);
  });
  test("refusals and a missing role are explained in the dialog and move nothing", async ({
    page,
  }) => {
    await seedCampaign(page, {
      status: "failed",
      synthetic_recipients: [sentTo(), sentTo(), refusedBy(), refusedBy()],
    });
    await open(page);
    await retryButton(page).click();
    const dialog = retryDialog(page);
    const confirmButton = dialog.getByRole("button", { name: "重新排入 2 人", exact: true });
    const cases = [
      ["refused", "CAMPAIGN_STILL_SENDING", "Campaign 仍在發送中"],
      ["refused", "NOTHING_TO_RETRY", "沒有可重新發送的失敗收件人，請重新整理。"],
      ["refused", "CAMPAIGN_NOT_RETRYABLE", "此 Campaign 目前的狀態不可重新發送。"],
      ["forbidden", "", "你的角色沒有此操作的權限"],
    ] as const;
    for (const [mode, refusal, text] of cases) {
      await page.evaluate(
        ({ mode, refusal }) => {
          window.noLinkBlastFixture.retryMode = mode;
          window.noLinkBlastFixture.retryRefusal = refusal;
        },
        { mode, refusal },
      );
      await confirmButton.click();
      await expect(dialog.getByRole("alert")).toContainText(text);
      await expect(dialog.getByRole("alert")).not.toContainText("結果未明");
      await expect(confirmButton).toBeEnabled();
    }
    expect(await savedCampaign(page)).toMatchObject({ status: "failed", requeueWrites: 0 });
    await expect(toast(page)).toHaveCount(0);
  });
  test("a lost response says the result is unknown and needs a re-read before another try", async ({
    page,
  }) => {
    await seedCampaign(page, {
      status: "failed",
      synthetic_recipients: [sentTo(), refusedBy(), refusedBy()],
    });
    await open(page);
    await page.evaluate(() => {
      window.noLinkBlastFixture.retryMode = "lost";
    });
    await retryButton(page).click();
    const dialog = retryDialog(page);
    await dialog.getByRole("button", { name: "重新排入 2 人", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("重新排入結果未明");
    await expect(dialog.getByRole("button", { name: "重新排入 2 人", exact: true })).toBeDisabled();
    await expect(toast(page)).toHaveCount(0);
    await dialog.getByRole("button", { name: "重新讀取最新數字", exact: true }).click();
    // The lost request had in fact committed: the re-read shows nothing left.
    await expect(confirmValue(page, dialog, "將重新排入")).toHaveText("0 人");
    await expect(dialog).toContainText("沒有可重新發送的失敗收件人，請重新整理。");
    await expect(dialog.getByRole("button", { name: /^重新排入/ })).toBeDisabled();
    expect(await fixtureCalls(page, "syntheticCampaignRequeue")).toHaveLength(1);
    expect(await savedCampaign(page)).toMatchObject({ status: "review", requeueWrites: 1 });
  });
  test("a success whose list refresh fails still says so and flags the list as stale", async ({
    page,
  }) => {
    await seedCampaign(page, {
      status: "failed",
      synthetic_recipients: [sentTo(), refusedBy(), refusedBy()],
    });
    await open(page);
    await retryButton(page).click();
    const dialog = retryDialog(page);
    await expect(confirmValue(page, dialog, "將重新排入")).toHaveText("2 人");
    await page.evaluate(() => {
      window.noLinkBlastFixture.readFailure = true;
    });
    await dialog.getByRole("button", { name: "重新排入 2 人", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(toastWith(page, "已重新排入 2 人")).toContainText(
      "Campaign 列表未能更新，畫面上的數字可能已過時",
    );
  });
}
for (const width of [1440, 1280, 768, 390])
  test.describe(`${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    retryTests();
    test("membership narrowing removes private campaign rows", async ({ page }) => {
      await open(page);
      await page.evaluate(() => window.campaignReviewFixture.changeMembership("agent"));
      await expect(row(page)).toHaveCount(0);
      await expect(page.getByText("尚未取得已核實的推廣管理權限。", { exact: true })).toBeVisible();
      expect(await queueCalls(page)).toHaveLength(0);
    });
    test("membership change retains accepted cancellation without obsolete success toast", async ({
      page,
    }) => {
      await open(page);
      const dialog = await openCancel(page);
      await page.evaluate(() => {
        window.noLinkBlastFixture.cancelMode = "delay";
      });
      await dialog.getByRole("button", { name: "確認取消 Campaign", exact: true }).click();
      await expect.poll(() => cancelCalls(page)).toHaveLength(1);
      await page.evaluate(() => window.campaignReviewFixture.changeMembership("agent"));
      await page.evaluate(() => window.noLinkBlastFixture.releaseCancel!());
      await expect
        .poll(() =>
          page.evaluate(
            () => JSON.parse(sessionStorage.getItem("no-link-fixture-campaigns")!)[0].cancelWrites,
          ),
        )
        .toBe(1);
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
      await expect(row(page)).toHaveCount(0);
    });

    test("cancel confirmation preserves accepted history and submits once while pending", async ({
      page,
    }) => {
      await open(page);
      const sending = await confirm(page);
      await sending.getByRole("button", { name: "確認發送給 2 人", exact: true }).click();
      await expect(row(page)).toContainText("已排隊");
      await page.evaluate(() => {
        const rows = JSON.parse(sessionStorage.getItem("no-link-fixture-campaigns")!);
        rows[0].sent = 1;
        rows[0].pending = 1;
        rows[0].acceptedHistory = ["owned-accepted-history"];
        sessionStorage.setItem("no-link-fixture-campaigns", JSON.stringify(rows));
      });
      await page.getByRole("button", { name: "重新整理", exact: true }).click();
      let dialog = await openCancel(page);
      await expect(dialog).toContainText("已發出的訊息無法收回");
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      expect(await cancelCalls(page)).toHaveLength(0);
      dialog = await openCancel(page);
      await page.evaluate(() => {
        window.noLinkBlastFixture.cancelMode = "delay";
      });
      await dialog.getByRole("button", { name: "確認取消 Campaign", exact: true }).click();
      await expect.poll(() => cancelCalls(page)).toHaveLength(1);
      await expect(dialog.getByRole("button", { name: "處理中…", exact: true })).toBeDisabled();
      await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
      await page.evaluate(() => window.noLinkBlastFixture.releaseCancel!());
      await expect(dialog).not.toBeVisible();
      await expect(row(page)).toContainText("已取消");
      await expect(row(page)).toContainText("已發送 1");
      const saved = await page.evaluate(
        () => JSON.parse(sessionStorage.getItem("no-link-fixture-campaigns")!)[0],
      );
      expect(saved).toMatchObject({
        sent: 1,
        pending: 0,
        cancelled: 1,
        cancelWrites: 1,
        queueWrites: 1,
        acceptedHistory: ["owned-accepted-history"],
      });
      expect(await cancelJournal(page)).toHaveLength(0);
      await page.screenshot({
        path: `.audit/remediation-20261003/ep13-20-ci-compat-campaign-cancel-confirmed-${width}.png`,
      });
      await page.reload();
      await expect(row(page)).toContainText("已發送 1");
      await expect(
        row(page).getByRole("button", { name: "取消 Campaign", exact: true }),
      ).toBeDisabled();
      expect(await cancelCalls(page)).toHaveLength(0);
    });
    test("cancel late response cannot show success under another actor", async ({ page }) => {
      await open(page);
      const dialog = await openCancel(page);
      await page.evaluate(() => {
        window.noLinkBlastFixture.cancelMode = "delay";
      });
      await dialog.getByRole("button", { name: "確認取消 Campaign", exact: true }).click();
      await expect.poll(() => cancelCalls(page)).toHaveLength(1);
      await page.evaluate(() => window.campaignReviewFixture.changeActor("actor-b"));
      await page.evaluate(() => window.noLinkBlastFixture.releaseCancel!());
      await expect
        .poll(() =>
          page.evaluate(
            () => JSON.parse(sessionStorage.getItem("no-link-fixture-campaigns")!)[0].cancelWrites,
          ),
        )
        .toBe(1);
      await expect(page.getByText("Campaign 已取消", { exact: false })).toHaveCount(0);
      await expect(cancelRecovery(page)).toHaveCount(0);
      await page.evaluate(() => window.campaignReviewFixture.changeActor("actor-a"));
      await expect(cancelRecovery(page)).toBeVisible();
    });
    test("cancel lost response restores original read gate after reload and never retries", async ({
      page,
    }) => {
      await open(page);
      const dialog = await openCancel(page);
      await page.evaluate(() => {
        window.noLinkBlastFixture.cancelMode = "timeout";
      });
      await dialog.getByRole("button", { name: "確認取消 Campaign", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("取消結果未能確認");
      await expect(
        dialog.getByRole("button", { name: "確認取消 Campaign", exact: true }),
      ).toBeDisabled();
      const journal = await cancelJournal(page);
      expect(journal).toHaveLength(1);
      const original = JSON.parse(journal[0][1]).campaignId;
      expect((await cancelCalls(page))[0].input).toEqual({ id: original });
      await page.reload();
      await expect(cancelRecovery(page)).toBeVisible();
      await expect(row(page)).toContainText("已取消");
      expect(await cancelJournal(page)).toEqual(journal);
      await cancelRecovery(page)
        .getByRole("button", { name: "查回原 Campaign 取消狀態", exact: true })
        .click();
      await expect(cancelRecovery(page)).toHaveCount(0);
      expect(await cancelJournal(page)).toHaveLength(0);
      expect(await cancelCalls(page)).toHaveLength(0);
      expect(
        await page.evaluate(
          () => JSON.parse(sessionStorage.getItem("no-link-fixture-campaigns")!)[0].cancelWrites,
        ),
      ).toBe(1);
    });
    test("cancel in-flight reload and nonterminal read keep the original journal and block sending", async ({
      page,
    }) => {
      await open(page);
      const dialog = await openCancel(page);
      await page.evaluate(() => {
        window.noLinkBlastFixture.cancelMode = "delay";
      });
      await dialog.getByRole("button", { name: "確認取消 Campaign", exact: true }).click();
      await expect.poll(() => cancelCalls(page)).toHaveLength(1);
      const journal = await cancelJournal(page);
      expect(journal).toHaveLength(1);
      await page.reload();
      await expect(cancelRecovery(page)).toBeVisible();
      await cancelRecovery(page)
        .getByRole("button", { name: "查回原 Campaign 取消狀態", exact: true })
        .click();
      await expect(cancelRecovery(page)).toContainText("未能確認取消");
      expect(await cancelJournal(page)).toEqual(journal);
      await row(page).getByRole("button", { name: "預覽收件人", exact: true }).click();
      await expect(row(page).getByRole("button", { name: "發送…", exact: true })).toBeDisabled();
      await expect(
        row(page).getByRole("button", { name: "取消 Campaign", exact: true }),
      ).toBeDisabled();
      expect(await queueCalls(page)).toHaveLength(0);
      expect(await cancelCalls(page)).toHaveLength(0);
      await page.evaluate(() => {
        window.noLinkBlastFixture.readFailure = true;
      });
      await cancelRecovery(page)
        .getByRole("button", { name: "查回原 Campaign 取消狀態", exact: true })
        .click();
      await expect(cancelRecovery(page)).toContainText("未能確認取消");
      expect(await cancelJournal(page)).toEqual(journal);
      await page.reload();
      await expect(cancelRecovery(page)).toBeVisible();
      expect(await cancelJournal(page)).toEqual(journal);
    });
    test("cancel storage failure submits no cancellation request", async ({ page }) => {
      await open(page);
      const dialog = await openCancel(page);
      await page.evaluate(() => {
        const write = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key.startsWith("earnest-campaign-cancel:"))
            throw Error("Owned cancel journal unavailable");
          write.call(this, key, value);
        };
      });
      await dialog.getByRole("button", { name: "確認取消 Campaign", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("未有提交取消要求");
      expect(await cancelCalls(page)).toHaveLength(0);
      expect(await cancelJournal(page)).toHaveLength(0);
    });
    test("cancel definitive refusal keeps campaign status and clears only its operation journal", async ({
      page,
    }) => {
      await open(page);
      const dialog = await openCancel(page);
      await page.evaluate(() => {
        window.noLinkBlastFixture.cancelMode = "refused";
      });
      await dialog.getByRole("button", { name: "確認取消 Campaign", exact: true }).click();
      await expect(dialog.getByRole("alert")).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "確認取消 Campaign", exact: true }),
      ).toBeEnabled();
      expect(await cancelCalls(page)).toHaveLength(1);
      expect(await cancelJournal(page)).toHaveLength(0);
      expect(
        await page.evaluate(
          () =>
            JSON.parse(
              sessionStorage.getItem("no-link-fixture-campaigns") ?? '[{"status":"review"}]',
            )[0].status,
        ),
      ).toBe("review");
      await expect(cancelRecovery(page)).toHaveCount(0);
      await expect(page.getByText("Campaign 已取消", { exact: false })).toHaveCount(0);
    });
    test("cancel corrupt journal is retained and blocks mutation only for its actor", async ({
      page,
    }) => {
      await open(page);
      const key = "earnest-campaign-cancel:actor-a";
      for (const raw of [
        "{",
        "{}",
        JSON.stringify({ version: 2, campaignId: "60000000-0000-4000-8000-000000000001" }),
      ]) {
        await page.evaluate(({ key, raw }) => sessionStorage.setItem(key, raw), { key, raw });
        await page.reload();
        await expect(
          page.getByRole("alert").filter({ hasText: "未能讀取本機取消操作記錄" }),
        ).toBeVisible();
        await expect(
          row(page).getByRole("button", { name: "取消 Campaign", exact: true }),
        ).toBeDisabled();
        await row(page).getByRole("button", { name: "預覽收件人", exact: true }).click();
        await expect(row(page).getByRole("button", { name: "發送…", exact: true })).toBeDisabled();
        expect(await page.evaluate((key) => sessionStorage.getItem(key), key)).toBe(raw);
        expect(await cancelCalls(page)).toHaveLength(0);
        expect(await queueCalls(page)).toHaveLength(0);
      }
      await page.evaluate(() => window.campaignReviewFixture.changeActor("actor-b"));
      await expect(
        row(page).getByRole("button", { name: "取消 Campaign", exact: true }),
      ).toBeEnabled();
      await page.evaluate(() => window.campaignReviewFixture.changeActor("actor-a"));
      await expect(
        page.getByRole("alert").filter({ hasText: "未能讀取本機取消操作記錄" }),
      ).toBeVisible();
      expect(await cancelJournal(page)).toHaveLength(1);
    });
    test("lost queue response survives reload and only reads the original campaign", async ({
      page,
    }) => {
      await open(page);
      const dialog = await confirm(page);
      await page.evaluate(() => {
        window.noLinkBlastFixture.queueMode = "timeout";
      });
      await dialog.getByRole("button", { name: "確認發送給 2 人", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("結果未能確認");
      await page.reload();
      await expect(row(page)).toContainText("已排隊");
      await expect(recovery(page)).toBeVisible();
      await page.getByRole("button", { name: "重新整理", exact: true }).click();
      await expect(recovery(page)).toBeVisible();
      await recovery(page)
        .getByRole("button", { name: "重新載入 Campaign 狀態", exact: true })
        .click();
      await expect(recovery(page)).toHaveCount(0);
      expect(await queueCalls(page)).toHaveLength(0);
      expect(
        await page.evaluate(
          () => JSON.parse(sessionStorage.getItem("no-link-fixture-campaigns")!)[0].queueWrites,
        ),
      ).toBe(1);
    });
    test("in-flight queue survives reload and blocks a new send before readback", async ({
      page,
    }) => {
      await open(page);
      const dialog = await confirm(page);
      await page.evaluate(() => {
        window.noLinkBlastFixture.queueMode = "delay";
      });
      await dialog.getByRole("button", { name: "確認發送給 2 人", exact: true }).click();
      await expect.poll(() => queueCalls(page)).toHaveLength(1);
      await page.reload();
      await expect(recovery(page)).toBeVisible();
      await row(page).getByRole("button", { name: "預覽收件人", exact: true }).click();
      await expect(row(page).getByRole("button", { name: "發送…", exact: true })).toBeDisabled();
      expect(await queueCalls(page)).toHaveLength(0);
    });
    test("unknown result stays with the original actor across account switches", async ({
      page,
    }) => {
      await open(page);
      const dialog = await confirm(page);
      await page.evaluate(() => {
        window.noLinkBlastFixture.queueMode = "timeout";
      });
      await dialog.getByRole("button", { name: "確認發送給 2 人", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("結果未能確認");
      await page.evaluate(() => window.campaignReviewFixture.changeActor("actor-b"));
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect(recovery(page)).toHaveCount(0);
      await page.evaluate(() => window.campaignReviewFixture.changeActor("actor-a"));
      await expect(recovery(page)).toBeVisible();
      expect(await queueCalls(page)).toHaveLength(1);
    });
    test("late old actor queue response cannot show success in the new actor", async ({ page }) => {
      await open(page);
      const dialog = await confirm(page);
      await page.evaluate(() => {
        window.noLinkBlastFixture.queueMode = "delay";
      });
      await dialog.getByRole("button", { name: "確認發送給 2 人", exact: true }).click();
      await expect.poll(() => queueCalls(page)).toHaveLength(1);
      await page.evaluate(() => window.campaignReviewFixture.changeActor("actor-b"));
      await page.evaluate(() => window.noLinkBlastFixture.releaseQueue!());
      await expect
        .poll(() =>
          page.evaluate(
            () => JSON.parse(sessionStorage.getItem("no-link-fixture-campaigns")!)[0].queueWrites,
          ),
        )
        .toBe(1);
      await expect(page.getByText("已加入發送佇列", { exact: false })).toHaveCount(0);
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await page.evaluate(() => window.campaignReviewFixture.changeActor("actor-a"));
      await expect(recovery(page)).toBeVisible();
    });
    test("unavailable operation storage blocks queue before any request", async ({ page }) => {
      await open(page);
      const dialog = await confirm(page);
      await page.evaluate(() => {
        Storage.prototype.setItem = () => {
          throw Error("owned storage unavailable");
        };
      });
      await dialog.getByRole("button", { name: "確認發送給 2 人", exact: true }).click();
      await expect(dialog.getByRole("alert")).toBeVisible();
      expect(await queueCalls(page)).toHaveLength(0);
      await expect(dialog.getByRole("alert")).toContainText("未有提交");
    });
    test("failed recovery read retains the gate through a second reload", async ({ page }) => {
      await open(page);
      const dialog = await confirm(page);
      await page.evaluate(() => {
        window.noLinkBlastFixture.queueMode = "timeout";
      });
      await dialog.getByRole("button", { name: "確認發送給 2 人", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("結果未能確認");
      await page.reload();
      await expect(recovery(page)).toBeVisible();
      await page.evaluate(() => {
        window.noLinkBlastFixture.readFailure = true;
      });
      await recovery(page)
        .getByRole("button", { name: "重新載入 Campaign 狀態", exact: true })
        .click();
      await expect(recovery(page)).toContainText("未能讀回");
      await page.reload();
      await expect(recovery(page)).toBeVisible();
      expect(await queueCalls(page)).toHaveLength(0);
      await recovery(page)
        .getByRole("button", { name: "重新載入 Campaign 狀態", exact: true })
        .click();
      await expect(recovery(page)).toHaveCount(0);
      await page.reload();
      await expect(row(page)).toContainText("已排隊");
      await expect(recovery(page)).toHaveCount(0);
    });
    test("successful queue stays distinct from delivery and clears only its actor journal", async ({
      page,
    }) => {
      await open(page);
      const dialog = await confirm(page);
      await dialog.getByRole("button", { name: "確認發送給 2 人", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(row(page)).toContainText("已排隊");
      await expect(row(page)).toContainText("待發送 2");
      await page.reload();
      await expect(row(page)).toContainText("已排隊");
      await expect(recovery(page)).toHaveCount(0);
      expect(await queueCalls(page)).toHaveLength(0);
    });
    test("missing original campaign cannot clear the unresolved journal", async ({ page }) => {
      await open(page);
      const dialog = await confirm(page);
      await page.evaluate(() => {
        window.noLinkBlastFixture.queueMode = "timeout";
      });
      await dialog.getByRole("button", { name: "確認發送給 2 人", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("結果未能確認");
      await page.reload();
      await expect(recovery(page)).toBeVisible();
      await page.evaluate(() => sessionStorage.setItem("no-link-fixture-campaigns", "[]"));
      await recovery(page)
        .getByRole("button", { name: "重新載入 Campaign 狀態", exact: true })
        .click();
      await expect(recovery(page)).toContainText("未能讀回此 Campaign");
      await page.reload();
      await expect(recovery(page)).toBeVisible();
      expect(await queueCalls(page)).toHaveLength(0);
    });
  });
// FX-10b evidence width: only the retry and paused screens, at the narrowest phone.
test.describe("375", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  retryTests();
});
// FX-17a G-20: typing into a new campaign then leaving the page must ask 尚未儲存.
test.describe("leave guard", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("typing in a new campaign then clicking a nav link asks 尚未儲存; cancelling keeps the draft", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("button", { name: "新增 Campaign", exact: true }).first().click();
    const name = page.getByLabel("Campaign 名稱");
    await name.fill("未儲存的推廣");
    // The open dialog makes the sidebar inert for the pointer; fire the link's own click.
    await page
      .locator('nav[aria-label="後台選單"] a[href="/admin/leads"]')
      .evaluate((link) => (link as HTMLElement).click());
    const prompt = page.getByRole("alertdialog", { name: "尚未儲存" });
    await expect(prompt).toBeVisible();
    await prompt.getByRole("button", { name: "取消" }).click();
    await expect(prompt).not.toBeVisible();
    await expect(page).toHaveURL(/\/admin\/blasts/);
    await expect(page.getByLabel("Campaign 名稱")).toHaveValue("未儲存的推廣");
  });
});
