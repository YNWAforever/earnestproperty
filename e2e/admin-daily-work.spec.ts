import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
declare global {
  interface Window {
    dailyWorkFixture: {
      calls: { name: string; actor: string; role: string; binding: string; input: unknown }[];
      overviewMode: string;
      staffMode: string;
      leadsMode: string;
      noteMode: string;
      mutationPending: { release: () => void }[];
      acceptedNotes: { actor: string; input: Record<string, unknown> }[];
      leadUpdates: { actor: string; input: Record<string, unknown> }[];
      teamMode: string;
      checklistMode: string;
      empty: boolean;
      pending: { release: () => void; actor: string; role: string }[];
      changeContext: (
        actor: string,
        role: string,
        binding?: string,
        denied?: boolean,
      ) => Promise<void>;
    };
  }
}
let server: Server, origin: string;
const evidencePrefix = process.env.EP_ACCEPTANCE_EVIDENCE_PREFIX ?? "ep20-keyboard";
assert.match(evidencePrefix, /^[a-z0-9-]{1,80}$/, "Safe owned evidence filename prefix");
const evidence: { name: string; status: string; width: number }[] = [];
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
  await writeFile(
    `.audit/remediation-20261003/${evidencePrefix}-daily-work-session-lifetime-summary.json`,
    JSON.stringify(
      {
        codeSha: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
        evidenceLayer: "actual-overview-leads-shell-staff-store-synthetic-auth-api-owned-loopback",
        realAuth: false,
        realDatabase: false,
        realProvider: false,
        results: evidence,
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
  evidence.push({
    name: info.title,
    status: fits ? (info.status ?? "unknown") : "failed",
    width: page.viewportSize()!.width,
  });
  expect(fits).toBe(true);
});
const card = (page: Page, label: string) =>
  page.getByRole("link").filter({ has: page.getByText(label, { exact: true }) });
const calls = (page: Page, name: string) =>
  page.evaluate((n) => window.dailyWorkFixture.calls.filter((c) => c.name === n), name);
async function open(page: Page, role = "manager") {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin &&
    ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort(),
  );
  await page.addInitScript((role) => {
    sessionStorage.setItem("daily-work-actor", "actor-a");
    sessionStorage.setItem("daily-work-role", role);
  }, role);
  await page.goto(origin + "/admin");
  await expect(page.getByRole("heading", { name: "總覽", exact: true })).toBeVisible();
  await expect(card(page, "開放查詢")).toContainText(
    ["admin", "manager"].includes(role) ? "7" : "2",
  );
  expect(errors).toEqual([]);
}
async function leadSearch(page: Page, empty = false) {
  await open(page);
  if (empty) await page.evaluate(() => (window.dailyWorkFixture.empty = true));
  await card(page, "開放查詢").click();
  const input = page.getByRole("textbox", { name: "搜尋客戶查詢", exact: true });
  await expect(input).toBeVisible();
  await input.focus();
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1000);
  return input;
}
async function leadCompositionInput(
  input: import("@playwright/test").Locator,
  value: string,
  composing: boolean,
) {
  await input.evaluate(
    (element, { value, composing }) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!setter) throw Error("Owned native input setter missing");
      setter.call(element, value);
      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: value,
          inputType: "insertCompositionText",
          isComposing: composing,
        }),
      );
    },
    { value, composing },
  );
}
async function leadQueryArguments(page: Page) {
  return (await calls(page, "leads")).map((call) => (call.input as { q?: string }).q);
}
async function noLeadSearchEffects(page: Page) {
  expect(await calls(page, "lead-update")).toHaveLength(0);
  expect(await calls(page, "lead-note")).toHaveLength(0);
  expect(await page.evaluate(() => window.dailyWorkFixture.acceptedNotes)).toHaveLength(0);
  expect(await page.evaluate(() => window.dailyWorkFixture.leadUpdates)).toHaveLength(0);
  expect(await page.evaluate(() => window.noLinkOutboundFixture.calls)).toHaveLength(0);
}

