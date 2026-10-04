import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";

declare global {
  interface Window {
    noLinkFixture: {
      calls: { name: string; input?: unknown }[];
      membershipMode: string;
      pendingMembership: { release: () => void }[];
      refreshMembership: (mode?: string, role?: string, binding?: string) => Promise<void>;
      aiMode: string;
      pendingAi: { conversationId: string; ordinal: number; finish: (outcome: string) => void }[];
    };
    noLinkOutboundFixture: { calls: unknown[] };
  }
}
const ids = {
  a: "10000000-0000-4000-8000-000000000001",
  b: "10000000-0000-4000-8000-000000000002",
};
let server: Server, origin: string;
const results: { name: string; width: number; height: number; status: string }[] = [];
const errors = new WeakMap<Page, string[]>();

test.beforeAll(async () => {
  assert.ok(!process.env.PLAYWRIGHT_BASE_URL, "This suite owns its isolated target");
  assert.equal(
    spawnSync(
      process.execPath,
      ["scripts/browser-fixtures/build-whatsapp-no-link.mjs", "mobile-ai"],
      {
        stdio: "inherit",
      },
    ).status,
    0,
  );
  const root = resolve(".audit/no-link-browser-mobile-ai");
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
  await writeFile(
    ".audit/remediation-20261003/ep13-20-ci-compat-mobile-workspace-browser-summary.json",
    JSON.stringify(
      {
        codeSha: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
        evidenceLayer: "actual-whatsapp-route-synthetic-auth-api-owned-loopback",
        realAuth: false,
        realDatabase: false,
        realProvider: false,
        realModel: false,
        results,
      },
      null,
      2,
    ),
  );
});
test.afterEach(async ({ page }, info) => {
  let status = info.status ?? "unknown";
  try {
    if (status !== "passed") return;
    expect(errors.get(page)).toEqual([]);
    expect(await page.evaluate(() => window.noLinkOutboundFixture.calls)).toHaveLength(0);
    const mutations = await page.evaluate(() =>
      window.noLinkFixture.calls.filter((c) =>
        [
          "sendReply",
          "sendTemplate",
          "updateConversation",
          "backfill",
          "consent",
          "confirmStaff",
          "staffHelp",
          "correctEnquiry",
          "contactEdit",
          "leadAi",
          "approveTag",
          "rejectTag",
          "leadActivity",
          "bulkLeads",
          "updateLead",
        ].includes(c.name),
      ),
    );
    expect(mutations).toHaveLength(0);
  } catch (error) {
    status = "failed";
    throw error;
  } finally {
    results.push({ name: info.title, ...page.viewportSize()!, status });
  }
});

async function open(page: Page, mode = "rules", id = ids.a) {
  const captured: string[] = [];
  errors.set(page, captured);
  page.on("pageerror", (error) => captured.push(error.message));
  await page.route("**/*", (route) => {
    const request = route.request();
    if (new URL(request.url()).origin === origin && ["GET", "HEAD"].includes(request.method()))
      return route.continue();
    captured.push("Blocked external or mutation request");
    return route.abort();
  });
  await page.addInitScript((value) => {
    sessionStorage.setItem("no-link-fixture-actor", "agent-a");
    sessionStorage.setItem("no-link-fixture-ai", value);
  }, mode);
  await page.goto(origin + `/admin/whatsapp?conversation=${id}`);
  await expect(reply(page)).toBeVisible();
}
const reply = (page: Page) => page.getByLabel("WhatsApp 回覆").filter({ visible: true });
const suggestions = (page: Page) =>
  page.locator("summary").filter({ hasText: /^查看/ }).filter({ visible: true }).locator("..");
