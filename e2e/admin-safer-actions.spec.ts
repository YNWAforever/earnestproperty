import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";

// FX-17a G-24: a sending or consent confirmation names the customer it acts on, from the
// conversation that the action targets, with the number masked to its last four digits.
// Owned no-link fixture only: no network, DB or provider dispatch.
type FixtureWindow = {
  noLinkFixture: {
    calls: { name: string; input?: unknown }[];
    delayDetail: boolean;
    releaseLateDetail: null | (() => void);
  };
  noLinkOutboundFixture: {
    calls: { name: string; input: { data: { conversationId: string; templateId?: string } } }[];
  };
};
const ids = {
  a: "10000000-0000-4000-8000-000000000001",
  b: "10000000-0000-4000-8000-000000000002",
};
// With no-link-fixture-distinct-detail the list row, the detail's contact and the send target
// (member id) all differ, so each check shows which record a confirmation was built from.
const customers = {
  a: {
    rowName: "合成客戶甲",
    rowPhone: "+852 5550 1234",
    name: "合成客戶甲（詳情）",
    phone: "+852 6111 2222",
    contactMasked: "••••2222",
    member: "85263334444",
    targetMasked: "••••4444",
  },
  b: {
    rowName: "合成客戶乙",
    rowPhone: "+852 5550 5678",
    name: "合成客戶乙（詳情）",
    phone: "+852 6555 6666",
    contactMasked: "••••6666",
    member: "85267778888",
    targetMasked: "••••8888",
  },
};
type Customer = (typeof customers)["a"];
const allNumbers = Object.values(customers).flatMap((c) =>
  [c.rowPhone, c.phone, c.member].map((n) => n.replace(/\D/g, "")),
);
const SHOTS = ".audit/fx17a-safer-actions";
let server: Server, origin: string;
const errors = new WeakMap<Page, string[]>();

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  assert.ok(!process.env.PLAYWRIGHT_BASE_URL, "This suite owns its isolated target");
  assert.equal(
    spawnSync(process.execPath, ["scripts/browser-fixtures/build-whatsapp-no-link.mjs"], {
      stdio: "inherit",
    }).status,
    0,
  );
  await mkdir(SHOTS, { recursive: true });
  const root = resolve(".audit/no-link-browser");
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
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== "passed") return;
  expect(errors.get(page)).toEqual([]);
});

async function open(page: Page, conversation: string, storage: Record<string, string>) {
  const captured: string[] = [];
  errors.set(page, captured);
  page.on("pageerror", (error) => captured.push(error.message));
  // No log line may carry a full number (list phone, contact phone or member id).
  page.on("console", (message) => {
    const digits = message.text().replace(/\D/g, "");
    if (allNumbers.some((number) => digits.includes(number.slice(-8))))
      captured.push("Full phone number logged");
  });
  await page.route("**/*", (route) => {
    const request = route.request();
    if (new URL(request.url()).origin === origin && ["GET", "HEAD"].includes(request.method()))
      return route.continue();
    captured.push("Blocked external or mutation request");
    return route.abort();
  });
  await page.addInitScript((storage) => {
    for (const [key, value] of Object.entries(storage)) sessionStorage.setItem(key, value);
  }, storage);
  await page.goto(origin + "/admin/whatsapp?conversation=" + conversation);
}

const templateBase = {
  "no-link-fixture-actor": "agent-a",
  "no-link-fixture-window": "expired",
  "no-link-fixture-reply-template": "true",
};
const templateStorage = { ...templateBase, "no-link-fixture-distinct-detail": "true" };
const consentStorage = {
  "no-link-fixture-actor": "manager",
  "no-link-fixture-near-miss": "true",
  "no-link-fixture-distinct-detail": "true",
};
const outboundCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as FixtureWindow).noLinkOutboundFixture.calls);

