import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Browser, type Page } from "@playwright/test";

const LEAD = "40000000-0000-4000-8000-000000000001";
const CONFLICT = "此客戶查詢已被其他同事更新，請重新載入後再儲存。";
const NOTE_FIELD = "內部備註（不會傳送給客戶）";
let server: Server, origin: string;

test.beforeAll(async () => {
  assert.ok(!process.env.PLAYWRIGHT_BASE_URL);
  assert.equal(
    spawnSync(process.execPath, ["scripts/browser-fixtures/build-admin-daily-work.mjs"], {
      stdio: "inherit",
    }).status,
    0,
  );
  const root = resolve(".audit/daily-work-browser");
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
});

async function openTab(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin &&
    ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort(),
  );
  await page.addInitScript(() => {
    sessionStorage.setItem("daily-work-actor", "actor-a");
    sessionStorage.setItem("daily-work-role", "manager");
  });
  await page.goto(`${origin}/admin/leads?lead=${LEAD}`);
  await expect(page.getByLabel(NOTE_FIELD, { exact: true })).toBeVisible();
  return errors;
}
const save = (page: Page) => page.getByRole("button", { name: "儲存", exact: true });
const updates = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          dailyWorkFixture: { leadUpdates: { actor: string; input: Record<string, unknown> }[] };
        }
      ).dailyWorkFixture.leadUpdates,
  );
const toastOk = (page: Page) => page.getByText("客戶查詢已更新", { exact: true });
const conflict = (page: Page) => page.getByRole("alert").filter({ hasText: CONFLICT });
async function pickAgent(page: Page, name: string) {
  await page.getByRole("combobox", { name: "負責代理" }).click();
  await page.getByRole("option", { name }).click();
}
async function twoTabs(browser: Browser) {
  const context = await browser.newContext();
  const a = await context.newPage();
  const b = await context.newPage();
  await openTab(a);
  await openTab(b);
  return { context, a, b };
}

test("two tabs: the second tab's stale save shows the zh-HK conflict message and keeps its draft", async ({
  browser,
}) => {
  const { context, a, b } = await twoTabs(browser);
  await pickAgent(a, "合成同事乙");
  await save(a).click();
  await expect(toastOk(a)).toBeVisible();

  await b.getByLabel(NOTE_FIELD, { exact: true }).fill("B 的修改");
  await save(b).click();
  await expect(conflict(b)).toBeVisible();
  await expect(b.getByLabel(NOTE_FIELD, { exact: true })).toHaveValue("B 的修改");
  await expect(b.getByText("有未儲存的修改")).toBeVisible();
  expect(await updates(b)).toHaveLength(0);
  await expect(b.getByText("跟進備註已儲存", { exact: false })).toHaveCount(0);

  for (const [width, height] of [
    [375, 812],
    [1440, 900],
  ]) {
    await b.setViewportSize({ width, height });
    await b.screenshot({ path: `.audit/remediation-20261003/fx09-lead-conflict-${width}.png` });
  }
  await context.close();
});

test("own consecutive saves both succeed and the version advances each time", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  await openTab(a);
  const versionOf = () => a.evaluate((id) => localStorage.getItem(`fx09-lead-version:${id}`), LEAD);
  await a.getByLabel(NOTE_FIELD, { exact: true }).fill("第一次");
  await save(a).click();
  await expect.poll(async () => (await updates(a)).length).toBe(1);
  await expect(toastOk(a)).toBeVisible();
  expect(await versionOf()).toBe("2026-10-03T00:00:00.000002Z");
  await a.getByLabel(NOTE_FIELD, { exact: true }).fill("第二次");
  await save(a).click();
  await expect.poll(async () => (await updates(a)).length).toBe(2);
  await expect(toastOk(a)).toHaveCount(2);
  await expect(conflict(a)).toHaveCount(0);
  expect(await versionOf()).toBe("2026-10-03T00:00:00.000003Z");
  expect((await updates(a)).map((u) => u.input.expected_version)).toEqual([
    "2026-10-03T00:00:00.000001Z",
    "2026-10-03T00:00:00.000002Z",
  ]);
  await context.close();
});

