import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Real-browser regression for the public live-agent widget (FX-11b). The actual widget renders
 * from an owned fixture (scripts/browser-fixtures/live-agent); every /api/live-agent/* call is
 * answered here with fixed JSON and every other non-origin request is aborted, so no database,
 * model provider or network is involved.
 */

const COPY = {
  welcome: "你好，我是 Earnest Property 問樓助手。想買樓、租樓、放盤估價，還是查詢屋苑資料？",
  listings: "以下是網站上現時符合條件的公開盤源，詳情以盤源頁面為準：",
  noMatch:
    "我暫時只能協助查詢網站上的盤源、屋苑和常見問題。你可以輸入屋苑名稱和房數，例如「碧堤半島 兩房」，或留下 WhatsApp 電話由持牌代理跟進。",
  more: "查看全部符合條件的盤源",
  offline: "暫時未能連線，請稍後再試。",
  handoffSuccess: "已記錄跟進要求。請確認 WhatsApp 電話正確，代理會跟進。",
  phoneInvalid: "電話號碼格式不正確，請輸入 8 位香港手機號碼，或連國家碼的號碼。",
};

const LISTING_CARDS = [
  {
    type: "listing",
    title: "碧堤半島 2座 中層 A室",
    lines: ["售 $6.80M", "實用 600 呎", "2 房"],
    href: "/property/EP11001",
  },
  {
    type: "listing",
    title: "碧堤半島 5座 高層 C室",
    lines: ["售 $7.20M", "實用 620 呎", "2 房"],
    href: "/property/EP11002",
  },
];

const LISTINGS_REPLY = {
  message: { message_text: "transcript only" },
  handoffSuggested: false,
  reply: { kind: "listings", text: COPY.listings, cards: LISTING_CARDS },
};
const NO_MATCH_REPLY = {
  message: { message_text: COPY.noMatch },
  handoffSuggested: true,
  reply: { kind: "no_match", text: COPY.noMatch, cards: [] },
};

const SHOTS = resolve(".audit/remediation-20261003");
const WIDTHS = [375, 1440] as const;

let server: Server, origin: string;
let pageErrors: string[] = [];

test.beforeAll(async () => {
  test.setTimeout(120000);
  assert.ok(!process.env.PLAYWRIGHT_BASE_URL);
  assert.equal(
    spawnSync(process.execPath, ["scripts/browser-fixtures/build-live-agent.mjs"], {
      stdio: "inherit",
    }).status,
    0,
  );
  await mkdir(SHOTS, { recursive: true });
  const root = resolve(".audit/live-agent-browser");
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
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== "passed") return;
  expect(pageErrors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

type MessageHandler = (route: Route) => Promise<void>;
type HandoffHandler = (route: Route, body: Record<string, unknown>) => Promise<void>;

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function open(
  page: Page,
  width: number,
  onMessage: MessageHandler,
  onHandoff: HandoffHandler = (route) => json(route, { ok: true }),
) {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width, height: 900 });
  // Registered first, so the /api/live-agent/* routes below take precedence.
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin &&
    ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort(),
  );
  await page.route("**/api/live-agent/session", (route) =>
    json(route, { id: "00000000-0000-4000-8000-000000000111", accessToken: "fixture-token" }),
  );
  await page.route("**/api/live-agent/message", onMessage);
  await page.route("**/api/live-agent/handoff", (route) =>
    onHandoff(route, route.request().postDataJSON() as Record<string, unknown>),
  );
  await page.goto(origin + "/");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText(COPY.welcome, { exact: true })).toBeVisible();
}

async function ask(page: Page, text: string) {
  await page.getByRole("textbox", { name: "即時客服訊息" }).fill(text);
  await page.getByRole("button", { name: "傳送" }).click();
}

const phoneInput = (page: Page) => page.getByRole("textbox", { name: "轉接 WhatsApp 電話" });