async function openTemplateConfirm(page: Page) {
  await page.getByLabel("選擇範本").filter({ visible: true }).click();
  await page.getByRole("option", { name: "synthetic_reply（zh_HK）" }).click();
  await page.getByRole("button", { name: "傳送範本", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Names `shown` from its detail with `masked`; never the other customer, the row or a full number. */
async function expectOnly(
  dialog: ReturnType<Page["getByRole"]>,
  shown: Customer,
  masked: string,
  other: Customer,
) {
  await expect(dialog).toContainText(`客戶：${shown.name}`);
  await expect(dialog).toContainText(masked);
  for (const absent of [other.name, other.contactMasked, other.targetMasked])
    await expect(dialog).not.toContainText(absent);
  // The list row's phone never feeds the label.
  await expect(dialog).not.toContainText("••••" + shown.rowPhone.slice(-4));
  const digits = (await dialog.evaluate((node) => node.outerHTML)).replace(/\D/g, "");
  for (const number of allNumbers) expect(digits).not.toContain(number.slice(-8));
}

test("the template confirmation names the open conversation's customer and masked phone, and changes when another conversation is opened", async ({
  page,
}) => {
  await open(page, ids.a, templateStorage);
  let dialog = await openTemplateConfirm(page);
  // The digits are the member id the send goes to, not the contact's CRM phone.
  await expect(dialog).toContainText(
    `將向 ${customers.a.name}（${customers.a.targetMasked}）傳送已審批範本「synthetic_reply」。範本一經傳送即無法收回。`,
  );
  await expect(dialog.getByRole("definition").first()).toHaveText(customers.a.name);
  await expect(dialog).not.toContainText(customers.a.contactMasked);
  await expectOnly(dialog, customers.a, customers.a.targetMasked, customers.b);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // Open the other conversation from the inbox: the confirmation now names its customer.
  await page
    .getByRole("button", { name: new RegExp(customers.b.rowName) })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: customers.b.name, level: 2 })).toBeVisible();
  dialog = await openTemplateConfirm(page);
  await expect(dialog).toContainText(
    `將向 ${customers.b.name}（${customers.b.targetMasked}）傳送已審批範本「synthetic_reply」。`,
  );
  await expect(dialog).not.toContainText(customers.b.contactMasked);
  await expectOnly(dialog, customers.b, customers.b.targetMasked, customers.a);
  await page.screenshot({ path: `${SHOTS}/template-confirm-1440.png`, animations: "disabled" });

  // The displayed identity is the send target: confirming sends to conversation B, once.
  await dialog.getByRole("button", { name: "傳送", exact: true }).click();
  await expect
    .poll(async () => (await outboundCalls(page)).filter((c) => c.name === "template").length)
    .toBe(1);
  const [sent] = (await outboundCalls(page)).filter((c) => c.name === "template");
  expect(sent.input.data.conversationId).toBe(ids.b);
});

test("a member id that is not a phone number shows 未有電話, never the CRM phone", async ({
  page,
}) => {
  // Default fixture detail: member id "synthetic-member", contact phone +852 5550 1234.
  await open(page, ids.a, templateBase);
  const dialog = await openTemplateConfirm(page);
  await expect(dialog).toContainText(`將向 ${customers.a.rowName}（未有電話）傳送已審批範本`);
  await expect(dialog).not.toContainText("••••");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(await outboundCalls(page)).toEqual([]);
});

test("confirming during a URL switch, before the next conversation loads, sends nothing", async ({
  page,
}) => {
  await open(page, ids.b, templateStorage);
  await expect(page.getByRole("heading", { name: customers.b.name, level: 2 })).toBeVisible();
  const dialog = await openTemplateConfirm(page);
  // Back/forward or a Command Center link moves the URL to A while A's detail is held back, so
  // B's detail and this dialog are still on screen while A is the selected conversation.
  await page.evaluate((a) => {
    (window as unknown as FixtureWindow).noLinkFixture.delayDetail = true;
    history.pushState(history.state, "", `/admin/whatsapp?conversation=${a}`);
    dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  }, ids.a);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((window as unknown as FixtureWindow).noLinkFixture.releaseLateDetail),
      ),
    )
    .toBe(true);
  await expect(dialog).toContainText(customers.b.name);
  await dialog.getByRole("button", { name: "傳送", exact: true }).click();
  await expect(page.getByText("請先選擇對話", { exact: true })).toBeVisible();
  expect(await outboundCalls(page)).toEqual([]);
  // When A arrives the panel re-keys and the stale confirmation is gone.
  await page.evaluate(() =>
    (window as unknown as FixtureWindow).noLinkFixture.releaseLateDetail!(),
  );
  await expect(page.getByRole("heading", { name: customers.a.name, level: 2 })).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await outboundCalls(page)).toEqual([]);
});

