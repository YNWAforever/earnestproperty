import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
let server: Server, origin: string;
const evidence: { name: string; status: string; width: number }[] = [];
const job = "40000000-0000-4000-8000-000000000001";
test.beforeAll(async () => {
  test.setTimeout(120000);
  assert.ok(!process.env.PLAYWRIGHT_BASE_URL);
  assert.equal(
    spawnSync(process.execPath, ["scripts/browser-fixtures/build-property-maintenance.mjs"], {
      stdio: "inherit",
    }).status,
    0,
  );
  const root = resolve(".audit/property-maintenance-browser");
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
    ".audit/remediation-20261003/ep13-20-ci-compat-workspace-browser-summary.json",
    JSON.stringify(
      {
        codeSha: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
        evidenceLayer: "real-route-synthetic-control-plane-owned-loopback",
        realAuth: false,
        realDatabase: false,
        realWorker: false,
        realProvider: false,
        results: evidence,
      },
      null,
      2,
    ),
  );
});
test.afterEach(async ({ page }, info) => {
  evidence.push({
    name: info.title,
    status: info.status ?? "unknown",
    width: page.viewportSize()!.width,
  });
});

test.setTimeout(20000);
test.use({ actionTimeout: 5000 });
async function openScope(page: Page, path: string, unknown = false) {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin &&
    ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort(),
  );
  await page.addInitScript((failure) => {
    sessionStorage.setItem("property-fixture-actor", "manager");
    if (failure) sessionStorage.setItem("property-fixture-staff-mode", "failure");
  }, unknown);
  await page.goto(origin + path);
}
async function changeScope(page: Page, role = "agent", binding?: string) {
  await page.evaluate(
    async ([r, b]) => window.propertyFixture.changeContext("manager", r!, b),
    [role, binding],
  );
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
}
async function release(page: Page, kind: string) {
  await page.evaluate((k) => {
    const index = window.propertyFixture.pending.findIndex((p) => p.kind === k);
    if (index < 0) throw Error("Missing owned captured promise " + k);
    window.propertyFixture.pending.splice(index, 1)[0].release();
  }, kind);
  const name = kind === "mapping-save" ? "mapping-save-return" : "retry-return";
  await expect
    .poll(() =>
      page.evaluate(
        (n) =>
          n.startsWith("mapping")
            ? window.staffFixture.calls.filter((c) => c.name === n).length
            : window.operationsFixture.calls.filter((c) => c.name === n).length,
        name,
      ),
    )
    .toBe(1);
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
}
const staffPath = "/admin/whatsapp-settings?staffId=60000000-0000-4000-8000-000000000001&step=1";
for (const width of [1440, 1280, 768, 390])
  test.describe(`${width}`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("workspace boundary: unknown membership starts no new-property directory reads", async ({
      page,
    }) => {
      await openScope(page, "/admin/listings/new", true);
      await expect(page.getByRole("button", { name: "重新檢查", exact: true })).toBeVisible();
      expect(
        await page.evaluate(() =>
          window.propertyFixture.calls.filter((c) => ["agents", "estates"].includes(c.name)),
        ),
      ).toHaveLength(0);
    });
    test("workspace boundary: new-property role change clears private unsent input", async ({
      page,
    }) => {
      await openScope(page, "/admin/listings/new");
      await page.locator("#title_zh").fill("上一工作區私人草稿");
      await changeScope(page);
      await expect(page.locator("#title_zh")).toHaveValue("");
    });
    test("workspace boundary: new-property auth renewal preserves unsent input", async ({
      page,
    }) => {
      await openScope(page, "/admin/listings/new");
      await page.locator("#title_zh").fill("同身份草稿");
      await page.evaluate(() => window.propertyFixture.refreshAuthUser());
      await expect(page.locator("#title_zh")).toHaveValue("同身份草稿");
    });
    test("workspace boundary: accepted create suppresses obsolete navigation and success toast", async ({
      page,
    }) => {
      await openScope(page, "/admin/listings/new");
      await page.locator("#listing_no").fill("OWNED-NEW");
      await page.locator("#title_zh").fill("已接納的合成新增");
      await page.evaluate(() => (window.propertyFixture.saveMode = "delayed"));
      await page.getByRole("button", { name: "建立放盤", exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(() => window.propertyFixture.pending.some((p) => p.kind === "create")),
        )
        .toBe(true);
      await changeScope(page);
      await page.evaluate(() =>
        window.propertyFixture.pending
          .splice(
            window.propertyFixture.pending.findIndex((p) => p.kind === "create"),
            1,
          )[0]
          .release(),
      );
      await expect
        .poll(() =>
          page.evaluate(
            () => window.propertyFixture.calls.filter((c) => c.name === "create-return").length,
          ),
        )
        .toBe(1);
      await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
      await expect(page.getByText("已新增", { exact: true })).toHaveCount(0);
      expect(new URL(page.url()).pathname).toBe("/admin/listings/new");
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("property-fixture-created")!).length,
        ),
      ).toBe(1);
    });
    test("workspace boundary: new-property queued uploads stop after membership changes", async ({
      page,
    }) => {
      await openScope(page, "/admin/listings/new");
      await page.evaluate(() => (window.propertyFixture.uploadMode = "delayed"));
      await page.locator("#property_images").setInputFiles([
        { name: "first.png", mimeType: "image/png", buffer: Buffer.from("owned first image") },
        { name: "second.png", mimeType: "image/png", buffer: Buffer.from("owned second image") },
      ]);
      await expect
        .poll(() =>
          page.evaluate(() => window.propertyFixture.pending.some((p) => p.kind === "upload")),
        )
        .toBe(true);
      await changeScope(page);
      await page.evaluate(() =>
        window.propertyFixture.pending
          .splice(
            window.propertyFixture.pending.findIndex((p) => p.kind === "upload"),
            1,
          )[0]
          .release(),
      );
      await expect
        .poll(() =>
          page.evaluate(
            () => window.propertyFixture.calls.filter((c) => c.name === "upload-return").length,
          ),
        )
        .toBe(1);
      await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
      expect(
        await page.evaluate(
          () => window.propertyFixture.calls.filter((c) => c.name === "upload").length,
        ),
      ).toBe(1);
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("property-fixture-accepted-uploads")!).length,
        ),
      ).toBe(1);
    });
    test("workspace boundary: unknown membership starts no operations reads", async ({ page }) => {
      await openScope(page, "/admin/operations?tab=jobs", true);
      await expect(page.getByRole("button", { name: "重新檢查", exact: true })).toBeVisible();
      expect(await page.evaluate(() => window.operationsFixture.calls)).toHaveLength(0);
    });
    test("workspace boundary: operations role narrowing clears private rows", async ({ page }) => {
      await openScope(page, "/admin/operations?tab=jobs");
      await expect(page.getByText("ai.knowledge.repair", { exact: true })).toBeVisible();
      await changeScope(page);
      await expect(page.getByText("ai.knowledge.repair", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: `重試工作 ${job}`, exact: true })).toHaveCount(
        0,
      );
    });
    test("workspace boundary: accepted retry does not continue obsolete reads or toast", async ({
      page,
    }) => {
      await openScope(page, "/admin/operations?tab=jobs");
      await expect(page.getByText("ai.knowledge.repair", { exact: true })).toBeVisible();
      await page.evaluate(() => (window.operationsFixture.mode = "deferred-command"));
      await page.getByRole("button", { name: `重試工作 ${job}`, exact: true }).click();
      await page.getByRole("button", { name: "重試", exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(() => window.propertyFixture.pending.some((p) => p.kind === "job-retry")),
        )
        .toBe(true);
      await changeScope(page);
      const before = await page.evaluate(
        () =>
          window.operationsFixture.calls.filter((c) => ["jobs", "health"].includes(c.name)).length,
      );
      await release(page, "job-retry");
      expect(
        await page.evaluate(
          () =>
            window.operationsFixture.calls.filter((c) => ["jobs", "health"].includes(c.name))
              .length,
        ),
      ).toBe(before);
      await expect(page.getByText("已重新排隊執行此工作。", { exact: true })).toHaveCount(0);
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("operations-fixture-jobs")!)[0].status,
        ),
      ).toBe("queued");
    });
    test("workspace boundary: staff role narrowing clears reviewed candidates", async ({
      page,
    }) => {
      await openScope(page, staffPath);
      await expect(page.getByRole("heading", { name: "同事接收設定", exact: true })).toBeVisible();
      await changeScope(page);
      await expect(page.getByRole("heading", { name: "同事接收設定", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "儲存已核實映射", exact: true })).toHaveCount(
        0,
      );
    });
    test("workspace boundary: accepted mapping save stops obsolete refresh", async ({ page }) => {
      await openScope(page, staffPath);
      await expect(page.getByRole("heading", { name: "同事接收設定", exact: true })).toBeVisible();
      await page
        .locator("label")
        .filter({ hasText: /^Folder 名稱/ })
        .locator("select")
        .selectOption("owned-sales");
      await page.getByRole("button", { name: "搜尋公司 Inbox 帳戶", exact: true }).click();
      await page.getByRole("radio").first().check();
      await page.getByRole("button", { name: "檢查連接", exact: true }).click();
      await expect(page.getByRole("button", { name: "儲存已核實映射", exact: true })).toBeEnabled();
      await page.evaluate(() => (window.staffFixture.submit = "save-delayed"));
      await page.getByRole("button", { name: "儲存已核實映射", exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(() =>
            window.propertyFixture.pending.some((p) => p.kind === "mapping-save"),
          ),
        )
        .toBe(true);
      await changeScope(page);
      const before = await page.evaluate(
        () =>
          window.staffFixture.calls.filter((c) => ["mapping-read", "folders"].includes(c.name))
            .length,
      );
      await release(page, "mapping-save");
      expect(
        await page.evaluate(
          () =>
            window.staffFixture.calls.filter((c) => ["mapping-read", "folders"].includes(c.name))
              .length,
        ),
      ).toBe(before);
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("staff-fixture-mapping")!)[0].version,
        ),
      ).toBe(1);
    });
    test("workspace boundary: same binding recheck preserves reviewed draft", async ({ page }) => {
      await openScope(page, staffPath);
      await expect(page.getByRole("heading", { name: "同事接收設定", exact: true })).toBeVisible();
      await page
        .locator("label")
        .filter({ hasText: /^Folder 名稱/ })
        .locator("select")
        .selectOption("owned-sales");
      await changeScope(page, "manager");
      await expect(
        page
          .locator("label")
          .filter({ hasText: /^Folder 名稱/ })
          .locator("select"),
      ).toHaveValue("owned-sales");
    });
  });
