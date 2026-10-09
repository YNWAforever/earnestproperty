import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";

// FX-17a G-24: a sending or consent confirmation names the customer it acts on, from the
// conversation that the action targets, with the phone masked to its last four digits.
// Owned no-link fixture only: no network, DB or provider dispatch.
type FixtureWindow = {
  noLinkFixture: { calls: { name: string; input?: unknown }[] };
  noLinkOutboundFixture: {
    calls: { name: string; input: { data: { conversationId: string; templateId?: string } } }[];
  };
};
const ids = {
  a: "10000000-0000-4000-8000-000000000001",
  b: "10000000-0000-4000-8000-000000000002",
};
const customers = {
  a: { name: "合成客戶甲", phone: "+852 5550 1234", masked: "••••1234" },
  b: { name: "合成客戶乙", phone: "+852 5550 5678", masked: "••••5678" },
};
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
  // No log line may carry a customer's full number.
  page.on("console", (message) => {
    for (const customer of Object.values(customers))
      if (message.text().replace(/\s/g, "").includes(customer.phone.replace(/\s/g, "").slice(-8)))
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

const templateStorage = {
  "no-link-fixture-actor": "agent-a",
  "no-link-fixture-window": "expired",
  "no-link-fixture-reply-template": "true",
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

/** The dialog names exactly this customer, masked, and nothing in it carries a full number. */
async function expectNames(
  dialog: ReturnType<Page["getByRole"]>,
  shown: (typeof customers)["a"],
  other: (typeof customers)["a"],
) {
  await expect(dialog).toContainText(`客戶：${shown.name}`);
  await expect(dialog).toContainText(shown.masked);
  await expect(dialog).not.toContainText(other.name);
  await expect(dialog).not.toContainText(other.masked);
  const html = await dialog.evaluate((node) => node.outerHTML.replace(/\s/g, ""));
  for (const customer of Object.values(customers)) {
    const digits = customer.phone.replace(/\s/g, "");
    expect(html).not.toContain(digits);
    expect(html).not.toContain(digits.slice(-8));
  }
}

test("the template confirmation names the open conversation's customer and masked phone, and changes when another conversation is opened", async ({
  page,
}) => {
  await open(page, ids.a, templateStorage);
  let dialog = await openTemplateConfirm(page);
  await expect(dialog).toContainText(
    `將向 ${customers.a.name}（${customers.a.masked}）傳送已審批範本「synthetic_reply」。範本一經傳送即無法收回。`,
  );
  await expect(dialog.getByRole("definition").first()).toHaveText(customers.a.name);
  await expectNames(dialog, customers.a, customers.b);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // Open the other conversation from the inbox: the confirmation now names its customer.
  await page
    .getByRole("button", { name: new RegExp(customers.b.name) })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: customers.b.name, level: 2 })).toBeVisible();
  dialog = await openTemplateConfirm(page);
  await expect(dialog).toContainText(
    `將向 ${customers.b.name}（${customers.b.masked}）傳送已審批範本「synthetic_reply」。`,
  );
  await expectNames(dialog, customers.b, customers.a);
  await page.screenshot({ path: `${SHOTS}/template-confirm-1440.png`, animations: "disabled" });

  // The displayed identity is the send target: confirming sends to conversation B, once.
  await dialog.getByRole("button", { name: "傳送", exact: true }).click();
  await expect
    .poll(async () => (await outboundCalls(page)).filter((c) => c.name === "template").length)
    .toBe(1);
  const [sent] = (await outboundCalls(page)).filter((c) => c.name === "template");
  expect(sent.input.data.conversationId).toBe(ids.b);
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
  await open(page, ids.b, {
    "no-link-fixture-actor": "manager",
    "no-link-fixture-near-miss": "true",
  });
  await expect(page.getByRole("heading", { name: customers.b.name, level: 2 })).toBeVisible();

  await page.getByRole("button", { name: "管理 WhatsApp 推廣同意", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "WhatsApp 推廣同意" });
  await expect(dialog).toContainText(`客戶：${customers.b.name}（${customers.b.masked}）`);
  await expectNames(dialog, customers.b, customers.a);
  await page.screenshot({ path: `${SHOTS}/consent-1440.png`, animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "確認退訂", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "WhatsApp 推廣同意" });
  await expect(dialog).toContainText(`客戶：${customers.b.name}（${customers.b.masked}）`);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "不是退訂", exact: true }).click();
  dialog = page.getByRole("alertdialog", { name: "不是退訂要求？" });
  await expect(dialog).toContainText(`客戶：${customers.b.name}（${customers.b.masked}）`);
  await expectNames(dialog, customers.b, customers.a);
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
  await open(page, ids.a, {
    ...templateStorage,
    "no-link-fixture-actor": "manager",
    "no-link-fixture-near-miss": "true",
  });
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  const dialog = await openTemplateConfirm(page);
  await expect(dialog).toContainText(`客戶：${customers.a.name}`);
  expect(await fits()).toBe(true);
  await page.screenshot({ path: `${SHOTS}/template-confirm-375.png`, animations: "disabled" });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();

  await page.getByRole("button", { name: "管理 WhatsApp 推廣同意", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "WhatsApp 推廣同意" })).toContainText(
    `客戶：${customers.a.name}（${customers.a.masked}）`,
  );
  expect(await fits()).toBe(true);
  await page.screenshot({ path: `${SHOTS}/consent-375.png`, animations: "disabled" });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "不是退訂", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "不是退訂要求？" })).toContainText(
    `客戶：${customers.a.name}（${customers.a.masked}）`,
  );
  expect(await fits()).toBe(true);
  await page.screenshot({ path: `${SHOTS}/not-opt-out-375.png`, animations: "disabled" });
  expect(await outboundCalls(page)).toEqual([]);
});
