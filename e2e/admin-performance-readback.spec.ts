import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
import type { state } from "../scripts/browser-fixtures/performance-readback/synthetic-analytics";
declare global {
  interface Window {
    performanceReadbackFixture: typeof state;
  }
}
let server: Server, origin: string;
const results: { name: string; status: string; width: number }[] = [];
test.beforeAll(async () => {
  assert.ok(!process.env.PLAYWRIGHT_BASE_URL);
  assert.equal(
    spawnSync(process.execPath, ["scripts/browser-fixtures/build-admin-performance-readback.mjs"], {
      stdio: "inherit",
    }).status,
    0,
  );
  const root = resolve(".audit/performance-readback-browser");
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
    ".audit/remediation-20261003/performance-qualification-replay-browser-summary.json",
    JSON.stringify(
      {
        codeSha: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
        evidenceLayer:
          "actual-analytics-route-dashboard-table-shell-staff-store-synthetic-auth-api-owned-loopback",
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
  if (!fits)
    console.log(
      "Performance overflow",
      await page.evaluate(() => ({
        width: innerWidth,
        pageWidth: document.documentElement.scrollWidth,
      })),
    );
  expect(fits).toBe(true);
  if (info.status === "passed" && info.title.startsWith("totals"))
    await page.screenshot({
      path: `.audit/remediation-20261003/performance-replay-totals-${page.viewportSize()!.width}.png`,
    });
});
const id = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const metric = (page: Page, label: string) =>
  page.getByRole("heading", { name: label, exact: true }).locator("..").locator("..");
const records = (page: Page) => page.getByRole("region", { name: "對應記錄", exact: true });
async function open(page: Page, enabled = true, ready = true, extra = "") {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin &&
    ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort(),
  );
  await page.addInitScript((enabled) => {
    sessionStorage.setItem("no-link-fixture-actor", "manager");
    sessionStorage.setItem("performance-readback-actor", "actor-a");
    sessionStorage.setItem("analytics-fixture-enabled", String(enabled));
  }, enabled);
  await page.goto(
    origin + "/admin/analytics?start=2026-09-30&end=2026-09-30&cohortWindowDays=90" + extra,
  );
  await expect(page.getByRole("heading", { name: "營運及轉換統計", exact: true })).toBeVisible();
  if (enabled && ready) await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("4");
}
async function drill(page: Page, label = "有效查詢") {
  await metric(page, label).getByRole("button", { name: "可查看記錄", exact: true }).click();
  await expect(records(page).getByRole("table")).toBeVisible();
}
const row = (page: Page, n: number) =>
  records(page)
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: id(n), exact: true }) });
async function admin(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem("performance-readback-role", "admin"));
  await open(page);
  await drill(page);
}
async function editQuality(page: Page, n: number, quality: string, reason: string) {
  await row(page, n).getByText("修正品質", { exact: true }).click();
  await row(page, n).getByLabel("品質狀態", { exact: true }).selectOption(quality);
  await row(page, n).getByLabel("修正原因", { exact: true }).fill(reason);
}
const qualityCalls = (page: Page) =>
  page.evaluate(() => window.performanceReadbackFixture.calls.filter((c) => c.name === "quality"));
async function editQualification(page: Page, n: number, evidence: string) {
  await row(page, n).getByText("核實合格線索", { exact: true }).click();
  await row(page, n).getByLabel("核實依據", { exact: true }).fill(evidence);
}
const qualificationCalls = (page: Page) =>
  page.evaluate(() =>
    window.performanceReadbackFixture.calls.filter((c) => c.name === "qualification"),
  );