for (const width of [1440, 1280, 768, 390]) {
  test.describe(`${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("Leads IME pause and same identity recheck keep candidate local until committed", async ({
      page,
    }) => {
      const input = await leadSearch(page);
      await input.dispatchEvent("compositionstart");
      await leadCompositionInput(input, "每日工作", true);
      await page.evaluate(() => window.dailyWorkFixture.changeContext("actor-a", "manager"));
      await expect(input).toHaveValue("每日工作");
      await expect(input).toBeFocused();
      await page.clock.runFor(700);
      expect(new URL(page.url()).searchParams.get("query")).toBeNull();
      expect(await leadQueryArguments(page)).not.toContain("每日工作");
      await leadCompositionInput(input, "每日工作合成查詢", false);
      await input.dispatchEvent("compositionend");
      await page.clock.runFor(700);
      await expect
        .poll(() => new URL(page.url()).searchParams.get("query"))
        .toBe("每日工作合成查詢");
      expect(await leadQueryArguments(page)).toContain("每日工作合成查詢");
      await expect(input).toBeFocused();
      await input.fill("English sale");
      await page.clock.runFor(700);
      await expect.poll(() => new URL(page.url()).searchParams.get("query")).toBe("English sale");
      expect(await leadQueryArguments(page)).toContain("English sale");
      await expect(input).toBeFocused();
      await page.clock.resume();
      await noLeadSearchEffects(page);
    });
    test("Leads IME start cancels pending search and unchanged composition end commits", async ({
      page,
    }) => {
      const input = await leadSearch(page);
      await input.fill("每日工作");
      await page.clock.runFor(100);
      await input.dispatchEvent("compositionstart");
      await page.clock.runFor(700);
      expect(new URL(page.url()).searchParams.get("query")).toBeNull();
      expect(await leadQueryArguments(page)).not.toContain("每日工作");
      await input.dispatchEvent("compositionend");
      await page.clock.runFor(700);
      await expect.poll(() => new URL(page.url()).searchParams.get("query")).toBe("每日工作");
      expect(await leadQueryArguments(page)).toContain("每日工作");
      await expect(input).toBeFocused();
      await page.clock.resume();
      await noLeadSearchEffects(page);
    });
    test("Leads pending search keeps the newer stage filter", async ({ page }) => {
      const input = await leadSearch(page);
      await input.fill("English sale");
      await page.clock.runFor(100);
      await page.getByRole("button", { name: "新查詢", exact: true }).focus();
      await page.keyboard.press("Enter");
      await page.clock.runFor(10);
      await expect.poll(() => new URL(page.url()).searchParams.get("stage")).toBe("new");
      await page.clock.runFor(700);
      await expect.poll(() => new URL(page.url()).searchParams.get("query")).toBe("English sale");
      expect(new URL(page.url()).searchParams.get("stage")).toBe("new");
      expect((await calls(page, "leads")).at(-1)?.input).toMatchObject({
        q: "English sale",
        stage: "new",
      });
      await page.clock.resume();
      await noLeadSearchEffects(page);
    });
    test("Leads composition workspace replacement never commits the old candidate", async ({
      page,
    }) => {
      const input = await leadSearch(page);
      await input.dispatchEvent("compositionstart");
      await leadCompositionInput(input, "每日工作", true);
      await page.clock.runFor(100);
      await page.evaluate(() =>
        window.dailyWorkFixture.changeContext("actor-b", "agent", "staff-b"),
      );
      await expect(input).toHaveValue("");
      await page.clock.runFor(700);
      expect(new URL(page.url()).searchParams.get("query")).toBeNull();
      expect(await leadQueryArguments(page)).not.toContain("每日工作");
      expect((await calls(page, "leads")).at(-1)).toMatchObject({
        actor: "actor-b",
        role: "agent",
        binding: "staff-b",
      });
      await page.clock.resume();
      await noLeadSearchEffects(page);
    });
    for (const reset of ["重設", "清除篩選"]) {
      for (const composing of [false, true]) {
        test(`Leads explicit reset ${reset} clears ${composing ? "composing" : "pending"} search and resumes`, async ({
          page,
        }) => {
          const input = await leadSearch(page, reset === "清除篩選");
          const candidate = composing ? "未確認組字" : "Pending search";
          if (composing) {
            await input.dispatchEvent("compositionstart");
            await leadCompositionInput(input, candidate, true);
          } else await input.fill(candidate);
          await page.clock.runFor(100);
          expect(new URL(page.url()).searchParams.get("query")).toBeNull();
          await page.getByRole("button", { name: reset, exact: true }).focus();
          await page.keyboard.press("Enter");
          await page.clock.runFor(10);
          await expect(input).toHaveValue("");
          if (composing) await input.dispatchEvent("compositionend");
          await page.clock.runFor(700);
          expect(new URL(page.url()).searchParams.get("query")).toBeNull();
          expect(new URL(page.url()).searchParams.get("stage")).not.toBe("open");
          expect(await leadQueryArguments(page)).not.toContain(candidate);
          expect((await calls(page, "leads")).at(-1)?.input).toMatchObject({ q: "", stage: "all" });
          await input.fill("English resumed");
          await page.clock.runFor(700);
          await expect
            .poll(() => new URL(page.url()).searchParams.get("query"))
            .toBe("English resumed");
          expect(await leadQueryArguments(page)).toContain("English resumed");
          await page.clock.resume();
          await noLeadSearchEffects(page);
        });
      }
    }
    for (const change of ["actor", "role", "binding", "aba", "late-failure", "same-context"]) {
      test(`delayed note continuation respects workspace lifetime ${change}`, async ({ page }) => {
        await open(page);
        await card(page, "開放查詢").click();
        await page.getByText("每日工作合成查詢0", { exact: true }).click();
        await expect(page.getByLabel("新增內部跟進紀錄", { exact: true })).toBeVisible();
        await page.getByLabel("新增內部跟進紀錄", { exact: true }).fill("原 actor 已提交的備註");
        await page
          .getByLabel("內部備註（不會傳送給客戶）", { exact: true })
          .fill("原 actor 的 draft");
        await page.evaluate(
          (change) =>
            (window.dailyWorkFixture.noteMode =
              change === "late-failure" ? "delayed-failure" : "delayed"),
          change,
        );
        await page.getByRole("button", { name: "儲存", exact: true }).click();
        await expect
          .poll(() => page.evaluate(() => window.dailyWorkFixture.mutationPending.length))
          .toBe(1);
        if (["actor", "late-failure", "aba"].includes(change))
          await page.evaluate(() =>
            window.dailyWorkFixture.changeContext("actor-b", "manager", "staff-b"),
          );
        if (change === "role")
          await page.evaluate(() => window.dailyWorkFixture.changeContext("actor-a", "agent"));
        if (change === "binding")
          await page.evaluate(() =>
            window.dailyWorkFixture.changeContext("actor-a", "manager", "staff-b"),
          );
        if (change === "aba") {
          await expect(page.getByLabel("內部備註（不會傳送給客戶）", { exact: true })).toHaveValue(
            "",
          );
          await page.evaluate(() => window.dailyWorkFixture.changeContext("actor-a", "manager"));
        }
        if (change === "same-context")
          await page.evaluate(() => window.dailyWorkFixture.changeContext("actor-a", "manager"));
        else
          await expect(page.getByLabel("內部備註（不會傳送給客戶）", { exact: true })).toHaveValue(
            "",
          );
        const before = (await calls(page, "lead-detail")).length;
        await page.evaluate(async () => {
          window.dailyWorkFixture.mutationPending[0].release();
          // The synthetic request continuation drains before this next frame.
          await new Promise<void>((done) => requestAnimationFrame(() => done()));
        });
        expect(await calls(page, "lead-note-return")).toHaveLength(1);
        if (change === "same-context") {
          await expect
            .poll(() => page.evaluate(() => window.dailyWorkFixture.leadUpdates.length))
            .toBe(1);
          await expect(page.getByRole("button", { name: "儲存", exact: true })).toBeEnabled();
          expect(await page.evaluate(() => window.dailyWorkFixture.leadUpdates[0])).toMatchObject({
            actor: "actor-a",
            input: { note: "原 actor 的 draft" },
          });
        } else {
          await expect
            .poll(() => page.evaluate(() => window.dailyWorkFixture.mutationPending.length))
            .toBe(1);
          await expect(page.getByText("Owned old note failed", { exact: true })).toHaveCount(0);
          expect(await calls(page, "lead-update")).toHaveLength(0);
          expect(await calls(page, "lead-detail")).toHaveLength(before);
          await expect(page.getByLabel("內部備註（不會傳送給客戶）", { exact: true })).toHaveValue(
            "",
          );
        }
        expect(await page.evaluate(() => window.dailyWorkFixture.acceptedNotes.length)).toBe(
          change === "late-failure" ? 0 : 1,
        );
      });
    }
    test("lead list same-user downgrade removes old scope and selection", async ({ page }) => {
      await open(page);
      await card(page, "開放查詢").click();
      await expect(page.getByText("每日工作合成查詢6", { exact: true })).toBeVisible();
      await page.getByRole("checkbox").first().click();
      await expect(page.getByText(/已選.*7/)).toBeVisible();
      await page.evaluate(() => window.dailyWorkFixture.changeContext("actor-a", "agent"));
      await expect(page.getByText("每日工作合成查詢6", { exact: true })).toHaveCount(0);
      await expect(page.getByText("每日工作合成查詢1", { exact: true })).toBeVisible();
      await expect(page.getByText(/已選.*7/)).toHaveCount(0);
      expect((await calls(page, "leads")).map((c) => c.role)).toEqual(["manager", "agent"]);
    });
    test("lead list same-user relink starts a fresh staff scope", async ({ page }) => {
      await open(page, "agent");
      await card(page, "開放查詢").click();
      await expect(page.getByText("每日工作合成查詢1", { exact: true })).toBeVisible();
      await page.evaluate(() =>
        window.dailyWorkFixture.changeContext("actor-a", "agent", "staff-b"),
      );
      await expect(page.getByText("每日工作合成查詢2", { exact: true })).toBeVisible();
      expect((await calls(page, "leads")).map((c) => c.binding)).toEqual(["staff-a", "staff-b"]);
    });
    for (const outcome of ["success", "denied"]) {
      test(`late old lead list ${outcome} cannot affect new scope`, async ({ page }) => {
        await open(page);
        await page.evaluate(
          (outcome) => (window.dailyWorkFixture.leadsMode = "delayed-" + outcome),
          outcome,
        );
        await card(page, "開放查詢").click();
        await expect
          .poll(() => page.evaluate(() => window.dailyWorkFixture.pending.length))
          .toBe(1);
        await page.evaluate(() => {
          window.dailyWorkFixture.leadsMode = "ok";
          return window.dailyWorkFixture.changeContext("actor-a", "agent");
        });
        await expect(page.getByText("每日工作合成查詢1", { exact: true })).toBeVisible();
        await page.evaluate(() => window.dailyWorkFixture.pending[0].release());
        await expect(page.getByText("每日工作合成查詢6", { exact: true })).toHaveCount(0);
        await expect(page.getByText("每日工作合成查詢1", { exact: true })).toBeVisible();
        await expect(page.getByText("Owned forbidden", { exact: true })).toHaveCount(0);
        expect((await calls(page, "leads")).map((c) => c.role)).toEqual(["manager", "agent"]);
      });
    }
    test("unknown staff verification hides private page and restores with a fresh read", async ({
      page,
    }) => {
      await open(page);
      await card(page, "開放查詢").click();
      await expect(page.getByText("每日工作合成查詢6", { exact: true })).toBeVisible();
      await page.evaluate(() => {
        window.dailyWorkFixture.staffMode = "failure";
        return window.dailyWorkFixture.changeContext("actor-a", "manager");
      });
      await expect(page.getByRole("heading", { name: "未能核實職員權限" })).toBeVisible();
      await expect(page.getByText("每日工作合成查詢6", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "記錄人工轉交", exact: true })).toHaveCount(0);
      const before = (await calls(page, "leads")).length;
      await page.evaluate(() => (window.dailyWorkFixture.staffMode = "ok"));
      await page.getByRole("button", { name: "重新檢查", exact: true }).click();
      await expect(page.getByText("每日工作合成查詢6", { exact: true })).toBeVisible();
      expect(await calls(page, "leads")).toHaveLength(before + 1);
    });
    test("initial pending staff verification does not mount lead page reads", async ({ page }) => {
      await page.route("**/*", (route) =>
        new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
      );
      await page.addInitScript(() => sessionStorage.setItem("daily-work-staff-mode", "delayed"));
      await page.goto(origin + "/admin/leads?stage=open");
      await expect.poll(() => page.evaluate(() => window.dailyWorkFixture.pending.length)).toBe(1);
      await expect(page.getByRole("heading", { name: "正在核實職員權限" })).toBeVisible();
      expect(await calls(page, "leads")).toHaveLength(0);
      await page.evaluate(() => window.dailyWorkFixture.pending[0].release());
      await expect(page.getByText("每日工作合成查詢6", { exact: true })).toBeVisible();
      expect(await calls(page, "leads")).toHaveLength(1);
    });
    test("same staff identity recheck preserves selection and unsent work", async ({ page }) => {
      await open(page);
      await card(page, "開放查詢").click();
      await expect(page.getByText("每日工作合成查詢6", { exact: true })).toBeVisible();
      await page.getByRole("checkbox").first().click();
      await page.evaluate(() => window.dailyWorkFixture.changeContext("actor-a", "manager"));
      await expect(page.getByText(/已選.*7/)).toBeVisible();
      expect(await calls(page, "leads")).toHaveLength(1);
    });
    test("unsent forwarded draft survives unknown verification but stays actor isolated", async ({
      page,
    }) => {
      await open(page);
      await card(page, "開放查詢").click();
      await page.getByRole("button", { name: "記錄人工轉交", exact: true }).click();
      await page.getByLabel("原文／轉交內容", { exact: true }).fill("只屬於甲的未送草稿");
      await page.getByLabel("業務來源", { exact: true }).fill("甲的合成來源");
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              JSON.parse(sessionStorage.getItem("ep-forwarded-enquiry-draft:v1:actor-a")!).fields
                .text,
          ),
        )
        .toBe("只屬於甲的未送草稿");
      await page.evaluate(() => {
        window.dailyWorkFixture.staffMode = "failure";
        return window.dailyWorkFixture.changeContext("actor-a", "manager");
      });
      await expect(page.getByRole("heading", { name: "未能核實職員權限" })).toBeVisible();
      await expect(page.getByLabel("原文／轉交內容", { exact: true })).toHaveCount(0);
      await page.screenshot({
        path: `.audit/remediation-20261003/${evidencePrefix}-ep12-session-hidden-${width}.png`,
        fullPage: true,
      });
      await page.evaluate(() => {
        window.dailyWorkFixture.staffMode = "ok";
        return window.dailyWorkFixture.changeContext("actor-b", "agent", "staff-b");
      });
      await page.getByRole("button", { name: "記錄人工轉交", exact: true }).click();
      await expect(page.getByLabel("原文／轉交內容", { exact: true })).toHaveValue("");
      await page.evaluate(() => window.dailyWorkFixture.changeContext("actor-a", "agent"));
      await page.getByRole("button", { name: "記錄人工轉交", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "原文／轉交內容", exact: true })).toHaveValue(
        "只屬於甲的未送草稿",
      );
      await expect(page.getByLabel("業務來源", { exact: true })).toHaveValue("甲的合成來源");
      const dialog = page.getByRole("dialog", { name: "記錄人工轉交查詢", exact: true });
      await dialog.evaluate((element) =>
        Promise.all(
          element
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished.catch(() => undefined)),
        ),
      );
      const bounds = await dialog.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        animations: "disabled",
        path: `.audit/remediation-20261003/${evidencePrefix}-ep12-session-draft-${width}.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () =>
            (
              window as unknown as { noLinkFixture: { calls: { name: string }[] } }
            ).noLinkFixture.calls.filter((c: { name: string }) => c.name === "syntheticForward")
              .length,
        ),
      ).toBe(0);
    });
    test("denied membership hides lead history and restoration starts a fresh read", async ({
      page,
    }) => {
      await open(page);
      await card(page, "開放查詢").click();
      await expect(page.getByText("每日工作合成查詢6", { exact: true })).toBeVisible();
      const before = (await calls(page, "leads")).length;
      await page.evaluate(() =>
        window.dailyWorkFixture.changeContext("actor-a", "agent", "staff-a", true),
      );
      await expect(page.getByText("此帳戶不是職員帳戶", { exact: true })).toBeVisible();
      await expect(page.getByText("每日工作合成查詢6", { exact: true })).toHaveCount(0);
      expect(await calls(page, "leads")).toHaveLength(before);
      await page.evaluate(() => window.dailyWorkFixture.changeContext("actor-a", "agent"));
      await expect(page.getByText("每日工作合成查詢1", { exact: true })).toBeVisible();
      await expect(page.getByText("每日工作合成查詢6", { exact: true })).toHaveCount(0);
      expect(await calls(page, "leads")).toHaveLength(before + 1);
      await page.screenshot({
        path: `.audit/remediation-20261003/${evidencePrefix}-ep12-session-restored-${width}.png`,
        fullPage: true,
      });
    });
    test("same-user role downgrade clears whole-company values and restricted team history", async ({
      page,
    }) => {
      await open(page, "admin");
      await expect(page.getByText("受限合成團隊成員", { exact: true })).toBeVisible();
      await page.evaluate(() => window.dailyWorkFixture.changeContext("actor-a", "agent"));
      await expect(card(page, "開放查詢")).toContainText("2");
      await expect(page.getByText("受限合成團隊成員", { exact: true })).toHaveCount(0);
      await expect(page.getByText("已更新團隊角色", { exact: true })).toHaveCount(0);
      await expect(page.getByText(/客戶資料範圍：我負責的查詢與對話/)).toBeVisible();
      expect((await calls(page, "overview")).map((c) => c.role)).toEqual(["admin", "agent"]);
    });
    test("same-user staff relink refreshes scope even when role is unchanged", async ({ page }) => {
      await open(page, "agent");
      await page.evaluate(() =>
        window.dailyWorkFixture.changeContext("actor-a", "agent", "staff-b"),
      );
      await expect(card(page, "開放查詢")).toContainText("3");
      expect((await calls(page, "overview")).map((c) => c.binding)).toEqual(["staff-a", "staff-b"]);
    });
    test("late manager success cannot replace fresh agent scope", async ({ page }) => {
      await open(page);
      await page.evaluate(() => (window.dailyWorkFixture.overviewMode = "delayed-success"));
      await page.getByRole("button", { name: "重新整理", exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.dailyWorkFixture.pending.length)).toBe(1);
      await page.evaluate(() => {
        window.dailyWorkFixture.overviewMode = "ok";
        return window.dailyWorkFixture.changeContext("actor-a", "agent");
      });
      await expect(card(page, "開放查詢")).toContainText("2");
      await page.evaluate(() => window.dailyWorkFixture.pending[0].release());
      await expect(card(page, "開放查詢")).toContainText("2");
      await expect(card(page, "開放查詢").getByRole("alert")).toHaveCount(0);
    });
    test("late denied old read cannot erase the new actor's result", async ({ page }) => {
      await open(page);
      await page.evaluate(() => (window.dailyWorkFixture.overviewMode = "delayed-denied"));
      await page.getByRole("button", { name: "重新整理", exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.dailyWorkFixture.pending.length)).toBe(1);
      await page.evaluate(() => {
        window.dailyWorkFixture.overviewMode = "ok";
        return window.dailyWorkFixture.changeContext("actor-b", "agent", "staff-b");
      });
      await expect(card(page, "開放查詢")).toContainText("3");
      await page.evaluate(() => window.dailyWorkFixture.pending[0].release());
      await expect(card(page, "開放查詢")).toContainText("3");
      await expect(card(page, "開放查詢").getByRole("alert")).toHaveCount(0);
    });
    test("partial directory failure preserves other success and current count", async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date("2026-10-03T01:00:00Z"));
      await open(page, "admin");
      await page.clock.setFixedTime(new Date("2026-10-03T01:05:00Z"));
      await page.evaluate(() => (window.dailyWorkFixture.teamMode = "failure"));
      await page.getByRole("button", { name: "重新整理", exact: true }).click();
      await expect(card(page, "啟用團隊").getByRole("alert")).toBeVisible();
      await expect(card(page, "啟用團隊")).toContainText("7");
      await expect(card(page, "開放查詢")).toContainText("7");
      await expect(card(page, "開放查詢").getByRole("alert")).toHaveCount(0);
      await expect(page.getByText(/資料截至.*香港時間/)).toBeVisible();
      const lastRead = await page.evaluate(
        () =>
          "最後成功讀取 " +
          new Date("2026-10-03T01:00:00Z").toLocaleString("zh-HK", {
            timeZone: "Asia/Hong_Kong",
          }) +
          "（香港時間）。",
      );
      await expect(card(page, "啟用團隊").getByRole("alert")).toContainText(lastRead);
      await expect(
        page.locator('[aria-labelledby="overview-attention"]').getByRole("alert"),
      ).toContainText(lastRead);
    });
    test("true empty differs from read failure and denied data is cleared", async ({ page }) => {
      await open(page, "agent");
      await page.evaluate(() => (window.dailyWorkFixture.empty = true));
      await page.getByRole("button", { name: "重新整理", exact: true }).click();
      await expect(card(page, "開放查詢")).toContainText("0");
      await page.evaluate(() => (window.dailyWorkFixture.overviewMode = "failure"));
      await page.getByRole("button", { name: "重新整理", exact: true }).click();
      await expect(card(page, "開放查詢").getByRole("alert")).toBeVisible();
      await expect(card(page, "開放查詢")).toContainText("0");
      await page.evaluate(() => (window.dailyWorkFixture.overviewMode = "denied"));
      await page.getByRole("button", { name: "重新整理", exact: true }).click();
      await expect(card(page, "開放查詢")).toContainText("—");
    });
    test("revoked membership stops reads and restored same-user scope starts fresh", async ({
      page,
    }) => {
      await open(page);
      const before = (await calls(page, "overview")).length;
      await page.evaluate(() =>
        window.dailyWorkFixture.changeContext("actor-a", "agent", "staff-a", true),
      );
      await expect(page.getByText("此帳戶不是職員帳戶", { exact: true })).toBeVisible();
      // A denial is a definite answer: no admin destination is offered (unlike a failed lookup).
      await expect(page.locator('nav[aria-label="後台選單"] a')).toHaveCount(0);
      expect(await calls(page, "overview")).toHaveLength(before);
      await page.evaluate(() => window.dailyWorkFixture.changeContext("actor-a", "agent"));
      await expect(card(page, "開放查詢")).toContainText("2");
      await expect(page.getByText("受限合成團隊成員", { exact: true })).toHaveCount(0);
    });
    test("an agent's overview makes no team or audit read and shows no 請稍後再試", async ({
      page,
    }) => {
      await open(page, "agent");
      await expect(card(page, "系統健康")).not.toContainText("—");
      await expect(card(page, "待處理對話")).toContainText("2");
      await expect(card(page, "啟用團隊")).toHaveCount(0);
      await expect(card(page, "待處理邀請")).toHaveCount(0);
      await expect(page.locator('[aria-labelledby="overview-attention"]')).toHaveCount(0);
      await expect(page.locator('[aria-labelledby="overview-activity"]')).toHaveCount(0);
      await expect(page.getByText("暫時無法載入此營運資料，請稍後再試。")).toHaveCount(0);
      expect(await calls(page, "team")).toHaveLength(0);
      expect(await calls(page, "audit")).toHaveLength(0);
      // The sidebar lists only what an agent can open: no locked rows.
      const nav = page.getByRole("navigation", { name: "後台選單" }).filter({ visible: true });
      if (width >= 1024) {
        await expect(nav.getByRole("link", { name: "團隊成員", exact: true })).toHaveCount(0);
        await expect(nav.locator('[aria-disabled="true"]')).toHaveCount(0);
      }
    });
    test("overview tiles have accessible names", async ({ page }) => {
      await open(page);
      await expect(page.getByRole("link", { name: "開放查詢：7", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "待處理對話：7", exact: true })).toBeVisible();
    });
    test("今日待辦 is shown to every staff role and the invite panel only to admins", async ({
      page,
    }) => {
      await open(page, "admin");
      await expect(page.locator('[aria-labelledby="overview-today"]')).toBeVisible();
      await expect(page.locator('[aria-labelledby="overview-attention"]')).toHaveCount(1);
      for (const role of ["manager", "agent"]) {
        await page.evaluate((role) => window.dailyWorkFixture.changeContext("actor-a", role), role);
        await expect(page.locator('[aria-labelledby="overview-today"]')).toBeVisible();
        await expect(page.locator('[aria-labelledby="overview-attention"]')).toHaveCount(0);
      }
    });
    test("今日待辦 links open the WhatsApp conversation and the lead", async ({ page }) => {
      await open(page);
      const today = page.locator('[aria-labelledby="overview-today"]');
      await expect(today.getByRole("link", { name: /合成客戶甲/ })).toHaveAttribute(
        "href",
        /\/admin\/whatsapp\?conversation=10000000-0000-4000-8000-000000000001$/,
      );
      await today.getByRole("link", { name: /每日工作合成查詢1/ }).click();
      await expect(page).toHaveURL(/\/admin\/leads\?lead=40000000-0000-4000-8000-000000000002$/);
      await expect.poll(async () => (await calls(page, "lead-detail")).length).toBe(1);
    });
    test("keyboard card opens the same filtered list and reload retains filter", async ({
      page,
    }) => {
      await open(page, "agent");
      const link = card(page, "開放查詢");
      await link.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/admin\/leads\?stage=open$/);
      await expect(page.getByRole("combobox", { name: "階段", exact: true })).toHaveText(
        "開放（未完成）",
      );
      if (width >= 1024) {
        const current = page
          .getByRole("navigation", { name: "後台選單" })
          .filter({ visible: true })
          .locator('[aria-current="page"]');
        await expect(current).toHaveCount(1);
        await expect(current).toHaveAccessibleName("客戶查詢");
      }
      await expect(page.getByText("每日工作合成查詢0", { exact: true })).toBeVisible();
      await expect(page.getByText("每日工作合成查詢1", { exact: true })).toBeVisible();
      expect((await calls(page, "leads"))[0].input).toMatchObject({ stage: "open" });
      await page.reload();
      await expect(page).toHaveURL(/\/admin\/leads\?stage=open$/);
      await expect(page.getByText("每日工作合成查詢1", { exact: true })).toBeVisible();
    });
    test("after 我已核對, a new tab and a reload show no checklist; another account sees it", async ({
      page,
    }) => {
      const checklist = (p: Page) => p.getByRole("region", { name: "首次登入核對" });
      await open(page);
      await expect(checklist(page)).toBeVisible();
      await page.getByRole("button", { name: "我已核對", exact: true }).click();
      await expect(checklist(page)).toHaveCount(0);
      expect(await calls(page, "checklist-confirm")).toHaveLength(1);
      // A new tab of the same browser: the positive answer is cached, no server read needed.
      const other = await page.context().newPage();
      await other.goto(origin + "/admin");
      await expect(other.getByRole("heading", { name: "總覽", exact: true })).toBeVisible();
      await expect(checklist(other)).toHaveCount(0);
      expect(await calls(other, "checklist-read")).toHaveLength(0);
      await other.close();
      // With the cache gone (another browser or device), the server answer still hides it.
      await page.evaluate(() => {
        for (const key of Object.keys(localStorage))
          if (key.startsWith("earnest:first-login-checklist:")) localStorage.removeItem(key);
      });
      await page.reload();
      await expect(page.getByRole("heading", { name: "總覽", exact: true })).toBeVisible();
      await expect.poll(async () => (await calls(page, "checklist-read")).length).toBe(1);
      await expect(checklist(page)).toHaveCount(0);
      // Another account has not confirmed.
      await page.evaluate(() =>
        window.dailyWorkFixture.changeContext("actor-b", "manager", "staff-b"),
      );
      await expect(checklist(page)).toBeVisible();
    });
    test("a failed save shows 未能記錄核對，請重試。 and keeps the checklist", async ({ page }) => {
      await open(page);
      const checklist = page.getByRole("region", { name: "首次登入核對" });
      await page.evaluate(() => (window.dailyWorkFixture.checklistMode = "failure"));
      await page.getByRole("button", { name: "我已核對", exact: true }).click();
      await expect(checklist.getByRole("alert")).toHaveText("未能記錄核對，請重試。");
      await expect(checklist).toBeVisible();
      expect(
        await page.evaluate(() =>
          Object.keys(localStorage).filter((k) => k.startsWith("earnest:first-login-checklist:")),
        ),
      ).toEqual([]);
      await page.evaluate(() => (window.dailyWorkFixture.checklistMode = "ok"));
      await page.getByRole("button", { name: "我已核對", exact: true }).click();
      await expect(checklist).toHaveCount(0);
    });
  });
}
