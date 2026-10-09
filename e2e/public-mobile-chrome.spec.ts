import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Locator, type Page, type Route } from "@playwright/test";

/**
 * FX-16 F-07: on phones the 問樓助手 launcher docks as a 44x44 icon into the right slot of the
 * bottom WhatsApp bar (generic and property), both bars sit at bottom-0 on the safe area, and the
 * page reserves exactly the bar's height. lg+ keeps main's floating pill. The real components
 * render from the owned live-agent fixture (`?scene=chrome|property|desktop`); every
 * /api/live-agent/* call is answered with fixed JSON and any other non-origin request is aborted.
 */

const WIDTHS = [360, 375, 390, 430] as const;
const HEIGHT = 740;
const SHOTS = resolve(".audit/remediation-20261003");
const WELCOME = "你好，我是 Earnest Property 問樓助手。想買樓、租樓、放盤估價，還是查詢屋苑資料？";

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

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

type Scene = "chrome" | "property" | "property-unavailable" | "plain";
const BAR_SCENES = ["chrome", "property"] as const;
const NO_BAR_SCENES = ["property-unavailable", "plain"] as const;

async function open(page: Page, scene: Scene, width: number, height = HEIGHT) {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width, height });
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin &&
    ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort(),
  );
  await page.route("**/api/live-agent/session", (route) =>
    json(route, { id: "00000000-0000-4000-8000-000000000111", accessToken: "fixture-token" }),
  );
  await page.route("**/api/live-agent/message", (route) =>
    json(route, { message: { message_text: "ok" }, reply: { kind: "text", text: "ok" } }),
  );
  await page.goto(`${origin}/?scene=${scene}`);
  await expect(launcher(page)).toBeEnabled();
}

const rootPadding = (page: Page) =>
  page.evaluate(() =>
    parseFloat(getComputedStyle(document.getElementById("root")!.firstElementChild!).paddingBottom),
  );

const launcher = (page: Page) => page.getByRole("button", { name: "問樓助手", exact: true });
const bar = (page: Page, scene: (typeof BAR_SCENES)[number]) =>
  page.locator(
    scene === "chrome" ? "[data-sticky-whatsapp-bar]" : "[data-property-mobile-actions]",
  );

type Box = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};
const box = (locator: Locator): Promise<Box> =>
  locator.evaluate((element) => {
    const { top, right, bottom, left, width, height } = element.getBoundingClientRect();
    return { top, right, bottom, left, width, height };
  });

/** At least 44x44, and the element (or a descendant) is what a tap at its centre hits. */
async function expectTappable(locator: Locator) {
  const result = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { width: rect.width, height: rect.height, topmost: !!hit && element.contains(hit) };
  });
  expect(result.width).toBeGreaterThanOrEqual(44);
  expect(result.height).toBeGreaterThanOrEqual(44);
  expect(result.topmost).toBe(true);
}

for (const width of WIDTHS) {
  test(`the WhatsApp link and the docked chat icon are each at least 44x44 and topmost at ${width}px`, async ({
    page,
  }) => {
    await open(page, "chrome", width);
    await expectTappable(bar(page, "chrome").getByRole("link"));
    await expectTappable(launcher(page));
    // The icon sits inside the bar's reserved right slot, not over the link.
    const link = await box(bar(page, "chrome").getByRole("link"));
    const icon = await box(launcher(page));
    expect(icon.left).toBeGreaterThanOrEqual(link.right);
    expect(width - icon.right).toBe(12);
    await page.screenshot({ path: resolve(SHOTS, `fx16-bar-${width}.png`) });
  });

  test(`the bar touches the viewport bottom and covers at most 10 % of the viewport at ${width}px`, async ({
    page,
  }) => {
    for (const scene of ["chrome", "property"] as const) {
      await open(page, scene, width);
      const rect = await box(bar(page, scene));
      expect(rect.bottom).toBe(HEIGHT);
      expect(rect.height).toBeLessThanOrEqual(HEIGHT * 0.1);
      // The page reserves exactly the bar's height: no more, no less.
      expect(await rootPadding(page)).toBe(rect.height);
    }
  });

  test(`the last footer link and the last owner-form field scroll fully above the bar at ${width}px`, async ({
    page,
  }) => {
    await open(page, "chrome", width);
    const barTop = (await box(bar(page, "chrome"))).top;
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const lastLink = page.locator("[data-footer-links] a").last();
    expect((await box(lastLink)).bottom).toBeLessThanOrEqual(barTop);

    const form = page.locator("[data-owner-form]");
    for (const target of [form.locator("input").last(), form.getByRole("button")]) {
      await page.evaluate(() => scrollTo(0, 0));
      await target.focus();
      expect((await box(target)).bottom).toBeLessThanOrEqual(barTop);
    }
  });

  test(`the docked icon opens the chat panel and closing it returns focus and the icon to the bar at ${width}px`, async ({
    page,
  }) => {
    for (const scene of BAR_SCENES) {
      await open(page, scene, width);
      const before = await box(launcher(page));
      await launcher(page).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByText(WELCOME, { exact: true })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "即時客服訊息" })).toBeFocused();
      await page.getByRole("button", { name: "關閉即時客服" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(launcher(page)).toBeFocused();
      expect(await box(launcher(page))).toEqual(before);
      await expectTappable(launcher(page));
    }
  });

  test(`a page with no bar (sold, rented, not-found or failed listing; plain page) keeps main's labelled pill and reserves nothing at ${width}px`, async ({
    page,
  }) => {
    for (const scene of NO_BAR_SCENES) {
      await open(page, scene, width);
      await expect(page.locator("[data-mobile-action-bar]")).toHaveCount(0);
      expect(await rootPadding(page)).toBe(0);
      // main's mobile pill: bottom-4 right-4, 44 px tall, rounded, label visible.
      const pill = await box(launcher(page));
      expect(width - pill.right).toBe(16);
      expect(HEIGHT - pill.bottom).toBe(16);
      expect(pill.height).toBe(44);
      expect(pill.width).toBeGreaterThan(44);
      await expect(launcher(page).getByText("問樓助手", { exact: true })).toBeVisible();
      await expectTappable(launcher(page));
      await launcher(page).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: "關閉即時客服" }).click();
      await expect(launcher(page)).toBeFocused();
      if (width === 375) {
        await page.screenshot({ path: resolve(SHOTS, `fx16-bar-${width}-${scene}.png`) });
      }
    }
  });

  test(`property bar: 致電, WhatsApp and 計月供 keep their full label with no overflow at ${width}px`, async ({
    page,
  }) => {
    await open(page, "property", width);
    const links = bar(page, "property").getByRole("link");
    await expect(links).toHaveText(["致電", "WhatsApp", "計月供"]);
    for (const link of await links.all()) {
      await expectTappable(link);
      expect(await link.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    }
    await expectTappable(launcher(page));
    const lastLink = await box(links.last());
    expect((await box(launcher(page))).left).toBeGreaterThanOrEqual(lastLink.right);
    await page.screenshot({ path: resolve(SHOTS, `fx16-bar-${width}-property.png`) });
  });

  test(`axe finds no violations in the chrome and property scenes at ${width}px`, async ({
    page,
  }) => {
    for (const scene of [...BAR_SCENES, ...NO_BAR_SCENES]) {
      await open(page, scene, width);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"])
        .analyze();
      const found = results.violations.flatMap((violation) =>
        violation.nodes.map((node) => `${scene} ${violation.id}: ${node.target.join(" ")}`),
      );
      expect(found).toEqual([]);
    }
  });
}