test("cancelling the template confirmation sends nothing", async ({ page }) => {
  await open(page, ids.a, templateStorage);
  for (const close of ["cancel", "escape"] as const) {
    const dialog = await openTemplateConfirm(page);
    if (close === "cancel") await dialog.getByRole("button", { name: "取消", exact: true }).click();
    else await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    // Focus returns to the button that opened it (Task 2's dialog contract).
    await expect(page.getByRole("button", { name: "傳送範本", exact: true })).toBeFocused();
  }
  expect(await outboundCalls(page)).toEqual([]);
  expect(
    await page.evaluate(() => sessionStorage.getItem("no-link-fixture-outbound") ?? "[]"),
  ).toBe("[]");
});

test("the consent dialog and 不是退訂 name the customer", async ({ page }) => {
  await open(page, ids.b, consentStorage);
  await expect(page.getByRole("heading", { name: customers.b.name, level: 2 })).toBeVisible();
  // These change the contact, so they show the contact's phone.
  const line = `客戶：${customers.b.name}（${customers.b.contactMasked}）`;

  await page.getByRole("button", { name: "管理 WhatsApp 推廣同意", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "WhatsApp 推廣同意" });
  await expect(dialog).toContainText(line);
  await expectOnly(dialog, customers.b, customers.b.contactMasked, customers.a);
  await page.screenshot({ path: `${SHOTS}/consent-1440.png`, animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "確認退訂", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "WhatsApp 推廣同意" });
  await expect(dialog).toContainText(line);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "不是退訂", exact: true }).click();
  dialog = page.getByRole("alertdialog", { name: "不是退訂要求？" });
  await expect(dialog).toContainText(line);
  await expectOnly(dialog, customers.b, customers.b.contactMasked, customers.a);
  await page.screenshot({ path: `${SHOTS}/not-opt-out-1440.png`, animations: "disabled" });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // Opening and cancelling changed nothing.
  const mutations = await page.evaluate(() =>
    (window as unknown as FixtureWindow).noLinkFixture.calls.filter((c) =>
      ["consent", "dismissNearMiss", "clearAccidentalOptOut"].includes(c.name),
    ),
  );
  expect(mutations).toEqual([]);
});

test("the three confirmations fit a 375 px screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, ids.a, { ...templateStorage, ...consentStorage });
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  const dialog = await openTemplateConfirm(page);
  await expect(dialog).toContainText(`客戶：${customers.a.name}`);
  expect(await fits()).toBe(true);
  await page.screenshot({ path: `${SHOTS}/template-confirm-375.png`, animations: "disabled" });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();

  await page.getByRole("button", { name: "管理 WhatsApp 推廣同意", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "WhatsApp 推廣同意" })).toContainText(
    `客戶：${customers.a.name}（${customers.a.contactMasked}）`,
  );
  expect(await fits()).toBe(true);
  await page.screenshot({ path: `${SHOTS}/consent-375.png`, animations: "disabled" });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "不是退訂", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "不是退訂要求？" })).toContainText(
    `客戶：${customers.a.name}（${customers.a.contactMasked}）`,
  );
  expect(await fits()).toBe(true);
  await page.screenshot({ path: `${SHOTS}/not-opt-out-375.png`, animations: "disabled" });
  expect(await outboundCalls(page)).toEqual([]);
});