for (const width of [1440, 1280, 768, 390])
  test.describe(`${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("qualification lost commit response retries identical original input and repeated uncertainty preserves one source", async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date("2026-09-30T00:30:00Z"));
      await open(page);
      await drill(page);
      await page.evaluate(() => {
        window.performanceReadbackFixture.qualificationMode = "commit-unknown";
      });
      const evidence = "Owned original contact and requirements after lost response";
      await editQualification(page, 1, evidence);
      await row(page, 1).getByRole("button", { name: "記錄合格線索", exact: true }).click();
      await expect(records(page).getByRole("alert")).toContainText("未能核實線索");
      const original = await page.evaluate(() =>
        JSON.parse(JSON.stringify(window.performanceReadbackFixture.qualifications)),
      );
      expect(original).toHaveLength(1);
      await page.clock.setFixedTime(new Date("2026-09-30T00:45:00Z"));
      await row(page, 1).getByRole("button", { name: "記錄合格線索", exact: true }).click();
      await expect.poll(async () => (await qualificationCalls(page)).length).toBe(2);
      const attempts = await qualificationCalls(page);
      expect(attempts[1].input).toEqual(attempts[0].input);
      await expect(records(page).getByRole("alert")).toContainText("未能核實線索");
      await page.evaluate(() => {
        window.performanceReadbackFixture.qualificationMode = "ok";
      });
      await page.clock.setFixedTime(new Date("2026-09-30T01:00:00Z"));
      await row(page, 1).getByRole("button", { name: "記錄合格線索", exact: true }).click();
      await expect(row(page, 1).getByLabel("核實依據", { exact: true })).toHaveValue("");
      const final = await qualificationCalls(page);
      expect(final).toHaveLength(3);
      expect(final[2].input).toEqual(final[0].input);
      expect(await page.evaluate(() => window.performanceReadbackFixture.qualifications)).toEqual(
        original,
      );
      await expect(metric(page, "合格線索").locator("p").first()).toHaveText("0");
    });
    test("qualification lost response refuses changed evidence before another mutation", async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date("2026-09-30T00:30:00Z"));
      await open(page);
      await drill(page);
      await page.evaluate(() => {
        window.performanceReadbackFixture.qualificationMode = "commit-unknown";
      });
      await editQualification(page, 1, "Owned accepted original qualification contact evidence");
      await row(page, 1).getByRole("button", { name: "記錄合格線索", exact: true }).click();
      await expect(records(page).getByRole("alert")).toContainText("未能核實線索");
      const before = await page.evaluate(() =>
        JSON.parse(JSON.stringify(window.performanceReadbackFixture.qualifications)),
      );
      await row(page, 1)
        .getByLabel("核實依據", { exact: true })
        .fill("Owned newer replacement draft must not overwrite original request");
      await row(page, 1).getByRole("button", { name: "記錄合格線索", exact: true }).click();
      await expect(records(page).getByRole("alert")).toContainText("原核實依據");
      expect(await qualificationCalls(page)).toHaveLength(1);
      expect(await page.evaluate(() => window.performanceReadbackFixture.qualifications)).toEqual(
        before,
      );
      await expect(row(page, 1).getByLabel("核實依據", { exact: true })).toHaveValue(
        "Owned newer replacement draft must not overwrite original request",
      );
      await expect(row(page, 1).getByRole("note", { name: "上次待確認的核實依據" })).toHaveText(
        "Owned accepted original qualification contact evidence",
      );
    });
    test("qualification original request survives filter and record table remount before replay", async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date("2026-09-30T00:30:00Z"));
      await open(page);
      await drill(page);
      await page.evaluate(() => {
        window.performanceReadbackFixture.qualificationMode = "commit-unknown";
      });
      const evidence = "Owned preserved original qualification after table remount";
      await editQualification(page, 1, evidence);
      await row(page, 1).getByRole("button", { name: "記錄合格線索", exact: true }).click();
      await expect(records(page).getByRole("alert")).toContainText("未能核實線索");
      const before = await page.evaluate(() =>
        JSON.parse(JSON.stringify(window.performanceReadbackFixture.qualifications)),
      );
      await page.locator("#performance-deal").selectOption("rent");
      await page.getByRole("button", { name: "套用篩選", exact: true }).click();
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("1");
      await page.locator("#performance-deal").selectOption("");
      await page.getByRole("button", { name: "套用篩選", exact: true }).click();
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("4");
      await drill(page);
      await page.clock.setFixedTime(new Date("2026-09-30T01:00:00Z"));
      await page.evaluate(() => {
        window.performanceReadbackFixture.qualificationMode = "ok";
      });
      await row(page, 1).getByText("核實合格線索", { exact: true }).click();
      const retained = row(page, 1).getByRole("note", { name: "上次待確認的核實依據" });
      await expect(retained).toHaveText(evidence);
      // Restore from what the user can read, not a hidden fixture/test variable.
      await row(page, 1)
        .getByLabel("核實依據", { exact: true })
        .fill((await retained.textContent())!);
      await row(page, 1).getByRole("button", { name: "記錄合格線索", exact: true }).click();
      await expect(row(page, 1).getByLabel("核實依據", { exact: true })).toHaveValue("");
      const attempts = await qualificationCalls(page);
      expect(attempts).toHaveLength(2);
      expect(attempts[1].input).toEqual(attempts[0].input);
      expect(await page.evaluate(() => window.performanceReadbackFixture.qualifications)).toEqual(
        before,
      );
    });
    test("qualification definite initial refusal permits revised evidence and fresh time after eligibility repair", async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date("2026-09-30T00:30:00Z"));
      await open(page);
      await drill(page);
      await page.evaluate(() => {
        window.performanceReadbackFixture.leadStages["80000000-0000-4000-8000-000000000101"] =
          "new";
      });
      await editQualification(page, 1, "Owned initial refused requirements before actual contact");
      await row(page, 1).getByRole("button", { name: "記錄合格線索", exact: true }).click();
      await expect(records(page).getByRole("alert")).toContainText("未能核實線索");
      expect(
        await page.evaluate(() => window.performanceReadbackFixture.qualifications),
      ).toHaveLength(0);
      await page.evaluate(() => {
        window.performanceReadbackFixture.leadStages["80000000-0000-4000-8000-000000000101"] =
          "contacted";
      });
      await page.clock.setFixedTime(new Date("2026-09-30T01:00:00Z"));
      const revised = "Owned updated requirements after actual contact and eligibility repair";
      await row(page, 1).getByLabel("核實依據", { exact: true }).fill(revised);
      await row(page, 1).getByRole("button", { name: "記錄合格線索", exact: true }).click();
      await expect(row(page, 1).getByLabel("核實依據", { exact: true })).toHaveValue("");
      const attempts = await qualificationCalls(page);
      expect(attempts).toHaveLength(2);
      expect(attempts[1].input).toMatchObject({
        qualifiedAt: "2026-09-30T01:00:00.000Z",
        evidence: revised,
      });
      expect(
        await page.evaluate(() => window.performanceReadbackFixture.qualifications),
      ).toHaveLength(1);
    });
    test("qualification later authority denial retains earlier uncertain original request for recovery", async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date("2026-09-30T00:30:00Z"));
      await open(page);
      await drill(page);
      await page.evaluate(() => {
        window.performanceReadbackFixture.qualificationMode = "commit-unknown";
      });
      await editQualification(
        page,
        1,
        "Owned uncertain accepted qualification before later authority denial",
      );
      await row(page, 1).getByRole("button", { name: "記錄合格線索", exact: true }).click();
      await expect(records(page).getByRole("alert")).toContainText("未能核實線索");
      const before = await page.evaluate(() =>
        JSON.parse(JSON.stringify(window.performanceReadbackFixture.qualifications)),
      );
      await page.evaluate(() => {
        window.performanceReadbackFixture.qualificationMode = "replay-denied";
      });
      await page.clock.setFixedTime(new Date("2026-09-30T00:45:00Z"));
      await row(page, 1).getByRole("button", { name: "記錄合格線索", exact: true }).click();
      await expect.poll(async () => (await qualificationCalls(page)).length).toBe(2);
      await expect(records(page).getByRole("alert")).toContainText("未能核實線索");
      await row(page, 1)
        .getByLabel("核實依據", { exact: true })
        .fill("Owned newer draft must remain after denial during recovery");
      await row(page, 1).getByRole("button", { name: "記錄合格線索", exact: true }).click();
      await expect(records(page).getByRole("alert")).toContainText("原核實依據");
      expect(await qualificationCalls(page)).toHaveLength(2);
      await expect(row(page, 1).getByLabel("核實依據", { exact: true })).toHaveValue(
        "Owned newer draft must remain after denial during recovery",
      );
      const retained = row(page, 1).getByRole("note", { name: "上次待確認的核實依據" });
      await expect(retained).toHaveText(before[0].evidence);
      await row(page, 1)
        .getByLabel("核實依據", { exact: true })
        .fill((await retained.textContent())!);
      await page.evaluate(() => {
        window.performanceReadbackFixture.qualificationMode = "ok";
      });
      await page.clock.setFixedTime(new Date("2026-09-30T01:00:00Z"));
      await row(page, 1).getByRole("button", { name: "記錄合格線索", exact: true }).click();
      await expect(row(page, 1).getByLabel("核實依據", { exact: true })).toHaveValue("");
      const final = await qualificationCalls(page);
      expect(final).toHaveLength(3);
      expect(final[1].input).toEqual(final[0].input);
      expect(final[2].input).toEqual(final[0].input);
      expect(await page.evaluate(() => window.performanceReadbackFixture.qualifications)).toEqual(
        before,
      );
    });
    test("qualification creates unknown evidence before explicit quality review and reconciles unique lead CSV", async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date("2026-09-30T00:30:00Z"));
      await admin(page);
      await editQualification(page, 1, "        ");
      await row(page, 1).getByRole("button", { name: "記錄合格線索", exact: true }).click();
      await expect(records(page).getByRole("alert")).toHaveText("請提供至少 8 個字的核實依據。");
      expect(await qualificationCalls(page)).toHaveLength(0);
      await row(page, 1)
        .getByLabel("核實依據", { exact: true })
        .fill("  Owned verified requirements and actual contact  ");
      await row(page, 1).getByRole("button", { name: "記錄合格線索", exact: true }).click();
      await expect(page.getByRole("button", { name: "未知跟進事件 1", exact: true })).toBeVisible();
      await expect(metric(page, "合格線索").locator("p").first()).toHaveText("0");
      expect(await qualificationCalls(page)).toHaveLength(1);
      expect(
        await page.evaluate(() => window.performanceReadbackFixture.qualifications),
      ).toMatchObject([
        {
          leadId: id(101),
          evidence: "Owned verified requirements and actual contact",
          actor: "actor-a",
        },
      ]);
      await page.getByRole("button", { name: "未知跟進事件 1", exact: true }).click();
      const key = `lead_qualified:${id(101)}`;
      const eventRow = records(page)
        .getByRole("row")
        .filter({ has: page.getByRole("rowheader", { name: key, exact: true }) });
      await eventRow.getByText("修正品質", { exact: true }).click();
      await eventRow.getByLabel("品質狀態", { exact: true }).selectOption("production");
      await eventRow
        .getByLabel("修正原因", { exact: true })
        .fill("Owned explicit review of genuine qualification evidence");
      await eventRow.getByRole("button", { name: "儲存修正", exact: true }).click();
      await expect(metric(page, "合格線索").locator("p").first()).toHaveText("1");
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("4");
      await drill(page, "合格線索");
      await expect(records(page).getByRole("row")).toHaveCount(2);
      const downloading = page.waitForEvent("download");
      await records(page).getByRole("button", { name: "匯出本頁 CSV", exact: true }).click();
      const csv = await readFile((await (await downloading).path())!, "utf8");
      expect(csv).toContain(key);
      expect(csv.replace(/^\uFEFF/, "").split(/\r?\n/)).toHaveLength(2);
      expect(csv).not.toContain(id(4));
      await page.screenshot({
        path: `.audit/remediation-20261003/performance-replay-confirmed-${width}.png`,
      });
      await page.reload();
      await expect(metric(page, "合格線索").locator("p").first()).toHaveText("1");
      await drill(page, "合格線索");
      await expect(records(page).getByRole("row")).toHaveCount(2);
      expect(await qualificationCalls(page)).toHaveLength(0);
      await page.getByRole("tab", { name: "回覆及跟進", exact: true }).click();
      await expect(metric(page, "已確認分配").locator("p").first()).toHaveText("1");
      await expect(metric(page, "首回覆中位數").locator("p").first()).toHaveText("15 分鐘");
      await expect(metric(page, "未回覆").locator("p").first()).toHaveText("3");
    });
    test("qualification duplicate explicit submission preserves the original evidence and one event", async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date("2026-09-30T00:30:00Z"));
      await open(page);
      await drill(page);
      await editQualification(page, 1, "Owned original immutable qualification evidence");
      await row(page, 1).getByRole("button", { name: "記錄合格線索", exact: true }).click();
      await expect(page.getByRole("button", { name: "未知跟進事件 1", exact: true })).toBeVisible();
      await row(page, 1)
        .getByLabel("核實依據", { exact: true })
        .fill("Owned later reason cannot overwrite original evidence");
      await row(page, 1).getByRole("button", { name: "記錄合格線索", exact: true }).click();
      await expect(records(page).getByRole("alert")).toContainText("未能核實線索");
      await expect(row(page, 1).getByLabel("核實依據", { exact: true })).toHaveValue(
        "Owned later reason cannot overwrite original evidence",
      );
      expect(await qualificationCalls(page)).toHaveLength(2);
      expect(
        await page.evaluate(() => window.performanceReadbackFixture.qualifications),
      ).toMatchObject([{ evidence: "Owned original immutable qualification evidence" }]);
      expect(
        await page.evaluate(() => window.performanceReadbackFixture.qualifications.length),
      ).toBe(1);
      await expect(metric(page, "合格線索").locator("p").first()).toHaveText("0");
      await expect(records(page).getByText("修正品質", { exact: true })).toHaveCount(0);
    });
    test("qualification pending write preserves a newer quality editor and serializes submission", async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date("2026-09-30T00:30:00Z"));
      await admin(page);
      await page.evaluate(() => {
        window.performanceReadbackFixture.qualificationMode = "delayed";
      });
      await editQualification(page, 1, "Owned pending genuine qualification evidence");
      await row(page, 1).getByRole("button", { name: "記錄合格線索", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => window.performanceReadbackFixture.pending.length))
        .toBe(1);
      const reason = "Owned newer quality editor stays visible and unchanged";
      await editQuality(page, 2, "spam", reason);
      await expect(
        row(page, 2).getByRole("button", { name: "儲存修正", exact: true }),
      ).toBeDisabled();
      await row(page, 2).getByLabel("修正原因", { exact: true }).press("Enter");
      expect(await qualityCalls(page)).toHaveLength(0);
      await page.evaluate(() => window.performanceReadbackFixture.pending.shift()!.release());
      await expect(
        row(page, 2).getByRole("button", { name: "儲存修正", exact: true }),
      ).toBeEnabled();
      await expect(row(page, 2).getByLabel("修正原因", { exact: true })).toBeVisible();
      await expect(row(page, 2).getByLabel("修正原因", { exact: true })).toHaveValue(reason);
      await row(page, 2).getByRole("button", { name: "儲存修正", exact: true }).click();
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("3");
      expect(await qualityCalls(page)).toHaveLength(1);
      expect(await qualificationCalls(page)).toHaveLength(1);
    });
    test("qualification late completion refreshes the currently selected rent scope", async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date("2026-09-30T00:30:00Z"));
      await open(page);
      await drill(page);
      await page.evaluate(() => {
        window.performanceReadbackFixture.qualificationMode = "delayed";
      });
      await editQualification(page, 1, "Owned original sale lead qualification evidence");
      await row(page, 1).getByRole("button", { name: "記錄合格線索", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => window.performanceReadbackFixture.pending.length))
        .toBe(1);
      await page.locator("#performance-deal").selectOption("rent");
      await page.getByRole("button", { name: "套用篩選", exact: true }).click();
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("1");
      await drill(page);
      await page.evaluate(() => window.performanceReadbackFixture.pending.shift()!.release());
      await expect
        .poll(() => page.evaluate(() => window.performanceReadbackFixture.qualifications.length))
        .toBe(1);
      await expect(records(page).getByRole("row")).toHaveCount(2);
      await expect(records(page)).toContainText(id(2));
      await expect(records(page)).not.toContainText(id(1));
      await expect(metric(page, "合格線索").locator("p").first()).toHaveText("0");
      expect(
        await page.evaluate(
          () =>
            window.performanceReadbackFixture.calls.filter((c) => c.name === "records").at(-1)!
              .input,
        ),
      ).toMatchObject({ dealType: "rent" });
    });
    test("qualification definite refusal retains evidence and explicit retry uses the same lead", async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date("2026-09-30T00:30:00Z"));
      await open(page);
      await drill(page);
      await page.evaluate(() => {
        window.performanceReadbackFixture.qualificationMode = "failure";
      });
      const evidence = "Owned retained manual requirements and contact evidence";
      await editQualification(page, 1, evidence);
      await row(page, 1).getByRole("button", { name: "記錄合格線索", exact: true }).click();
      await expect(records(page).getByRole("alert")).toContainText("未能核實線索");
      await expect(row(page, 1).getByLabel("核實依據", { exact: true })).toHaveValue(evidence);
      expect(
        await page.evaluate(() => window.performanceReadbackFixture.qualifications.length),
      ).toBe(0);
      await page.evaluate(() => {
        window.performanceReadbackFixture.qualificationMode = "ok";
      });
      await row(page, 1).getByRole("button", { name: "記錄合格線索", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => window.performanceReadbackFixture.qualifications.length))
        .toBe(1);
      expect(await qualificationCalls(page)).toHaveLength(2);
    });
    test("qualification completion after actor change never reads or displays the previous workspace", async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date("2026-09-30T00:30:00Z"));
      await open(page);
      await drill(page);
      await page.evaluate(() => {
        window.performanceReadbackFixture.qualificationMode = "delayed";
      });
      await editQualification(page, 1, "Owned previous actor qualification evidence");
      await row(page, 1).getByRole("button", { name: "記錄合格線索", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => window.performanceReadbackFixture.pending.length))
        .toBe(1);
      await page.evaluate(() => window.performanceReadbackFixture.changeContext("actor-b"));
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("1");
      await drill(page);
      const count = await page.evaluate(
        () =>
          window.performanceReadbackFixture.calls.filter((c) =>
            ["report", "records", "options"].includes(c.name),
          ).length,
      );
      await page.evaluate(() => window.performanceReadbackFixture.pending.shift()!.release());
      await expect
        .poll(() => page.evaluate(() => window.performanceReadbackFixture.qualifications.length))
        .toBe(1);
      expect(
        await page.evaluate(
          () =>
            window.performanceReadbackFixture.calls.filter((c) =>
              ["report", "records", "options"].includes(c.name),
            ).length,
        ),
      ).toBe(count);
      await expect(records(page)).toContainText(id(91));
      await expect(records(page)).not.toContainText(id(1));
      await expect(metric(page, "合格線索").locator("p").first()).toHaveText("0");
    });
    test("quality committed correction refreshes the same denominator records and CSV", async ({
      page,
    }) => {
      await admin(page);
      await editQuality(page, 1, "test", "        ");
      await row(page, 1).getByRole("button", { name: "儲存修正", exact: true }).click();
      await expect(records(page).getByRole("alert")).toHaveText("修正原因最少 8 個字。");
      expect(await qualityCalls(page)).toHaveLength(0);
      await row(page, 1)
        .getByLabel("修正原因", { exact: true })
        .fill("Owned verified test inquiry");
      await row(page, 1).getByRole("button", { name: "儲存修正", exact: true }).click();
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("3");
      await expect(records(page).getByRole("row")).toHaveCount(4);
      await expect(row(page, 1)).toHaveCount(0);
      expect(await qualityCalls(page)).toHaveLength(1);
      const download = page.waitForEvent("download");
      await records(page).getByRole("button", { name: "匯出本頁 CSV", exact: true }).click();
      const csv = await readFile((await (await download).path())!, "utf8");
      expect(csv).not.toContain(id(1));
      for (const n of [2, 3, 4]) expect(csv).toContain(id(n));
      expect(csv.replace(/^\uFEFF/, "").split(/\r?\n/)).toHaveLength(4);
      await page.screenshot({
        path: `.audit/remediation-20261003/performance-replay-quality-confirmed-${width}.png`,
      });
      await page.reload();
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("3");
      await drill(page);
      await expect(records(page).getByRole("row")).toHaveCount(4);
      expect(await qualityCalls(page)).toHaveLength(0);
    });
    test("quality pending completion preserves the later manual reason in another row", async ({
      page,
    }) => {
      await admin(page);
      await page.evaluate(() => {
        window.performanceReadbackFixture.qualityMode = "delayed";
      });
      await editQuality(page, 1, "test", "Owned first correction evidence");
      await row(page, 1).getByRole("button", { name: "儲存修正", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => window.performanceReadbackFixture.pending.length))
        .toBe(1);
      await editQuality(page, 2, "spam", "Later manual correction must survive");
      await page.evaluate(() => window.performanceReadbackFixture.pending.shift()!.release());
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("3");
      await expect(row(page, 2).getByLabel("修正原因", { exact: true })).toHaveValue(
        "Later manual correction must survive",
      );
      await expect(row(page, 2).getByLabel("品質狀態", { exact: true })).toHaveValue("spam");
      expect(await qualityCalls(page)).toHaveLength(1);
    });
    test("quality concurrent row submission waits for the pending correction without losing its draft", async ({
      page,
    }) => {
      await admin(page);
      await page.evaluate(() => {
        window.performanceReadbackFixture.qualityMode = "delayed";
      });
      await editQuality(page, 1, "test", "Owned first in flight correction");
      await row(page, 1).getByRole("button", { name: "儲存修正", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => window.performanceReadbackFixture.pending.length))
        .toBe(1);
      await editQuality(page, 2, "spam", "Owned later draft remains editable");
      await expect(
        row(page, 2).getByRole("button", { name: "儲存修正", exact: true }),
      ).toBeDisabled();
      await row(page, 2).getByLabel("修正原因", { exact: true }).press("Enter");
      expect(await qualityCalls(page)).toHaveLength(1);
      await page.evaluate(() => window.performanceReadbackFixture.pending.shift()!.release());
      await expect(
        row(page, 2).getByRole("button", { name: "儲存修正", exact: true }),
      ).toBeEnabled();
      await expect(row(page, 2).getByLabel("修正原因", { exact: true })).toHaveValue(
        "Owned later draft remains editable",
      );
    });
    test("quality newer draft stays visible and submits unchanged after delayed records readback", async ({
      page,
    }) => {
      await admin(page);
      await page.evaluate(() => {
        window.performanceReadbackFixture.qualityMode = "delayed";
      });
      await editQuality(page, 1, "test", "Owned original correction before readback");
      await row(page, 1).getByRole("button", { name: "儲存修正", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => window.performanceReadbackFixture.pending.length))
        .toBe(1);
      const evidence = "Later visible draft must be submitted unchanged";
      await editQuality(page, 2, "spam", evidence);
      await page.evaluate(() => {
        window.performanceReadbackFixture.recordsMode = "delayed";
        window.performanceReadbackFixture.pending.shift()!.release();
      });
      await expect(records(page).getByRole("status")).toBeVisible();
      await expect(row(page, 2)).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => window.performanceReadbackFixture.pending.length))
        .toBe(1);
      await page.evaluate(() => {
        window.performanceReadbackFixture.recordsMode = "ok";
        window.performanceReadbackFixture.pending.shift()!.release();
        window.performanceReadbackFixture.qualityMode = "ok";
      });
      const reason = row(page, 2).getByLabel("修正原因", { exact: true });
      await expect(reason).toBeVisible();
      await expect(reason).toHaveValue(evidence);
      await expect(row(page, 2).getByLabel("品質狀態", { exact: true })).toHaveValue("spam");
      await row(page, 2).getByText("修正品質", { exact: true }).click();
      await expect(reason).not.toBeVisible();
      await row(page, 2).getByText("修正品質", { exact: true }).click();
      await expect(reason).toBeVisible();
      await expect(reason).toHaveValue(evidence);
      await expect(row(page, 2).getByLabel("品質狀態", { exact: true })).toHaveValue("spam");
      await row(page, 2).getByRole("button", { name: "儲存修正", exact: true }).click();
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("2");
      await expect(records(page).getByRole("row")).toHaveCount(3);
      const calls = await qualityCalls(page);
      expect(calls).toHaveLength(2);
      expect(calls[1].input).toEqual({
        kind: "inquiry",
        key: id(2),
        quality: "spam",
        reason: evidence,
      });
    });
    test("quality late completion cannot reopen an old filter or restore old CSV rows", async ({
      page,
    }) => {
      await admin(page);
      await page.evaluate(() => {
        window.performanceReadbackFixture.qualityMode = "delayed";
      });
      await editQuality(page, 1, "test", "Owned old filter correction evidence");
      await row(page, 1).getByRole("button", { name: "儲存修正", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => window.performanceReadbackFixture.pending.length))
        .toBe(1);
      await page.locator("#performance-deal").selectOption("rent");
      await page.getByRole("button", { name: "套用篩選", exact: true }).click();
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("1");
      await drill(page);
      await expect(records(page).getByRole("row")).toHaveCount(2);
      const callsBefore = await page.evaluate(
        () => window.performanceReadbackFixture.calls.filter((c) => c.name === "records").length,
      );
      await page.evaluate(() => window.performanceReadbackFixture.pending.shift()!.release());
      await expect
        .poll(() => page.evaluate(() => window.performanceReadbackFixture.qualityRevisions.length))
        .toBe(1);
      await page.waitForTimeout(150);
      expect(
        await page.evaluate(
          () =>
            window.performanceReadbackFixture.calls.filter((c) => c.name === "records").slice(-1)[0]
              .input,
        ),
      ).toMatchObject({ dealType: "rent" });
      expect(
        await page.evaluate(
          () => window.performanceReadbackFixture.calls.filter((c) => c.name === "records").length,
        ),
      ).toBe(callsBefore + 1);
      await expect(records(page).getByRole("row")).toHaveCount(2);
      const download = page.waitForEvent("download");
      await records(page).getByRole("button", { name: "匯出本頁 CSV", exact: true }).click();
      const csv = await readFile((await (await download).path())!, "utf8");
      expect(csv).toContain(id(2));
      for (const n of [1, 3, 4]) expect(csv).not.toContain(id(n));
    });
    test("quality refused write retains original manual evidence for explicit retry", async ({
      page,
    }) => {
      await admin(page);
      await page.evaluate(() => {
        window.performanceReadbackFixture.qualityMode = "failure";
      });
      await editQuality(page, 1, "test", "Owned retained correction evidence");
      await row(page, 1).getByRole("button", { name: "儲存修正", exact: true }).click();
      await expect(records(page).getByRole("alert")).toHaveText("未能儲存品質修正，請重試。");
      await expect(row(page, 1).getByLabel("修正原因", { exact: true })).toHaveValue(
        "Owned retained correction evidence",
      );
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("4");
      expect(
        await page.evaluate(() => window.performanceReadbackFixture.qualityRevisions.length),
      ).toBe(0);
      await page.evaluate(() => {
        window.performanceReadbackFixture.qualityMode = "ok";
      });
      await row(page, 1).getByRole("button", { name: "儲存修正", exact: true }).click();
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("3");
      expect(await qualityCalls(page)).toHaveLength(2);
      expect(
        await page.evaluate(() => window.performanceReadbackFixture.qualityRevisions.length),
      ).toBe(1);
    });
    test("quality delayed refusal cannot attach an old row error to the newer editor", async ({
      page,
    }) => {
      await admin(page);
      await page.evaluate(() => {
        window.performanceReadbackFixture.qualityMode = "delayed-failure";
      });
      await editQuality(page, 1, "test", "Owned refused original row evidence");
      await row(page, 1).getByRole("button", { name: "儲存修正", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => window.performanceReadbackFixture.pending.length))
        .toBe(1);
      await editQuality(page, 2, "spam", "Newer manual evidence remains valid");
      await page.evaluate(() => window.performanceReadbackFixture.pending.shift()!.release());
      await expect(
        row(page, 2).getByRole("button", { name: "儲存修正", exact: true }),
      ).toBeEnabled();
      await expect(records(page).getByRole("alert")).toHaveCount(0);
      await expect(row(page, 2).getByLabel("修正原因", { exact: true })).toHaveValue(
        "Newer manual evidence remains valid",
      );
      expect(
        await page.evaluate(() => window.performanceReadbackFixture.qualityRevisions.length),
      ).toBe(0);
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("4");
    });
    test("quality response event correction restores a known response without changing assignment or inquiries", async ({
      page,
    }) => {
      const key = `human_response:${id(2)}`;
      await page.addInitScript(
        (key) =>
          sessionStorage.setItem(
            "performance-quality-revisions",
            JSON.stringify([
              {
                kind: "event",
                key,
                quality: "test",
                reason: "Owned seed test response",
                actor: "actor-a",
              },
            ]),
          ),
        key,
      );
      await admin(page);
      await page.getByRole("button", { name: "測試跟進 1", exact: true }).click();
      const eventRow = records(page)
        .getByRole("row")
        .filter({ has: page.getByRole("rowheader", { name: key, exact: true }) });
      await eventRow.getByText("修正品質", { exact: true }).click();
      await eventRow.getByLabel("品質狀態", { exact: true }).selectOption("production");
      await eventRow
        .getByLabel("修正原因", { exact: true })
        .fill("Owned verified actual response event");
      await eventRow.getByRole("button", { name: "儲存修正", exact: true }).click();
      await expect(records(page)).toContainText("這項指標目前沒有可顯示的記錄。");
      const calls = await qualityCalls(page);
      expect(calls).toHaveLength(1);
      expect(calls[0].input).toMatchObject({
        kind: "event",
        key: `human_response:${id(2)}`,
        quality: "production",
      });
      await page.getByRole("tab", { name: "回覆及跟進", exact: true }).click();
      await expect(metric(page, "已確認分配").locator("p").first()).toHaveText("1");
      await expect(metric(page, "首回覆中位數").locator("p").first()).toContainText("15");
      await expect(metric(page, "未回覆").locator("p").first()).toHaveText("3");
      await page.getByRole("tab", { name: "新增與轉換", exact: true }).click();
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("4");
    });
    test("quality admin response after actor change starts no new read for the old workspace", async ({
      page,
    }) => {
      await admin(page);
      await page.evaluate(() => {
        window.performanceReadbackFixture.qualityMode = "delayed";
      });
      await editQuality(page, 1, "test", "Owned old actor correction evidence");
      await row(page, 1).getByRole("button", { name: "儲存修正", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => window.performanceReadbackFixture.pending.length))
        .toBe(1);
      await page.evaluate(() =>
        window.performanceReadbackFixture.changeContext("actor-b", "staff-b", "manager"),
      );
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("1");
      const before = await page.evaluate(() => window.performanceReadbackFixture.calls.length);
      await page.evaluate(() => window.performanceReadbackFixture.pending.shift()!.release());
      await page.waitForTimeout(100);
      expect(await page.evaluate(() => window.performanceReadbackFixture.calls.length)).toBe(
        before,
      );
      await drill(page);
      await expect(records(page).getByText("修正品質", { exact: true })).toHaveCount(0);
      await expect(records(page)).toContainText(id(91));
    });
    test("actor switch clears old report records and export before new scoped read", async ({
      page,
    }) => {
      await open(page);
      await drill(page);
      await page.evaluate(() => window.performanceReadbackFixture.changeContext("actor-b"));
      await expect(page.getByRole("button", { name: "匯出本頁 CSV", exact: true })).toHaveCount(0);
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("1");
      await expect(page.locator("#performance-branch")).toContainText("合成分行乙");
      await expect(page.locator("#performance-branch")).not.toContainText("合成分行甲");
      await drill(page);
      await expect(records(page).getByRole("row")).toHaveCount(2);
      await expect(records(page)).toContainText(id(91));
      await expect(records(page)).not.toContainText(id(1));
    });
    test("same-user staff binding change refetches report and options", async ({ page }) => {
      await open(page);
      await page.evaluate(() =>
        window.performanceReadbackFixture.changeContext("actor-a", "staff-b"),
      );
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("1");
      await expect(page.locator("#performance-staff")).toContainText("合成同事乙");
      expect(
        await page.evaluate(
          () =>
            window.performanceReadbackFixture.calls.filter(
              (c) => c.name === "report" && c.binding === "staff-b",
            ).length,
        ),
      ).toBeGreaterThan(0);
    });
    test("late old-actor report cannot restore old company metrics", async ({ page }) => {
      await page.addInitScript(() => sessionStorage.setItem("performance-delayed-initial", "true"));
      await open(page, true, false);
      await expect
        .poll(() => page.evaluate(() => window.performanceReadbackFixture.pending.length))
        .toBe(1);
      await page.evaluate(() => {
        window.performanceReadbackFixture.reportMode = "ok";
        return window.performanceReadbackFixture.changeContext("actor-b");
      });
      await page.evaluate(() => window.performanceReadbackFixture.pending.shift()!.release());
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("1");
    });
    test("late old-actor record reply cannot restore old rows or export", async ({ page }) => {
      await open(page);
      await page.evaluate(() => {
        window.performanceReadbackFixture.recordsMode = "delayed";
      });
      await metric(page, "有效查詢")
        .getByRole("button", { name: "可查看記錄", exact: true })
        .click();
      await expect
        .poll(() => page.evaluate(() => window.performanceReadbackFixture.pending.length))
        .toBe(1);
      await page.evaluate(() => {
        window.performanceReadbackFixture.recordsMode = "ok";
        return window.performanceReadbackFixture.changeContext("actor-b");
      });
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("1");
      await page.evaluate(() => window.performanceReadbackFixture.pending.shift()!.release());
      await expect(records(page)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "匯出本頁 CSV", exact: true })).toHaveCount(0);
      await drill(page);
      await expect(records(page)).toContainText(id(91));
      await expect(records(page)).not.toContainText(id(1));
    });
    test("same-user role downgrade clears report and makes no denied performance reads", async ({
      page,
    }) => {
      await open(page);
      await drill(page);
      const count = await page.evaluate(
        () =>
          window.performanceReadbackFixture.calls.filter((c) =>
            ["report", "options", "records"].includes(c.name),
          ).length,
      );
      await page.evaluate(() =>
        window.performanceReadbackFixture.changeContext("actor-a", "staff-a", "agent"),
      );
      await expect(
        page.getByRole("alert").filter({ hasText: "需要管理員或主管權限" }),
      ).toBeVisible();
      await expect(metric(page, "有效查詢")).toHaveCount(0);
      await expect(records(page)).toHaveCount(0);
      expect(
        await page.evaluate(
          () =>
            window.performanceReadbackFixture.calls.filter((c) =>
              ["report", "options", "records"].includes(c.name),
            ).length,
        ),
      ).toBe(count);
      await page.evaluate(() => window.performanceReadbackFixture.changeContext("actor-a"));
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("4");
    });
    test("invalid URL filters block report reads until explicit reset", async ({ page }) => {
      await open(page, true, false, "&branchId=invalid-scope");
      await expect(
        page.getByRole("alert").filter({ hasText: "網址中的績效篩選無效" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => window.performanceReadbackFixture.calls.filter((c) => c.name === "report").length,
        ),
      ).toBe(0);
      await page.getByRole("button", { name: "清除網址篩選", exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(
            () => window.performanceReadbackFixture.calls.filter((c) => c.name === "report").length,
          ),
        )
        .toBeGreaterThan(0);
      await expect(page.getByRole("alert").filter({ hasText: "網址中的績效篩選無效" })).toHaveCount(
        0,
      );
    });
    test("totals drilldown and visible CSV reconcile quality duplicate and HK day", async ({
      page,
    }) => {
      await open(page);
      await expect(metric(page, "唯一客戶").locator("p").first()).toHaveText("未有足夠資料");
      await expect(metric(page, "30／90 日成交轉換")).toContainText("25%");
      await expect(metric(page, "30／90 日成交轉換")).toContainText("分母 4");
      await expect(page.getByText(/更新於.*9:00/)).toBeVisible();
      await expect(metric(page, "有效查詢")).toHaveAttribute("title", /production/);
      await drill(page);
      await expect(records(page).getByRole("row")).toHaveCount(5);
      for (const n of [1, 2, 3, 4]) await expect(records(page)).toContainText(id(n));
      for (const n of [5, 6, 7, 8]) await expect(records(page)).not.toContainText(id(n));
      const download = page.waitForEvent("download");
      await records(page).getByRole("button", { name: "匯出本頁 CSV", exact: true }).click();
      const saved = await download,
        csv = await readFile((await saved.path())!, "utf8");
      expect(csv.replace(/^\uFEFF/, "").split(/\r?\n/)).toHaveLength(5);
      for (const n of [1, 2, 3, 4]) expect(csv).toContain(id(n));
      for (const n of [5, 6, 7, 8]) expect(csv).not.toContain(id(n));
      expect(saved.suggestedFilename()).toBe("performance-visible-page.csv");
    });
    test("unknown click denominator stays unknown and assignments do not count as human replies", async ({
      page,
    }) => {
      await open(page);
      await page.getByRole("tab", { name: "來源證據", exact: true }).click();
      await expect(metric(page, "28Hse 訊息來源").locator("p").first()).toHaveText("1");
      await expect(metric(page, "有追蹤開啟證據的查詢").locator("p").first()).toHaveText("1");
      await expect(metric(page, "來源未核實").locator("p").first()).toHaveText("2");
      await expect(metric(page, "點擊至查詢比率")).toContainText("未有足夠資料");
      await expect(metric(page, "點擊至查詢比率")).not.toContainText("0%");
      await expect(metric(page, "點擊至查詢比率").getByRole("button")).toHaveCount(0);
      await page.getByRole("tab", { name: "回覆及跟進", exact: true }).click();
      await expect(metric(page, "已確認分配").locator("p").first()).toHaveText("1");
      await expect(metric(page, "首回覆中位數").locator("p").first()).toHaveText("15 分鐘");
      await expect(metric(page, "未回覆").locator("p").first()).toHaveText("3");
      await drill(page, "首回覆中位數");
      await expect(records(page).getByRole("row")).toHaveCount(2);
      await expect(records(page)).toContainText(id(2));
    });
    test("source and rent filters retain same scope across reload and sales stay distinct", async ({
      page,
    }) => {
      await open(page);
      await page.getByRole("tab", { name: "成交及佣金", exact: true }).click();
      await expect(metric(page, "已核實成交").locator("p").first()).toHaveText("2");
      await expect(metric(page, "買賣成交額").locator("p").first()).toHaveText("HK$10,000,000.00");
      await page.getByRole("tab", { name: "新增與轉換", exact: true }).click();
      await page.locator("#performance-source").selectOption("28hse");
      await page.getByRole("button", { name: "套用篩選", exact: true }).click();
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("1");
      await page.reload();
      await expect(page.locator("#performance-source")).toHaveValue("28hse");
      await drill(page);
      await expect(records(page).getByRole("row")).toHaveCount(2);
      await expect(records(page)).toContainText(id(1));
      await page.locator("#performance-source").selectOption("whatsapp");
      await page.locator("#performance-deal").selectOption("rent");
      await page.getByRole("button", { name: "套用篩選", exact: true }).click();
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("1");
      await drill(page);
      await expect(records(page)).toContainText(id(2));
      await expect(records(page)).not.toContainText(id(1));
    });
    test("failed filtered report and drilldown never export previous rows or invent zero", async ({
      page,
    }) => {
      await open(page);
      await drill(page);
      await page.evaluate(() => {
        window.performanceReadbackFixture.reportMode = "failure";
      });
      await page.locator("#performance-source").selectOption("28hse");
      await page.getByRole("button", { name: "套用篩選", exact: true }).click();
      await expect(page.getByRole("alert").filter({ hasText: "未能載入績效" })).toBeVisible();
      await expect(metric(page, "有效查詢")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "匯出本頁 CSV", exact: true })).toHaveCount(0);
      await page.evaluate(() => {
        window.performanceReadbackFixture.reportMode = "ok";
      });
      await page.locator("#performance-source").selectOption("whatsapp");
      await page.getByRole("button", { name: "套用篩選", exact: true }).click();
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("3");
      await drill(page);
      await page.evaluate(() => {
        window.performanceReadbackFixture.recordsMode = "failure";
      });
      await metric(page, "有效查詢")
        .getByRole("button", { name: "可查看記錄", exact: true })
        .click();
      await expect(records(page).getByRole("alert")).toBeVisible();
      await expect(records(page).getByRole("table")).toHaveCount(0);
      await expect(
        records(page).getByRole("button", { name: "匯出本頁 CSV", exact: true }),
      ).toHaveCount(0);
    });
    test("explicit branch staff dates and cohort scope survive reload and match exported row", async ({
      page,
    }) => {
      await open(page);
      await page.locator("#performance-start").fill("2026-09-30");
      await page.locator("#performance-end").fill("2026-09-30");
      await page.locator("#performance-branch").selectOption(id(500));
      await page.locator("#performance-staff").selectOption(id(600));
      await page.locator("#performance-source").selectOption("whatsapp");
      await page.locator("#performance-deal").selectOption("rent");
      await page.locator("#performance-window").selectOption("30");
      await page.getByRole("button", { name: "套用篩選", exact: true }).click();
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("1");
      await page.reload();
      await expect(metric(page, "有效查詢").locator("p").first()).toHaveText("1");
      for (const [field, value] of [
        ["branch", id(500)],
        ["staff", id(600)],
        ["source", "whatsapp"],
        ["deal", "rent"],
        ["window", "30"],
        ["start", "2026-09-30"],
        ["end", "2026-09-30"],
      ])
        await expect(page.locator(`#performance-${field}`)).toHaveValue(value);
      expect(
        await page.evaluate(
          () =>
            window.performanceReadbackFixture.calls.filter((c) => c.name === "report").at(-1)!
              .input,
        ),
      ).toEqual({
        start: "2026-09-30",
        end: "2026-09-30",
        branchId: id(500),
        staffId: id(600),
        source: "whatsapp",
        dealType: "rent",
        cohortWindowDays: 30,
      });
      await drill(page);
      await expect(records(page).getByRole("row")).toHaveCount(2);
      await expect(records(page)).toContainText(id(2));
      const downloading = page.waitForEvent("download");
      await records(page).getByRole("button", { name: "匯出本頁 CSV", exact: true }).click();
      const csv = await readFile((await (await downloading).path())!, "utf8");
      expect(csv.replace(/^\uFEFF/, "").split(/\r?\n/)).toHaveLength(2);
      expect(csv).toContain(id(2));
      expect(csv).not.toContain(id(1));
    });
    test("disabled flag explains unavailable report and makes no performance reads", async ({
      page,
    }) => {
      await open(page, false);
      await expect(
        page.getByRole("heading", { name: "銷售及代理績效暫未啟用", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            window.performanceReadbackFixture.calls.filter((c) =>
              ["report", "options", "records"].includes(c.name),
            ).length,
        ),
      ).toBe(0);
      await expect(
        page.getByRole("heading", { name: "期間建立的查詢及跟進", exact: true }),
      ).toBeVisible();
    });
  });