for (const width of WIDTHS) {
  test(`open widget before any message at ${width}px`, async ({ page }) => {
    await open(page, width, (route) => json(route, LISTINGS_REPLY));
    await expect(phoneInput(page)).toHaveCount(0);
    await page.screenshot({ path: resolve(SHOTS, `fx11b-before-${width}.png`) });
  });

  test(`listing cards link to property pages at ${width}px`, async ({ page }) => {
    await open(page, width, (route) =>
      json(route, {
        ...LISTINGS_REPLY,
        reply: {
          ...LISTINGS_REPLY.reply,
          cards: [
            ...LISTING_CARDS,
            {
              type: "more",
              title: COPY.more,
              lines: [],
              href: "/listings?deal=sale&bedrooms=2&estate=bellagio",
            },
          ],
        },
      }),
    );
    await ask(page, "碧堤半島 兩房");

    await expect(page.getByText(COPY.listings, { exact: true })).toBeVisible();
    await expect(page.getByText("transcript only")).toHaveCount(0);
    const dialog = page.getByRole("dialog");
    for (const card of LISTING_CARDS) {
      const link = dialog.getByRole("link", { name: card.title, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", card.href);
      await expect(link).not.toHaveAttribute("target", /.*/);
      for (const line of card.lines) await expect(dialog.getByText(line).first()).toBeVisible();
    }
    const more = dialog.getByRole("link", { name: COPY.more, exact: true });
    await expect(more).toHaveAttribute("href", "/listings?deal=sale&bedrooms=2&estate=bellagio");
    await expect(phoneInput(page)).toHaveCount(0);

    // Keyboard: the last card link is reached from the message box and shows a focus ring.
    await page.getByRole("textbox", { name: "即時客服訊息" }).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(more).toBeFocused();
    const ring = await more.evaluate((element) => getComputedStyle(element).boxShadow);
    expect(ring).not.toBe("none");

    await page.screenshot({ path: resolve(SHOTS, `fx11b-${width}-cards.png`) });
  });

  test(`no-match reply shows the handoff panel and a valid phone submits at ${width}px`, async ({
    page,
  }) => {
    const handoffBodies: Record<string, unknown>[] = [];
    await open(
      page,
      width,
      (route) => json(route, NO_MATCH_REPLY),
      (route, body) => {
        handoffBodies.push(body);
        return json(route, { ok: true });
      },
    );
    await ask(page, "隨便問問");

    await expect(page.getByText(COPY.noMatch, { exact: true })).toBeVisible();
    await expect(phoneInput(page)).toBeVisible();
    await phoneInput(page).fill("91234567");
    await expect(page.getByText("代理會用 +852 9123 4567 聯絡你", { exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: "同意 WhatsApp 跟進聯絡" }).click();
    await page.getByRole("button", { name: "轉介代理" }).click();

    await expect(page.getByText(COPY.handoffSuccess, { exact: true })).toBeVisible();
    expect(handoffBodies).toHaveLength(1);
    expect(handoffBodies[0]).toMatchObject({ phone: "91234567", opt_in_whatsapp: true });
    await page.screenshot({ path: resolve(SHOTS, `fx11b-${width}-handoff.png`) });
  });

  test(`server phone error still shows in role=alert at ${width}px`, async ({ page }) => {
    await open(
      page,
      width,
      (route) => json(route, NO_MATCH_REPLY),
      (route) => json(route, { code: "LIVE_AGENT_PHONE_INVALID", error: "raw" }, 400),
    );
    await ask(page, "隨便問問");
    await phoneInput(page).fill("91234567");
    await page.getByRole("button", { name: "轉介代理" }).click();

    await expect(page.getByRole("alert")).toHaveText(COPY.phoneInvalid);
    expect(await page.locator("body").innerText()).not.toContain("raw");
  });

  test(`a 200 reply with no usable text opens the handoff panel at ${width}px`, async ({
    page,
  }) => {
    await open(page, width, (route) => json(route, {}));
    await ask(page, "碧堤半島 兩房");

    await expect(page.getByText("暫時未能回答，請稍後再試。", { exact: true })).toBeVisible();
    await expect(phoneInput(page)).toBeVisible();
  });

  test(`a listings reply with no safe listing card opens the handoff panel at ${width}px`, async ({
    page,
  }) => {
    await open(page, width, (route) =>
      json(route, {
        ...LISTINGS_REPLY,
        reply: {
          ...LISTINGS_REPLY.reply,
          cards: [{ ...LISTING_CARDS[0], href: "https://evil.test/x" }],
        },
      }),
    );
    await ask(page, "碧堤半島 兩房");

    await expect(page.getByText(COPY.listings, { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("link")).toHaveCount(0);
    await expect(phoneInput(page)).toBeVisible();
    expect(await page.content()).not.toContain("evil.test");
  });

  for (const failure of ["500", "network"] as const) {
    test(`a failed send (${failure}) keeps the message and opens the handoff panel at ${width}px`, async ({
      page,
    }) => {
      await open(page, width, (route) =>
        failure === "500"
          ? json(route, { error: "Unable to answer live-agent message" }, 500)
          : route.abort("failed"),
      );
      await ask(page, "碧堤半島 兩房");

      await expect(page.getByText(COPY.offline, { exact: true })).toBeVisible();
      await expect(phoneInput(page)).toBeVisible();
      expect(await page.locator("body").innerText()).not.toContain("Unable to answer");
      // Keyboard order with the panel open: back from the message box reaches the consent box
      // (the 轉介代理 button is disabled until the phone is valid), then the phone field.
      await page.getByRole("textbox", { name: "即時客服訊息" }).focus();
      await page.keyboard.press("Shift+Tab");
      await expect(page.getByRole("checkbox", { name: "同意 WhatsApp 跟進聯絡" })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(phoneInput(page)).toBeFocused();
      if (failure === "500") {
        await page.screenshot({ path: resolve(SHOTS, `fx11b-${width}-send-failed.png`) });
      }
    });
  }
}