test("no layout shift as the bar and the docked launcher mount at 375px", async ({ page }) => {
  await open(page, "chrome", 375);
  const shift = await page.evaluate(
    () =>
      new Promise<number>((done) => {
        let total = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            total += (entry as PerformanceEntry & { value: number }).value;
          }
        }).observe({ type: "layout-shift", buffered: true });
        setTimeout(() => done(total), 500);
      }),
  );
  expect(shift).toBe(0);
});

test("docked, the loading and retry states stay perceivable (name, spinner, alert dot) at 375px", async ({
  page,
}) => {
  await open(page, "chrome", 375);
  let release: () => void = () => undefined;
  const held = new Promise<void>((done) => (release = done));
  // Registered last, so it wins over open()'s catch-all for the lazy widget chunk.
  await page.route("**/assets/LiveAgentWidget-*.js", async (route) => {
    await held;
    await route.abort();
  });
  await launcher(page).click();
  const loading = page.getByRole("button", { name: "載入中…", exact: true });
  await expect(loading).toBeVisible();
  await expect(loading.locator("svg.animate-spin")).toBeVisible();
  await expect(loading.locator("svg").first()).toBeHidden();
  release();
  const retry = page.getByRole("button", { name: "重試問樓助手", exact: true });
  await expect(retry).toBeEnabled();
  await expect(retry.locator("[data-live-agent-failed]")).toBeVisible();
  await expectTappable(retry);
  // The failed chunk is expected here; only page errors from other causes would fail the test.
  pageErrors = pageErrors.filter(
    (message) => !/LiveAgentWidget|dynamically imported/i.test(message),
  );
  await page.screenshot({ path: resolve(SHOTS, "fx16-bar-375-retry.png") });
});

test("without a bar the retry state is main's: visible label, no dot, at 375px", async ({
  page,
}) => {
  await open(page, "plain", 375);
  await page.route("**/assets/LiveAgentWidget-*.js", (route) => route.abort());
  await launcher(page).click();
  const retry = page.getByRole("button", { name: "重試問樓助手", exact: true });
  await expect(retry.getByText("重試問樓助手", { exact: true })).toBeVisible();
  await expect(retry.locator("[data-live-agent-failed]")).toBeHidden();
  pageErrors = pageErrors.filter(
    (message) => !/LiveAgentWidget|dynamically imported/i.test(message),
  );
});

test("at 1440 px no bar shows and the launcher is the pill (right 20, bottom 20, height 44, label visible) in every scene", async ({
  page,
}) => {
  let pill: Box | null = null;
  for (const scene of [...BAR_SCENES, ...NO_BAR_SCENES]) {
    await open(page, scene, 1440, 900);
    await expect(page.locator("[data-mobile-action-bar]")).toBeHidden();
    expect(await rootPadding(page)).toBe(0);
    await expect(launcher(page).getByText("問樓助手", { exact: true })).toBeVisible();
    const current = await box(launcher(page));
    expect(1440 - current.right).toBe(20);
    expect(900 - current.bottom).toBe(20);
    expect(current.height).toBe(44);
    expect(current).toEqual(pill ?? current);
    pill = current;
    const radius = await launcher(page).evaluate(
      (element) => getComputedStyle(element).borderRadius,
    );
    expect(parseFloat(radius)).toBeGreaterThan(20);
  }
  await page.screenshot({ path: resolve(SHOTS, "fx16-bar-1440.png") });
});