test("adding a note after a colleague saved does not launder the version", async ({ browser }) => {
  const { context, a, b } = await twoTabs(browser);
  await a.getByLabel(NOTE_FIELD, { exact: true }).fill("A 的修改");
  await pickAgent(b, "合成同事乙");
  await save(b).click();
  await expect(toastOk(b)).toBeVisible();

  await a.getByLabel("新增內部跟進紀錄", { exact: true }).fill("A 的跟進");
  await a.getByRole("button", { name: "只儲存跟進紀錄" }).click();
  await expect(a.getByText("跟進紀錄已新增")).toBeVisible();
  await save(a).click();
  await expect(conflict(a)).toBeVisible();
  await expect(a.getByLabel(NOTE_FIELD, { exact: true })).toHaveValue("A 的修改");
  expect(await updates(a)).toHaveLength(0);
  await context.close();
});

test("a pending note written before the 409 is reported as saved", async ({ browser }) => {
  const { context, a, b } = await twoTabs(browser);
  await pickAgent(a, "合成同事乙");
  await save(a).click();
  await expect(toastOk(a)).toBeVisible();
  await b.getByLabel("新增內部跟進紀錄", { exact: true }).fill("B 的待存備註");
  await b.getByLabel(NOTE_FIELD, { exact: true }).fill("B 的修改");
  await save(b).click();
  await expect(b.getByText("跟進備註已儲存", { exact: false }).first()).toBeVisible();
  await expect(conflict(b)).toBeVisible();
  await expect(b.getByLabel(NOTE_FIELD, { exact: true })).toHaveValue("B 的修改");
  await context.close();
});

test("after 重新載入最新資料 the second tab saves successfully", async ({ browser }) => {
  const { context, a, b } = await twoTabs(browser);
  await pickAgent(a, "合成同事乙");
  await save(a).click();
  await expect(toastOk(a)).toBeVisible();

  await b.getByLabel(NOTE_FIELD, { exact: true }).fill("B 的修改");
  await save(b).click();
  await expect(conflict(b)).toBeVisible();
  await b.getByRole("button", { name: "重新載入最新資料" }).click();
  await expect(conflict(b)).toHaveCount(0);
  await expect(b.getByRole("combobox", { name: "負責代理" })).toContainText("合成同事乙");

  await b.getByLabel(NOTE_FIELD, { exact: true }).fill("重新載入後");
  await save(b).click();
  await expect(toastOk(b)).toBeVisible();
  expect(await updates(b)).toHaveLength(1);
  await context.close();
});

test("switching leads while a save is in flight keeps the new lead's version", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  await openTab(a);
  await a.getByLabel("新增內部跟進紀錄", { exact: true }).fill("切換前的備註");
  await a.evaluate(
    () =>
      ((window as unknown as { dailyWorkFixture: { noteMode: string } }).dailyWorkFixture.noteMode =
        "delayed"),
  );
  await save(a).click();
  await expect
    .poll(() =>
      a.evaluate(
        () =>
          (window as unknown as { dailyWorkFixture: { mutationPending: unknown[] } })
            .dailyWorkFixture.mutationPending.length,
      ),
    )
    .toBe(1);
  // Leave lead A (discarding the guard) and open lead B while A's save is pending.
  await a.keyboard.press("Escape");
  await a.getByRole("button", { name: "放棄修改" }).click();
  await a.getByText("每日工作合成查詢1", { exact: true }).click();
  await expect(a.getByLabel(NOTE_FIELD, { exact: true })).toBeVisible();
  await a.evaluate(() =>
    (
      window as unknown as { dailyWorkFixture: { mutationPending: { release: () => void }[] } }
    ).dailyWorkFixture.mutationPending[0].release(),
  );
  await expect.poll(async () => (await updates(a)).length).toBe(1);

  await a.getByLabel(NOTE_FIELD, { exact: true }).fill("B 的修改");
  await save(a).click();
  await expect.poll(async () => (await updates(a)).length).toBe(2);
  await expect(conflict(a)).toHaveCount(0);
  expect((await updates(a))[1].input.id).toBe("40000000-0000-4000-8000-000000000002");
  await context.close();
});
