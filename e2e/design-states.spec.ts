import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";

/**
 * FX-20: every shadcn primitive in every state (rest, disabled, busy, focus, pressed, hover),
 * rendered from the real styles.css and the real SiteFooter by an owned fixture
 * (scripts/browser-fixtures/design-states). Loopback only: every other request is aborted.
 */

let server: Server, origin: string;
let pageErrors: string[] = [];

test.beforeAll(async () => {
  test.setTimeout(120000);
  assert.ok(!process.env.PLAYWRIGHT_BASE_URL);
  assert.equal(
    spawnSync(process.execPath, ["scripts/browser-fixtures/build-design-states.mjs"], {
      stdio: "inherit",
    }).status,
    0,
  );
  const root = resolve(".audit/design-states-browser");
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
          {
            ".js": "text/javascript",
            ".css": "text/css",
            ".html": "text/html",
            ".png": "image/png",
            ".webp": "image/webp",
            ".svg": "image/svg+xml",
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
  expect(pageErrors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

async function open(page: Page) {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin &&
    ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort(),
  );
  await page.goto(origin + "/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('[data-surface="dark"] footer')).toBeVisible();
}

test("the states sheet renders at 375 and 1440 px", async ({ page }) => {
  const dir = resolve(".audit/design-states-playwright");
  await mkdir(dir, { recursive: true });
  await page.setViewportSize({ width: 375, height: 900 });
  await open(page);
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: resolve(dir, `design-states-${width}.png`), fullPage: true });
  }
});
