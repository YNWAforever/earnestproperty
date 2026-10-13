import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";

export function useAdminLayoutFixture(suite: string) {
  let server: Server;
  let origin: string;
  const results: Record<string, unknown>[] = [];
  const browserErrors = new WeakMap<Page, string[]>();
  test.beforeAll(async () => {
    assert.ok(!process.env.PLAYWRIGHT_BASE_URL, "Owned fixture refuses remote targets");
    assert.equal(
      spawnSync(process.execPath, ["scripts/browser-fixtures/build-admin-layout.mjs"], {
        stdio: "inherit",
      }).status,
      0,
    );
    const root = resolve(".audit/admin-layout-browser");
    server = createServer(async (request, response) => {
      try {
        assert.ok(["GET", "HEAD"].includes(request.method ?? ""), "Unknown write rejected");
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
  test.afterEach(async ({ page }, info) => {
    expect(browserErrors.get(page) ?? []).toEqual([]);
    results.push({
      name: info.title,
      result: info.status,
      route: new URL(page.url()).pathname,
      viewport: page.viewportSize(),
      sidebarGeometry: await page.locator("aside").evaluateAll((elements) =>
        elements.map((el) => ({
          box: el.getBoundingClientRect().toJSON(),
          children: Array.from(el.children).map((child) => ({
            box: child.getBoundingClientRect().toJSON(),
            flex: getComputedStyle(child).flex,
          })),
        })),
      ),
      durationMs: info.duration,
      errors: info.errors.map((error) => error.message),
      cleanup: "browser context disposed by Playwright; no DB/provider data",
    });
  });
  test.afterAll(async () => {
    if (server) await new Promise<void>((done) => server.close(() => done()));
    await mkdir(".audit/admin-ux-20261013", { recursive: true });
    await writeFile(
      `.audit/admin-ux-20261013/${suite}.json`,
      JSON.stringify(
        {
          sha: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
          worktreeChanges: spawnSync("git", ["status", "--porcelain"], {
            encoding: "utf8",
          }).stdout.trim(),
          layer: "actual-react-routes-synthetic-auth-api-owned-loopback",
          normalAuth: false,
          realDatabase: false,
          realProvider: false,
          capturedAt: new Date().toISOString(),
          results,
        },
        null,
        2,
      ),
    );
  });
  return {
    async open(
      page: Page,
      { role = "admin", path = "/admin", width = 1280, height = 800, storageFailure = false } = {},
    ) {
      const errors: string[] = [];
      browserErrors.set(page, errors);
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height });
      await page.route("**/*", (route) =>
        new URL(route.request().url()).origin === origin &&
        ["GET", "HEAD"].includes(route.request().method())
          ? route.continue()
          : route.abort(),
      );
      await page.addInitScript(
        ({ role, storageFailure }) => {
          sessionStorage.setItem("daily-work-actor", "actor-a");
          sessionStorage.setItem("daily-work-role", role);
          sessionStorage.setItem("property-fixture-actor", role);
          sessionStorage.setItem("no-link-fixture-role", role);
          sessionStorage.setItem("sync-fixture-role", role);
          if (storageFailure) {
            const fail = () => {
              throw new DOMException("Storage denied", "SecurityError");
            };
            Object.defineProperty(window, "localStorage", { get: fail });
          }
        },
        { role, storageFailure },
      );
      await page.goto(origin + path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("後台");
    },
  };
}