// FX-17a G-11: diagnostics reach admins only. The fixture applies the same pure view functions
// the server uses, keyed on the synthetic actor's role; the server tests prove the stripping.
const staffId = "20000000-0000-4000-8000-000000000001";
const technicalStorage = { "no-link-fixture-staff-work": "true" };
const agentStorage = { ...technicalStorage, "no-link-fixture-actor": "agent-a" };
const adminStorage = {
  ...technicalStorage,
  "no-link-fixture-actor": "manager",
  "no-link-fixture-role": "admin",
};

const fitsWidth = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
// Below 1024 px the conversation opens as a dialog over the inbox; close it to reach the panel.
async function closeConversationIfMobile(page: Page, width: number) {
  if (width >= 1024) return;
  await page.getByRole("button", { name: "關閉", exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole("region", { name: "查詢及分派證據" })).toHaveCount(0);
}

for (const width of [1440, 375]) {
  test(`an agent sees no 技術資料 in the inbox; an admin can open it (${width} px)`, async ({
    page,
  }) => {
    const height = width < 768 ? 812 : 900;
    await page.setViewportSize({ width, height });
    await open(page, ids.a, agentStorage);
    const evidence = page.getByRole("region", { name: "查詢及分派證據" });
    await expect(evidence).toContainText("已確認負責人：合成同事甲");
    for (const gone of ["技術資料", "支援診斷", "接手支援診斷"])
      await expect(page.getByText(gone, { exact: true })).toHaveCount(0);
    const absentForAgent = [staffId, "private_note_posted", "synthetic-model", "requested_staff"];
    for (const absent of absentForAgent)
      expect(await page.locator("body").innerText()).not.toContain(absent);
    expect(await fitsWidth(page)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/technical-inbox-agent-${width}.png` });
    await closeConversationIfMobile(page, width);
    const panel = page.getByRole("region", { name: "我的接手工作" });
    await expect(panel).toContainText("A074714");
    // The attempt line keeps transport, state and an HK time.
    await expect(panel).toContainText("Inbox 內部備註（不代表同事手機通知）：已交 WhatsApp 發送（未確認送達）");
    await expect(panel).toContainText(" · 接納 ");
    await expect(panel.getByText("技術資料", { exact: true })).toHaveCount(0);
    await panel.screenshot({ path: `${SHOTS}/technical-card-agent-${width}.png` });
    expect(errors.get(page)).toEqual([]);
    await page.close();

    const adminPage = await page.context().newPage();
    await adminPage.setViewportSize({ width, height });
    await open(adminPage, ids.a, adminStorage);
    await expect(adminPage.getByRole("region", { name: "查詢及分派證據" })).toContainText(
      "已確認負責人：合成同事甲",
    );
    expect(await adminPage.locator("body").innerText()).not.toContain(staffId);
    // Closed by default. On a phone only the open conversation's disclosure is reachable.
    const triggers = adminPage.getByRole("button", { name: "技術資料", exact: true });
    await expect(triggers).toHaveCount(width >= 1024 ? 2 : 1);
    for (const trigger of await triggers.all()) await trigger.click();
    await expect(adminPage.getByText(`建議同事 ID：${staffId}`)).toBeVisible();
    await expect(adminPage.getByText("配對原因：requested_staff")).toBeVisible();
    expect(await fitsWidth(adminPage)).toBe(true);
    await adminPage.screenshot({ path: `${SHOTS}/technical-inbox-admin-${width}.png` });
    await closeConversationIfMobile(adminPage, width);
    const adminPanel = adminPage.getByRole("region", { name: "我的接手工作" });
    if (width < 1024)
      await adminPanel.getByRole("button", { name: "技術資料", exact: true }).click();
    await expect(adminPanel).toContainText("證據類型：private_note_posted");
    await expect(adminPanel).toContainText("接納來源：synthetic-model");
    expect(await fitsWidth(adminPage)).toBe(true);
    await adminPanel.screenshot({ path: `${SHOTS}/technical-card-admin-${width}.png` });
    // afterEach checks the fixture page; hand it the admin page's captured errors.
    errors.set(page, errors.get(adminPage)!);
  });
}
