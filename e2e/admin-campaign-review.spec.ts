import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
declare global {
  interface Window {
    noLinkBlastFixture: {
      queueMode: string;
      readFailure: boolean;
      releaseQueue: null | (() => void);
    };
    campaignReviewFixture: { changeActor: (id: string) => Promise<void> };
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
    ".audit/remediation-20261003/campaign-review-browser-summary.json",
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
      path: `.audit/remediation-20261003/campaign-overflow-${page.viewportSize()!.width}.png`,
    });
  }
  expect(fits).toBe(true);
  if (info.status === "passed" && info.title.startsWith("lost queue response")) {
    await page.screenshot({
      path: `.audit/remediation-20261003/campaign-green-${page.viewportSize()!.width}.png`,
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
for (const width of [1440, 1280, 768, 390])
  test.describe(`${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
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