async function expand(page: Page) {
  const outer = page
    .locator("summary")
    .filter({ hasText: "規則回覆建議（只作草稿）" })
    .filter({ visible: true });
  await outer.click();
  await suggestions(page).locator("summary").click();
}
async function switchTo(page: Page, label: "甲" | "乙") {
  if (page.viewportSize()!.width < 1024)
    await page
      .getByRole("button", { name: "關閉", exact: true })
      .filter({ visible: true })
      .first()
      .click();
  await page
    .getByRole("button")
    .filter({ hasText: `合成客戶${label}` })
    .click();
  await expect(reply(page)).toBeVisible();
}
async function pending(page: Page, id: string, ordinal = 1) {
  await expect
    .poll(() =>
      page.evaluate(
        ({ id, ordinal }) =>
          window.noLinkFixture.pendingAi.some(
            (p) => p.conversationId === id && p.ordinal === ordinal,
          ),
        { id, ordinal },
      ),
    )
    .toBe(true);
}
async function finish(page: Page, id: string, ordinal: number, outcome: string) {
  await page.evaluate(
    ({ id, ordinal, outcome }) => {
      const p = window.noLinkFixture.pendingAi.find(
        (p) => p.conversationId === id && p.ordinal === ordinal,
      );
      if (!p) throw Error("Pending owned AI request missing");
      p.finish(outcome);
    },
    { id, ordinal, outcome },
  );
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}
for (const width of [1440, 1280, 768, 390]) {
  test.describe(`${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("resize scroll event without reader movement retains newest pin and older-reader position", async ({
      page,
    }) => {
      await open(page);
      await page.evaluate(() => document.fonts.ready);
      const last = page
        .locator("p.whitespace-pre-wrap.break-words")
        .filter({ hasText: "合成訊息 30" })
        .filter({ visible: true })
        .last();
      await expect(last).toBeVisible();
      const timeline = last.locator("xpath=ancestor::div[contains(@class,'overflow-y-auto')][1]");
      await timeline.evaluate((element) => {
        element.style.flex = "0 0 180px";
        element.style.height = "180px";
      });
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      await timeline.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await timeline.evaluate((element) => {
        const top = element.scrollTop;
        element.style.flex = "0 0 80px";
        element.style.height = "80px";
        if (element.clientHeight !== 80 || element.scrollTop !== top)
          throw Error("Owned resize race precondition failed");
        // Layout changes can emit scroll before ResizeObserver without reader movement.
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await expect
        .poll(() =>
          timeline.evaluate(
            (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
          ),
        )
        .toBeLessThanOrEqual(1);
      await timeline.evaluate((element) => {
        element.scrollTop = 0;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
        element.style.flex = "0 0 60px";
        element.style.height = "60px";
        void element.clientHeight;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      expect(await timeline.evaluate((element) => element.scrollTop)).toBe(0);
    });
    test("membership denial removes private inbox and ignores pending AI while keeping stored drafts", async ({
      page,
    }) => {
      await open(page, "delay");
      await reply(page).fill("Owned original conversation draft retained in its journal");
      await pending(page, ids.a);
      await page.evaluate(() => window.noLinkFixture.refreshMembership("denied"));
      await expect(reply(page)).toHaveCount(0);
      await expect(page.getByRole("button").filter({ hasText: "合成客戶甲" })).toHaveCount(0);
      await finish(page, ids.a, 1, "rules");
      await expect(page.getByText("合成甲規則摘要 1")).toHaveCount(0);
      const journals = await page.evaluate(() => Object.values(sessionStorage));
      expect(
        journals.some((s) =>
          s.includes("Owned original conversation draft retained in its journal"),
        ),
      ).toBe(true);
      await page.evaluate(() => window.noLinkFixture.refreshMembership());
      await expect(reply(page)).toHaveValue(
        "Owned original conversation draft retained in its journal",
      );
    });
    for (const change of ["binding", "role"] as const)
      test(`membership ${change} renews inbox reads and drops the prior AI response`, async ({
        page,
      }) => {
        await open(page, "delay");
        await reply(page).fill("Owned retained actor conversation reply");
        await pending(page, ids.a);
        await page.evaluate(
          (change) =>
            window.noLinkFixture.refreshMembership(
              "ok",
              change === "role" ? "manager" : "agent",
              change === "binding"
                ? "20000000-0000-4000-8000-000000000002"
                : "20000000-0000-4000-8000-000000000001",
            ),
          change,
        );
        await pending(page, ids.a, 2);
        await finish(page, ids.a, 1, "rules");
        await expect(reply(page)).toHaveValue("Owned retained actor conversation reply");
        await expect(page.getByText("合成甲規則摘要 1", { exact: true })).toHaveCount(0);
        await finish(page, ids.a, 2, "rules");
        await expand(page);
        await expect(suggestions(page)).toContainText("合成甲規則摘要 2");
      });
    test("same membership recheck retains conversation reply draft", async ({ page }) => {
      await open(page);
      await reply(page).fill("Owned same member reply draft");
      await page.evaluate(() => window.noLinkFixture.refreshMembership("delayed"));
      await expect
        .poll(() => page.evaluate(() => window.noLinkFixture.pendingMembership.length))
        .toBe(1);
      await expect(reply(page)).toHaveValue("Owned same member reply draft");
      await page.evaluate(() => {
        window.noLinkFixture.membershipMode = "ok";
        window.noLinkFixture.pendingMembership.splice(0).forEach((p) => p.release());
      });
      await expect(reply(page)).toHaveValue("Owned same member reply draft");
    });

    test("AI read outage has recoverable error and retry retains draft", async ({ page }) => {
      await open(page, "error");
      await reply(page).fill("人工草稿。Do not replace.");
      await expand(page);
      await expect(suggestions(page).getByRole("alert")).toContainText("未能載入建議");
      await expect(suggestions(page)).not.toContainText("此對話暫未有建議");
      await expect(suggestions(page)).not.toContainText("internal reference");
      await page.evaluate(() => {
        window.noLinkFixture.aiMode = "rules";
      });
      await page
        .getByRole("button", { name: "重新載入建議", exact: true })
        .filter({ visible: true })
        .click();
      await expect(suggestions(page)).toContainText("合成甲規則摘要 2");
      await expect(suggestions(page).getByRole("alert")).toHaveCount(0);
      await expect(reply(page)).toHaveValue("人工草稿。Do not replace.");
      await page.reload();
      await expect(reply(page)).toHaveValue("人工草稿。Do not replace.");
    });
    test("successful missing result stays empty without a fabricated error", async ({ page }) => {
      await open(page, "empty");
      await expand(page);
      await expect(suggestions(page)).toContainText("此對話暫未有建議");
      await expect(suggestions(page).getByRole("alert")).toHaveCount(0);
      await expect(suggestions(page).getByRole("button")).toHaveCount(0);
    });
    for (const outcome of ["rules", "error"]) {
      test(`late A ${outcome} cannot replace B suggestion draft or focus`, async ({ page }) => {
        await open(page, "delay");
        await pending(page, ids.a);
        await reply(page).fill("甲保留草稿");
        await page.evaluate(() => {
          window.noLinkFixture.aiMode = "rules";
        });
        await switchTo(page, "乙");
        await expand(page);
        await expect(suggestions(page)).toContainText("合成乙規則摘要 1");
        await reply(page).fill("乙保留草稿");
        await reply(page).focus();
        await finish(page, ids.a, 1, outcome);
        await expect(reply(page)).toBeFocused();
        await expect(reply(page)).toHaveValue("乙保留草稿");
        await expect(suggestions(page)).toContainText("合成乙規則摘要 1");
        await expect(suggestions(page).getByRole("alert")).toHaveCount(0);
        await switchTo(page, "甲");
        await expect(reply(page)).toHaveValue("甲保留草稿");
      });
    }
    test("A B A rejects earlier request for the same conversation", async ({ page }) => {
      await open(page, "delay");
      await pending(page, ids.a);
      await reply(page).fill("甲多次切換草稿");
      await page.evaluate(() => {
        window.noLinkFixture.aiMode = "rules";
      });
      await switchTo(page, "乙");
      await reply(page).fill("乙多次切換草稿");
      await switchTo(page, "甲");
      await expand(page);
      await expect(suggestions(page)).toContainText("合成甲規則摘要 2");
      await reply(page).focus();
      await finish(page, ids.a, 1, "rules");
      await expect(suggestions(page)).toContainText("合成甲規則摘要 2");
      await expect(suggestions(page)).not.toContainText("合成甲規則摘要 1");
      await expect(reply(page)).toHaveValue("甲多次切換草稿");
      await expect(reply(page)).toBeFocused();
    });
    test("suggestion apply requires explicit overwrite choice and never sends", async ({
      page,
    }) => {
      await open(page);
      await reply(page).fill("人工撰寫原稿");
      await expand(page);
      const apply = suggestions(page).getByRole("button", { name: "套用至回覆草稿", exact: true });
      page.once("dialog", async (dialog) => {
        expect(dialog.message()).toContain("覆蓋");
        await dialog.dismiss();
      });
      await apply.click();
      await expect(reply(page)).toHaveValue("人工撰寫原稿");
      page.once("dialog", async (dialog) => {
        await dialog.accept();
      });
      await apply.click();
      await expect(reply(page)).toHaveValue(/合成甲規則回覆 1/);
      await page.reload();
      await expect(reply(page)).toHaveValue(/合成甲規則回覆 1/);
    });
    test("reduced keyboard height and late suggestion keep composer focus and send reachable", async ({
      page,
    }) => {
      await open(page, "delay");
      await pending(page, ids.a);
      await expand(page);
      await page.setViewportSize({ width, height: 540 });
      await reply(page).fill("長中文回覆與 English draft ".repeat(6));
      await reply(page).focus();
      await finish(page, ids.a, 1, "rules");
      await expect(reply(page)).toBeFocused();
      await expect(reply(page)).toHaveValue("長中文回覆與 English draft ".repeat(6));
      const send = page
        .getByRole("button", { name: "傳送回覆", exact: true })
        .filter({ visible: true });
      await send.scrollIntoViewIfNeeded();
      // Chromium can round an intersected border by less than one CSS pixel.
      await expect(send).toBeInViewport({ ratio: 0.99 });
      const sendBox = await send.boundingBox();
      expect(sendBox).not.toBeNull();
      expect(sendBox!.y).toBeGreaterThanOrEqual(-1);
      expect(sendBox!.y + sendBox!.height).toBeLessThanOrEqual(541);
      await send.click({ trial: true });
      await expect(send).toBeEnabled();
      if (width < 1024) {
        const close = page
          .getByRole("button", { name: "關閉", exact: true })
          .filter({ visible: true })
          .first();
        const box = await close.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeGreaterThanOrEqual(44);
        await page.keyboard.press("Escape");
        await page.getByRole("button").filter({ hasText: "合成客戶甲" }).click();
        await expect(reply(page)).toHaveValue("長中文回覆與 English draft ".repeat(6));
      }
    });
  });
}
